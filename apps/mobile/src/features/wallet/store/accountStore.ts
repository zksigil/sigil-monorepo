import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AccountStore {
  /** Tracked wallet addresses (tier-agnostic — tier is chosen at verify time). */
  trackedAddresses: `0x${string}`[];

  addAddress: (address: `0x${string}`) => void;
  removeAddress: (address: `0x${string}`) => void;
}

export const useAccountStore = create<AccountStore>()(
  persist(
    (set) => ({
      trackedAddresses: [],

      addAddress: (address) =>
        set((state) => {
          const exists = state.trackedAddresses.some(
            (a) => a.toLowerCase() === address.toLowerCase(),
          );
          return exists
            ? state
            : { trackedAddresses: [...state.trackedAddresses, address] };
        }),

      removeAddress: (address) =>
        set((state) => ({
          trackedAddresses: state.trackedAddresses.filter(
            (a) => a.toLowerCase() !== address.toLowerCase(),
          ),
        })),
    }),
    {
      name: '@zkid/accounts',
      storage: createJSONStorage(() => AsyncStorage),
      // Migrate from old schema (trackedEntries with tier) to new (trackedAddresses)
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version === 0 && state['trackedEntries'] && !state['trackedAddresses']) {
          const entries = state['trackedEntries'] as { address: `0x${string}`; tier: string }[];
          const uniqueAddresses = [...new Set(entries.map((e) => e.address))];
          return {
            ...state,
            trackedAddresses: uniqueAddresses,
            trackedEntries: undefined,
          };
        }
        return state;
      },
      version: 1,
    },
  ),
);
