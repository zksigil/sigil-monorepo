import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useChainId, useAccount } from 'wagmi';
import { createPublicClient, http } from 'viem';
import { anvil, baseSepolia, base } from 'viem/chains';
import { RPC_URLS } from '../../../infrastructure/blockchain/appKitConfig';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';

export interface TrackedAccount {
  address: `0x${string}`;
  shortAddress: string;
  /** True if this wallet has an active sigil registration. */
  isVerified: boolean;
  /** Sigil expiry (0 if never registered). */
  expiry: bigint | null;
  /** The passport nullifier this wallet is registered under (zero hash if none). */
  nullifier: `0x${string}` | null;
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

const ZERO_NULLIFIER = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

// ---------------------------------------------------------------------------
// Standalone viem clients — bypass wagmi/WalletConnect transport so reads
// work reliably even when the app returns from background.
// ---------------------------------------------------------------------------

const CHAIN_CONFIG = {
  31337: { chain: anvil, rpc: RPC_URLS[anvil.id] },
  84532: { chain: baseSepolia, rpc: RPC_URLS[baseSepolia.id] },
  8453: { chain: base, rpc: RPC_URLS[base.id] },
} as const;

function getPublicClient(chainId: number) {
  const cfg = CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG];
  if (!cfg) return null;
  return createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTrackedAccounts(): {
  accounts: TrackedAccount[];
  isLoading: boolean;
  refetch: () => void;
} {
  const chainId = useChainId();
  const { addresses } = useAccount();

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
      stableOrderRef.current = deduped;
    }
    return stableOrderRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(addresses)]);

  const [accounts, setAccounts] = useState<TrackedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasFetchedRef = useRef(false);
  const fetchIdRef = useRef(0);

  const fetchStatus = useCallback(async () => {
    if (!isSupportedChain(chainId) || walletAddresses.length === 0) {
      setAccounts(walletAddresses.map((addr) => ({
        address: addr,
        shortAddress: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
        isVerified: false,
        expiry: null,
        nullifier: null,
      })));
      setIsLoading(false);
      return;
    }

    const client = getPublicClient(chainId);
    if (!client) { setIsLoading(false); return; }

    const contractAddress = CONTRACT_ADDRESSES[chainId].verificationRegistry;
    if (contractAddress === '0x0000000000000000000000000000000000000000') { setIsLoading(false); return; }

    const id = ++fetchIdRef.current;
    if (!hasFetchedRef.current) setIsLoading(true);

    try {
      const results = await Promise.all(
        walletAddresses.map(async (addr): Promise<TrackedAccount> => {
          const [verified, expiry, nullifier] = await Promise.all([
            client.readContract({
              address: contractAddress,
              abi: VERIFICATION_REGISTRY_ABI,
              functionName: 'isVerified',
              args: [addr],
            }).catch(() => false as boolean),
            client.readContract({
              address: contractAddress,
              abi: VERIFICATION_REGISTRY_ABI,
              functionName: 'getExpiry',
              args: [addr],
            }).catch(() => null as bigint | null),
            client.readContract({
              address: contractAddress,
              abi: VERIFICATION_REGISTRY_ABI,
              functionName: 'nullifierOf',
              args: [addr],
            }).catch(() => null as `0x${string}` | null),
          ]);

          const nullifierVal = nullifier as `0x${string}` | null;
          return {
            address: addr,
            shortAddress: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
            isVerified: verified as boolean,
            expiry: expiry as bigint | null,
            nullifier: nullifierVal && nullifierVal !== ZERO_NULLIFIER ? nullifierVal : null,
          };
        }),
      );

      if (id === fetchIdRef.current) {
        hasFetchedRef.current = true;
        setAccounts(results);
      }
    } catch (err) {
      console.error('[ACCOUNTS] Failed to fetch verification status:', err);
    } finally {
      if (id === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [chainId, walletAddresses]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void fetchStatus();
      }
    });
    return () => sub.remove();
  }, [fetchStatus]);

  return {
    accounts,
    isLoading,
    refetch: () => { void fetchStatus(); },
  };
}
