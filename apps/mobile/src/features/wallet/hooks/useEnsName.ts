import { useEffect, useState } from 'react';
import { resolveEnsName } from '../../../infrastructure/ens';

/**
 * Resolves the ENS reverse name for an address against Ethereum mainnet.
 * Returns null while loading and on resolution failure — callers should
 * fall back to the hex address.
 */
export function useEnsName(address: `0x${string}` | undefined): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setName(null);
      return;
    }
    let mounted = true;
    void resolveEnsName(address).then((resolved) => {
      if (mounted) setName(resolved);
    });
    return () => {
      mounted = false;
    };
  }, [address]);

  return name;
}
