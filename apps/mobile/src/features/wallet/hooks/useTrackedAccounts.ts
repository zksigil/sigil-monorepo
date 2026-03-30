import { useMemo, useRef } from 'react';
import { useReadContracts, useChainId, useAccount } from 'wagmi';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';

export interface TrackedAccount {
  address: `0x${string}`;
  shortAddress: string;
  /** Base tier (proof of personhood, multiple allowed). */
  isBaseVerified: boolean;
  baseExpiry: bigint | null;
  /** Unique tier (sybil resistance, one per passport). */
  isUniqueVerified: boolean;
  uniqueExpiry: bigint | null;
  /** True if at least one tier is verified. */
  hasAnyVerification: boolean;
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
  accounts: TrackedAccount[];
  isLoading: boolean;
  refetch: () => void;
} {
  const chainId = useChainId();
  const { addresses } = useAccount();

  // Deduplicate wallet addresses and keep a stable order.
  // wagmi puts the active address first, which reshuffles the list on account switch.
  // We lock in the order on first load so the list stays stable and the green dot moves instead.
  const stableOrderRef = useRef<`0x${string}`[] | null>(null);
  const walletAddresses = useMemo<`0x${string}`[]>(() => {
    const deduped = addresses ? ([...new Set(addresses)] as `0x${string}`[]) : [];
    if (deduped.length === 0) {
      stableOrderRef.current = null;
      return [];
    }
    if (
      stableOrderRef.current === null ||
      stableOrderRef.current.length !== deduped.length ||
      !deduped.every((a) => stableOrderRef.current!.some((s) => s.toLowerCase() === a.toLowerCase()))
    ) {
      // New set of addresses (first load, or addresses added/removed) — snapshot the order
      stableOrderRef.current = deduped;
    }
    return stableOrderRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(addresses)]);

  const contractAddress = isSupportedChain(chainId)
    ? CONTRACT_ADDRESSES[chainId].verificationRegistry
    : '0x0000000000000000000000000000000000000000';

  const enabled = isSupportedChain(chainId) && walletAddresses.length > 0;

  // 4 reads per address: isVerified, isPrimaryVerified, getBaseExpiry, getPrimaryExpiry
  const contracts = useMemo(
    () =>
      walletAddresses.flatMap((address) => [
        { address: contractAddress, abi: VERIFICATION_REGISTRY_ABI, functionName: 'isVerified' as const, args: [address] as const },
        { address: contractAddress, abi: VERIFICATION_REGISTRY_ABI, functionName: 'isPrimaryVerified' as const, args: [address] as const },
        { address: contractAddress, abi: VERIFICATION_REGISTRY_ABI, functionName: 'getBaseExpiry' as const, args: [address] as const },
        { address: contractAddress, abi: VERIFICATION_REGISTRY_ABI, functionName: 'getPrimaryExpiry' as const, args: [address] as const },
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contractAddress, JSON.stringify(walletAddresses)],
  );

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled, staleTime: 0, gcTime: 0, refetchOnMount: 'always' },
  });

  const accounts = useMemo<TrackedAccount[]>(() =>
    walletAddresses.map((address, i) => {
      const isBaseVerified = (data?.[i * 4]?.result as boolean | undefined) ?? false;
      const isUniqueVerified = (data?.[i * 4 + 1]?.result as boolean | undefined) ?? false;
      const baseExpiry = (data?.[i * 4 + 2]?.result as bigint | undefined) ?? null;
      const uniqueExpiry = (data?.[i * 4 + 3]?.result as bigint | undefined) ?? null;
      return {
        address,
        shortAddress: `${address.slice(0, 6)}...${address.slice(-4)}`,
        isBaseVerified,
        baseExpiry,
        isUniqueVerified,
        uniqueExpiry,
        hasAnyVerification: isBaseVerified || isUniqueVerified,
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(walletAddresses), data],
  );

  return {
    accounts,
    isLoading,
    refetch: () => { void refetch(); },
  };
}
