import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Persisted list of wallet addresses the user wants to see on Home but which
// are not currently in their connected wallet's authorized accounts. Typical
// source: the WalletDiscovery flow surfacing wallets sigilized under their
// passport that they want to keep an eye on.
//
// Stored as JSON array of lowercase 0x-hex strings. Lowercased on write so
// equality checks against wagmi addresses are simple.

const STORAGE_KEY = 'sigil:tracked-external-addresses:v1';

type Addr = `0x${string}`;

function isAddr(value: unknown): value is Addr {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
}

async function load(): Promise<Addr[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAddr);
  } catch {
    return [];
  }
}

async function save(addresses: Addr[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
}

export interface UseTrackedExternalAddresses {
  addresses: Addr[];
  /** False on first render before AsyncStorage has been read; true thereafter. */
  isHydrated: boolean;
  /** Add an address. Lowercases and dedupes; no-op if already present. */
  add: (address: `0x${string}`) => Promise<void>;
  /** Remove an address. No-op if not present. */
  remove: (address: `0x${string}`) => Promise<void>;
}

export function useTrackedExternalAddresses(): UseTrackedExternalAddresses {
  const [addresses, setAddresses] = useState<Addr[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    void load().then((loaded) => {
      setAddresses(loaded);
      setIsHydrated(true);
    });
  }, []);

  const add = useCallback(async (address: `0x${string}`) => {
    const lower = address.toLowerCase() as Addr;
    if (!isAddr(lower)) return;
    setAddresses((prev) => {
      if (prev.includes(lower)) return prev;
      const next = [...prev, lower];
      void save(next);
      return next;
    });
  }, []);

  const remove = useCallback(async (address: `0x${string}`) => {
    const lower = address.toLowerCase() as Addr;
    setAddresses((prev) => {
      if (!prev.includes(lower)) return prev;
      const next = prev.filter((a) => a !== lower);
      void save(next);
      return next;
    });
  }, []);

  return { addresses, isHydrated, add, remove };
}
