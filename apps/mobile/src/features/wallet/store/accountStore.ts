import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TrackedEntry {
  address: `0x${string}`;
  tier: 'base' | 'primary';
}

interface AccountStore {
  trackedEntries: TrackedEntry[];
  // Nullifiers for primary-tier accounts (needed for unregisterPrimary)
  primaryNullifiers: Record<`0x${string}`, `0x${string}`>;

  addEntry: (address: `0x${string}`, tier: 'base' | 'primary') => void;
  removeEntry: (address: `0x${string}`, tier: 'base' | 'primary') => void;
  setPrimaryNullifier: (address: `0x${string}`, nullifier: `0x${string}`) => void;
  clearPrimaryNullifier: (address: `0x${string}`) => void;
}

export const useAccountStore = create<AccountStore>()(
  persist(
    (set) => ({
      trackedEntries: [],
      primaryNullifiers: {},

      addEntry: (address, tier) =>
        set((state) => {
          const exists = state.trackedEntries.some(
            (e) => e.address === address && e.tier === tier,
          );
          return exists
            ? state
            : { trackedEntries: [...state.trackedEntries, { address, tier }] };
        }),

      removeEntry: (address, tier) =>
        set((state) => ({
          trackedEntries: state.trackedEntries.filter(
            (e) => !(e.address === address && e.tier === tier),
          ),
        })),

      setPrimaryNullifier: (address, nullifier) =>
        set((state) => ({
          primaryNullifiers: { ...state.primaryNullifiers, [address]: nullifier },
        })),

      clearPrimaryNullifier: (address) =>
        set((state) => {
          const { [address]: _, ...rest } = state.primaryNullifiers;
          return { primaryNullifiers: rest };
        }),
    }),
    {
      name: '@zkid/accounts',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
