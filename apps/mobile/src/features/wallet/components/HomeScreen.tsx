import React, { useCallback } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { RootStackNavigationProp } from '../../../app/navigation/types';
import { useWalletConnection } from '../hooks/useWalletConnection';
import { useChainGuard } from '../hooks/useChainGuard';
import { useTrackedAccounts } from '../hooks/useTrackedAccounts';
import { AccountRow } from './AccountRow';

export function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<RootStackNavigationProp<'Home'>>();
  const { isConnected, isConnecting, connect, disconnect } = useWalletConnection();
  const { isWrongChain, switchToSepolia, switchToAnvil } = useChainGuard();
  const { baseAccounts, primaryAccounts, isLoading, refetch } = useTrackedAccounts();

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const handleDisconnect = useCallback(() => {
    Alert.alert('Disconnect', 'Disconnect your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: disconnect },
    ]);
  }, [disconnect]);

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 20, gap: 20 }}>

        {/* Network warnings (only when connected) */}
        {isConnected && isWrongChain && (
          <Pressable
            onPress={switchToSepolia}
            className="bg-yellow-900/30 border border-yellow-700 rounded-2xl p-4 items-center active:bg-yellow-900/50"
          >
            <Text className="text-yellow-400 text-sm font-medium">Wrong Network</Text>
            <Text className="text-yellow-500/80 text-xs mt-1">Tap to switch to Sepolia</Text>
          </Pressable>
        )}

        {process.env.EXPO_PUBLIC_DEV_BYPASS === 'true' && (
          <Pressable
            onPress={switchToAnvil}
            className="border border-amber-700/50 rounded-2xl p-3 items-center active:bg-amber-900/20"
          >
            <Text className="text-amber-500 text-xs font-medium">[DEV] Switch to Anvil (31337)</Text>
          </Pressable>
        )}

        {/* Primary section */}
        <View className="gap-y-3">
          <Text className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">
            Primary Account
          </Text>

          {isLoading ? (
            <ActivityIndicator color="#52525b" />
          ) : primaryAccounts.length === 0 ? (
            <View className="bg-zinc-900/50 rounded-2xl px-4 py-4 items-center">
              <Text className="text-zinc-600 text-sm">None added</Text>
            </View>
          ) : (
            primaryAccounts.map((account) => (
              <AccountRow
                key={account.address}
                account={account}
                onUnregistered={refetch}
              />
            ))
          )}

          {isConnected && (
            <Pressable
              onPress={() => navigation.navigate('AddAccounts', { tier: 'primary' })}
              className="border border-zinc-800 rounded-2xl py-3 items-center active:bg-zinc-900"
            >
              <Text className="text-zinc-500 text-sm">+ Add Primary Account</Text>
            </Pressable>
          )}
        </View>

        {/* Base section */}
        <View className="gap-y-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">
              Base Accounts
            </Text>
            {baseAccounts.length > 0 && (
              <Text className="text-zinc-600 text-xs">{baseAccounts.length}</Text>
            )}
          </View>

          {isLoading ? (
            <ActivityIndicator color="#52525b" />
          ) : baseAccounts.length === 0 ? (
            <View className="bg-zinc-900/50 rounded-2xl px-4 py-4 items-center">
              <Text className="text-zinc-600 text-sm">None added</Text>
            </View>
          ) : (
            baseAccounts.map((account) => (
              <AccountRow
                key={account.address}
                account={account}
                onUnregistered={refetch}
              />
            ))
          )}

          {isConnected && (
            <Pressable
              onPress={() => navigation.navigate('AddAccounts', { tier: 'base' })}
              className="border border-zinc-800 rounded-2xl py-3 items-center active:bg-zinc-900"
            >
              <Text className="text-zinc-500 text-sm">+ Add Account</Text>
            </Pressable>
          )}
        </View>

        <Text className="text-zinc-700 text-xs text-center leading-5">
          Your passport data never leaves your device.{'\n'}ZK proofs are generated locally.
        </Text>

        {/* Wallet button — always at bottom */}
        {isConnected ? (
          <Pressable
            onPress={handleDisconnect}
            className="w-full rounded-2xl py-3.5 items-center border border-zinc-700 active:bg-zinc-900"
          >
            <Text className="text-zinc-400 text-sm font-medium">Connected</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={connect}
            disabled={isConnecting}
            className={[
              'w-full rounded-2xl py-3.5 items-center justify-center',
              isConnecting ? 'bg-indigo-900' : 'bg-indigo-600 active:bg-indigo-700',
            ].join(' ')}
          >
            {isConnecting
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text className="text-white text-base font-semibold">Connect Wallet</Text>}
          </Pressable>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
