import { createPublicClient, http, type PublicClient } from 'viem';
import { anvil, baseSepolia, base } from 'viem/chains';
import { RPC_URLS } from './appKitConfig';

/**
 * Standalone viem PublicClient per supported chain. Bypasses wagmi /
 * WalletConnect transport so on-chain reads stay reliable when the app
 * returns from background (the WC session-check path can stall in that case).
 *
 * Cached per chainId — repeated calls return the same instance instead of
 * spinning up a fresh client each time. RPC URLs are read once from
 * EXPO_PUBLIC_* env (baked into the JS bundle at build time), so the
 * cache never goes stale at runtime.
 */

const CHAIN_CONFIG = {
  [anvil.id]: { chain: anvil, rpc: RPC_URLS[anvil.id] },
  [baseSepolia.id]: { chain: baseSepolia, rpc: RPC_URLS[baseSepolia.id] },
  [base.id]: { chain: base, rpc: RPC_URLS[base.id] },
} as const;

type SupportedChainId = keyof typeof CHAIN_CONFIG;

const clientCache = new Map<number, PublicClient>();

export function getPublicClient(chainId: number): PublicClient | null {
  const cached = clientCache.get(chainId);
  if (cached) return cached;
  const cfg = CHAIN_CONFIG[chainId as SupportedChainId];
  if (!cfg) return null;
  const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) }) as PublicClient;
  clientCache.set(chainId, client);
  return client;
}
