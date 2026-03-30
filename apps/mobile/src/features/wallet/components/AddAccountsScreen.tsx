import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccount } from 'wagmi';
import { useAccountStore } from '../store/accountStore';

export function AddAccountsScreen(): React.JSX.Element {
  const { addresses } = useAccount();
  const accounts: readonly `0x${string}`[] = addresses
    ? ([...new Set(addresses)] as `0x${string}`[])
    : [];
  const { trackedAddresses, addAddress, removeAddress } = useAccountStore();

  return (
    <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
      <ScrollView className="flex-1 px-6 py-6" contentContainerStyle={{ gap: 12 }}>
        <Text className="text-dracula-comment text-sm mb-2">
          Select accounts to track for verification.
        </Text>

        {accounts.length === 0 && (
          <View className="items-center py-12">
            <Text className="text-dracula-comment/70 text-sm text-center">
              No accounts found.{'\n'}Connect a wallet first.
            </Text>
          </View>
        )}

        {accounts.map((addr) => {
          const isTracked = trackedAddresses.some(
            (a) => a.toLowerCase() === addr.toLowerCase(),
          );
          const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

          return (
            <View
              key={addr}
              className="bg-dracula-surface rounded-2xl px-4 py-3 flex-row items-center justify-between"
            >
              <Text className="text-dracula-fg text-sm font-mono flex-1">{short}</Text>

              <Pressable
                onPress={() =>
                  isTracked ? removeAddress(addr) : addAddress(addr)
                }
                className={[
                  'ml-4 px-4 py-1.5 rounded-lg',
                  isTracked
                    ? 'bg-dracula-comment/40 active:bg-dracula-comment/60'
                    : 'bg-dracula-purple active:bg-dracula-purple/80',
                ].join(' ')}
              >
                <Text className="text-dracula-fg text-xs font-semibold">
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
