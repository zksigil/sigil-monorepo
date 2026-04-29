import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAccount, useChainId } from 'wagmi';
import type { RootStackNavigationProp } from '../../../app/navigation/types';
import type { VerificationTier } from '../../../app/navigation/types';
import { useWalletConnection } from '../hooks/useWalletConnection';
import { useChainGuard } from '../hooks/useChainGuard';
import { useTrackedAccounts } from '../hooks/useTrackedAccounts';
import { useOpenWallet } from '../hooks/useOpenWallet';
import { AccountRow } from './AccountRow';

export function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<RootStackNavigationProp<'Home'>>();
  const { isConnected, isConnecting, connect, disconnect } = useWalletConnection();
  const { isWrongChain, switchToSepolia, switchToAnvil } = useChainGuard();
  const { accounts, isLoading, refetch } = useTrackedAccounts();
  const { address: activeAddress } = useAccount();
  const chainId = useChainId();
  const openWallet = useOpenWallet();

  // Tracks an address waiting for the user to switch their active wallet account
  // before we proceed with the requested action.
  const [pending, setPending] = useState<{ address: `0x${string}`; tier: VerificationTier } | null>(null);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const handleDisconnect = useCallback(() => {
    Alert.alert('Disconnect', 'Disconnect your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: disconnect },
    ]);
  }, [disconnect]);

  const hasExistingSigilized = accounts.some((a) => a.isUniqueVerified);

  // Common: ensure the requested wallet is the active one, then navigate.
  const startFlow = useCallback((address: `0x${string}`, tier: VerificationTier) => {
    if (activeAddress?.toLowerCase() === address.toLowerCase()) {
      navigation.navigate('PassportScan', { tier });
      return;
    }
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    setPending({ address, tier });
    Alert.alert(
      'Switch Account',
      `Switch your active wallet account to ${short} to continue.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPending(null) },
        { text: 'Open Wallet', onPress: () => openWallet() },
      ],
    );
  }, [activeAddress, navigation, openWallet]);

  const handleVerify = useCallback((address: `0x${string}`) => {
    startFlow(address, 'verified');
  }, [startFlow]);

  const handleSigilize = useCallback((address: `0x${string}`) => {
    startFlow(address, 'unique');
  }, [startFlow]);

  // Once the wallet switches to the pending address, kick off the deferred flow.
  React.useEffect(() => {
    if (pending && activeAddress?.toLowerCase() === pending.address.toLowerCase()) {
      const { tier } = pending;
      setPending(null);
      navigation.navigate('PassportScan', { tier });
    }
  }, [activeAddress, pending, navigation]);

  return (
    <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 20, gap: 16 }}>

        {/* Network warnings (only when connected) */}
        {isConnected && isWrongChain && (
          <Pressable
            onPress={switchToSepolia}
            className="bg-dracula-yellow/20 border border-dracula-yellow rounded-2xl p-4 items-center active:bg-dracula-yellow/30"
          >
            <Text className="text-dracula-yellow text-sm font-medium">Wrong Network</Text>
            <Text className="text-dracula-yellow/80 text-xs mt-1">Tap to switch to Sepolia</Text>
          </Pressable>
        )}

        {process.env.EXPO_PUBLIC_DEV_BYPASS === 'true' && (
          <Pressable
            onPress={switchToAnvil}
            className="border border-dracula-orange/50 rounded-2xl p-3 items-center active:bg-dracula-orange/20"
          >
            <Text className="text-dracula-orange text-xs font-medium">[DEV] Switch to Anvil (31337)</Text>
          </Pressable>
        )}

        {/* Accounts list */}
        <View className="gap-y-3">
          <Text className="text-dracula-comment/70 text-xs font-semibold uppercase tracking-widest">
            Accounts
          </Text>

          {isLoading ? (
            <ActivityIndicator color="#6272a4" />
          ) : accounts.length === 0 ? (
            <View className="bg-dracula-surface/50 rounded-2xl px-4 py-6 items-center">
              <Text className="text-dracula-comment/50 text-sm">
                {isConnected ? 'No accounts found in wallet' : 'Connect a wallet to get started'}
              </Text>
            </View>
          ) : (
            accounts.map((account) => (
              <AccountRow
                key={account.address}
                account={account}
                hasExistingSigilized={hasExistingSigilized}
                onVerify={handleVerify}
                onSigilize={handleSigilize}
                onUnregistered={refetch}
              />
            ))
          )}

        </View>

        <Text className="text-dracula-comment/40 text-xs text-center leading-5">
          Your passport data never leaves your device.{'\n'}ZK proofs are generated locally.
        </Text>

        {/* Wallet button */}
        {isConnected ? (
          <Pressable
            onPress={handleDisconnect}
            className="w-full rounded-2xl py-3.5 items-center border border-dracula-comment/40 active:bg-dracula-bg"
          >
            <Text className="text-dracula-comment text-sm font-medium">Connected</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={connect}
            disabled={isConnecting}
            className={[
              'w-full rounded-2xl py-3.5 items-center justify-center',
              isConnecting ? 'bg-dracula-purple/30' : 'bg-dracula-purple active:bg-dracula-purple/80',
            ].join(' ')}
          >
            {isConnecting
              ? <ActivityIndicator color="#f8f8f2" />
              : <Text className="text-dracula-fg text-base font-semibold">Connect Wallet</Text>}
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
