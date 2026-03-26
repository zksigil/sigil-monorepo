import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { useAccount } from 'wagmi';
import type { RootStackRouteProp } from '../../../app/navigation/types';
import { useAccountStore } from '../store/accountStore';

export function AddAccountsScreen(): React.JSX.Element {
  const { params } = useRoute<RootStackRouteProp<'AddAccounts'>>();
  const { tier } = params;
  const { addresses } = useAccount();
  const accounts: readonly `0x${string}`[] = addresses ?? [];
  const { trackedEntries, addEntry, removeEntry } = useAccountStore();

  const tierLabel = tier === 'primary' ? 'Primary' : 'Base';

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
      <ScrollView className="flex-1 px-6 py-6" contentContainerStyle={{ gap: 12 }}>
        <Text className="text-zinc-400 text-sm mb-2">
          Select accounts to add to {tierLabel} verification.
        </Text>

        {accounts.length === 0 && (
          <View className="items-center py-12">
            <Text className="text-zinc-500 text-sm text-center">
              No accounts found.{'\n'}Connect a wallet first.
            </Text>
          </View>
        )}

        {accounts.map((addr) => {
          const isTracked = trackedEntries.some(
            (e) => e.address === addr && e.tier === tier,
          );
          const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

          return (
            <View
              key={addr}
              className="bg-zinc-900 rounded-2xl px-4 py-3 flex-row items-center justify-between"
            >
              <Text className="text-white text-sm font-mono flex-1">{short}</Text>

              <Pressable
                onPress={() =>
                  isTracked ? removeEntry(addr, tier) : addEntry(addr, tier)
                }
                className={[
                  'ml-4 px-4 py-1.5 rounded-lg',
                  isTracked
                    ? 'bg-zinc-700 active:bg-zinc-600'
                    : 'bg-indigo-600 active:bg-indigo-700',
                ].join(' ')}
              >
                <Text className="text-white text-xs font-semibold">
                  {isTracked ? 'Remove' : 'Add'}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
