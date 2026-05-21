import { useCallback, useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Persisted list of wallet addresses the user wants to see on Home but which
// are not currently in their connected wallet's authorized accounts. Typical
// source: the AddressDiscovery flow surfacing addresses sigilized under their
// passport that they want to keep an eye on.
//
// Stored as JSON array of lowercase 0x-hex strings. Lowercased on write so
// equality checks against wagmi addresses are simple.
//
// State lives at module scope so every component that calls the hook shares
// one source of truth. Without this, AccountRow's `remove(...)` would update
// its own local state and AsyncStorage, but useTrackedAccounts (the hook
// driving HomeScreen's list) would not re-render until the next mount.

const STORAGE_KEY = 'sigil:tracked-external-addresses:v1';

type Addr = `0x${string}`;

function isAddr(value: unknown): value is Addr {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
}

// ---------------------------------------------------------------------------
// Module-level store
// ---------------------------------------------------------------------------

interface Snapshot {
  addresses: readonly Addr[];
  isHydrated: boolean;
}

// Frozen object identity is what useSyncExternalStore checks for change;
// any mutation must produce a new object reference.
let snapshot: Snapshot = { addresses: [], isHydrated: false };
const listeners = new Set<() => void>();

function getSnapshot(): Snapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setSnapshot(next: Snapshot): void {
  snapshot = next;
  for (const l of listeners) l();
}

// Hydrate once, on first hook mount. Subsequent mounts skip the read.
let hydratePromise: Promise<void> | null = null;

function hydrate(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      let loaded: Addr[] = [];
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) loaded = parsed.filter(isAddr);
      }
      setSnapshot({ addresses: loaded, isHydrated: true });
    } catch {
      setSnapshot({ addresses: [], isHydrated: true });
    }
  })();
  return hydratePromise;
}

async function persist(addresses: readonly Addr[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
}

async function addToStore(address: `0x${string}`): Promise<void> {
  const lower = address.toLowerCase() as Addr;
  if (!isAddr(lower)) return;
  if (snapshot.addresses.includes(lower)) return;
  const next = [...snapshot.addresses, lower];
  setSnapshot({ ...snapshot, addresses: next });
  await persist(next);
}

async function removeFromStore(address: `0x${string}`): Promise<void> {
  const lower = address.toLowerCase() as Addr;
  if (!snapshot.addresses.includes(lower)) return;
  const next = snapshot.addresses.filter((a) => a !== lower);
  setSnapshot({ ...snapshot, addresses: next });
  await persist(next);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseTrackedExternalAddresses {
  addresses: readonly Addr[];
  /** False on first render before AsyncStorage has been read; true thereafter. */
  isHydrated: boolean;
  /** Add an address. Lowercases and dedupes; no-op if already present. */
  add: (address: `0x${string}`) => Promise<void>;
  /** Remove an address. No-op if not present. */
  remove: (address: `0x${string}`) => Promise<void>;
}

export function useTrackedExternalAddresses(): UseTrackedExternalAddresses {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void hydrate();
  }, []);

  const add = useCallback((address: `0x${string}`) => addToStore(address), []);
  const remove = useCallback((address: `0x${string}`) => removeFromStore(address), []);

  return {
    addresses: current.addresses,
    isHydrated: current.isHydrated,
    add,
    remove,
  };
}
