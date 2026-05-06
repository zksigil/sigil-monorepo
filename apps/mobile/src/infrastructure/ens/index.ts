// ENS reverse name resolution against Ethereum mainnet. We do reverse lookups
// regardless of which chain the wallet is currently on — ENS names are
// universal identifiers, not chain-scoped. Failures (rate limits, network
// errors) are silent: we cache null and let the caller fall back to the hex
// address.

import { http, createPublicClient } from 'viem';
import { mainnet } from 'viem/chains';

const DEFAULT_MAINNET_RPC = 'https://eth.llamarpc.com';
const RPC_URL =
  process.env.EXPO_PUBLIC_ETH_MAINNET_RPC_URL ?? DEFAULT_MAINNET_RPC;

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

const cache = new Map<string, string | null>();

export async function resolveEnsName(address: `0x${string}`): Promise<string | null> {
  const key = address.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const name = await client.getEnsName({ address });
    cache.set(key, name);
    return name;
  } catch (err) {
    // Network / RPC errors are not interesting at the call site; cache as
    // miss so we don't retry inside the same session.
    console.log('[ENS] resolve failed:', address, err instanceof Error ? err.message : err);
    cache.set(key, null);
    return null;
  }
}
