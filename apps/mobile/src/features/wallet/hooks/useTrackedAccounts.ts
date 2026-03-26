import { useMemo } from 'react';
import { useReadContracts, useChainId } from 'wagmi';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';
import { useAccountStore } from '../store/accountStore';

export interface TrackedAccount {
  address: `0x${string}`;
  shortAddress: string;
  tier: 'base' | 'primary';
  isVerified: boolean;
  expiresAt: bigint | null;
}

function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function formatQuarter(timestamp: bigint): string {
  if (timestamp === 0n) return '—';
  const date = new Date(Number(timestamp) * 1000);
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `Q${q} ${date.getFullYear()}`;
}

export function useTrackedAccounts(): {
  baseAccounts: TrackedAccount[];
  primaryAccounts: TrackedAccount[];
  isLoading: boolean;
  refetch: () => void;
} {
  const chainId = useChainId();
  const { trackedEntries } = useAccountStore();

  const contractAddress = isSupportedChain(chainId)
    ? CONTRACT_ADDRESSES[chainId].verificationRegistry
    : '0x0000000000000000000000000000000000000000';

  const enabled = isSupportedChain(chainId) && trackedEntries.length > 0;

  // 4 reads per entry: isVerified, isPrimaryVerified, getBaseExpiry, getPrimaryExpiry
  const contracts = useMemo(
    () =>
      trackedEntries.flatMap(({ address }) => [
        { address: contractAddress, abi: VERIFICATION_REGISTRY_ABI, functionName: 'isVerified' as const, args: [address] as const },
        { address: contractAddress, abi: VERIFICATION_REGISTRY_ABI, functionName: 'isPrimaryVerified' as const, args: [address] as const },
        { address: contractAddress, abi: VERIFICATION_REGISTRY_ABI, functionName: 'getBaseExpiry' as const, args: [address] as const },
        { address: contractAddress, abi: VERIFICATION_REGISTRY_ABI, functionName: 'getPrimaryExpiry' as const, args: [address] as const },
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contractAddress, JSON.stringify(trackedEntries)],
  );

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled, staleTime: 0 },
  });

  const allAccounts = useMemo<TrackedAccount[]>(() =>
    trackedEntries.map(({ address, tier }, i) => {
      const isBase = (data?.[i * 4]?.result as boolean | undefined) ?? false;
      const isPrimary = (data?.[i * 4 + 1]?.result as boolean | undefined) ?? false;
      const baseExpiry = (data?.[i * 4 + 2]?.result as bigint | undefined) ?? null;
      const primaryExpiry = (data?.[i * 4 + 3]?.result as bigint | undefined) ?? null;
      return {
        address,
        shortAddress: `${address.slice(0, 6)}...${address.slice(-4)}`,
        tier,
        isVerified: tier === 'base' ? isBase : isPrimary,
        expiresAt: tier === 'base' ? baseExpiry : primaryExpiry,
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(trackedEntries), data],
  );

  return {
    baseAccounts: allAccounts.filter((a) => a.tier === 'base'),
    primaryAccounts: allAccounts.filter((a) => a.tier === 'primary'),
    isLoading,
    refetch: () => { void refetch(); },
  };
}
