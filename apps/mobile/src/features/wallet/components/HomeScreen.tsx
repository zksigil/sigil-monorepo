import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAccount } from 'wagmi';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RootStackNavigationProp } from '../../../app/navigation/types';
import { useWalletConnection } from '../hooks/useWalletConnection';
import { useChainGuard } from '../hooks/useChainGuard';
import { useTrackedAccounts } from '../hooks/useTrackedAccounts';
import { useOpenWallet } from '../hooks/useOpenWallet';
import { AccountRow } from './AccountRow';

const FIRST_SIGILIZE_DISMISSED_KEY = 'sigil:first-sigilize-dismissed:v1';

export function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<RootStackNavigationProp<'Home'>>();
  const { isConnected, isConnecting, connect, disconnect } = useWalletConnection();
  const { isWrongChain, switchToBaseSepolia, switchToAnvil } = useChainGuard();
  const { accounts, isLoading, refetch } = useTrackedAccounts();
  const { address: activeAddress } = useAccount();
  const openWallet = useOpenWallet();

  const [pending, setPending] = useState<{ address: `0x${string}` } | null>(null);
  const [educationOpen, setEducationOpen] = useState(false);
  const [educationTarget, setEducationTarget] = useState<`0x${string}` | null>(null);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const handleDisconnect = useCallback(() => {
    Alert.alert('Disconnect', 'Disconnect your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: disconnect },
    ]);
  }, [disconnect]);

  // Number of already-sigilized accounts. If > 0, the user already understands the
  // linkability model; we skip the education modal on subsequent sigilizes.
  const sigilizedCount = accounts.filter((a) => a.isVerified).length;

  // Once the wallet has switched to the requested address, navigate.
  const proceedToScan = useCallback((address: `0x${string}`) => {
    if (activeAddress?.toLowerCase() === address.toLowerCase()) {
      navigation.navigate('PassportScan');
      return;
    }
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    setPending({ address });
    Alert.alert(
      'Switch Account',
      `Switch your active wallet account to ${short} to continue.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPending(null) },
        { text: 'Open Wallet', onPress: () => openWallet() },
      ],
    );
  }, [activeAddress, navigation, openWallet]);

  const handleSigilize = useCallback(async (address: `0x${string}`) => {
    // Show the education modal the first time, unless the user has dismissed it before
    // OR they already have at least one sigilized wallet (so they've seen the consequence).
    if (sigilizedCount === 0) {
      const dismissed = await AsyncStorage.getItem(FIRST_SIGILIZE_DISMISSED_KEY);
      if (!dismissed) {
        setEducationTarget(address);
        setEducationOpen(true);
        return;
      }
    }
    proceedToScan(address);
  }, [proceedToScan, sigilizedCount]);

  const handleEducationContinue = useCallback(async () => {
    await AsyncStorage.setItem(FIRST_SIGILIZE_DISMISSED_KEY, '1');
    const target = educationTarget;
    setEducationOpen(false);
    setEducationTarget(null);
    if (target) proceedToScan(target);
  }, [educationTarget, proceedToScan]);

  const handleEducationCancel = useCallback(() => {
    setEducationOpen(false);
    setEducationTarget(null);
  }, []);

  // Once the wallet switches to the pending address, proceed.
  React.useEffect(() => {
    if (pending && activeAddress?.toLowerCase() === pending.address.toLowerCase()) {
      setPending(null);
      navigation.navigate('PassportScan');
    }
  }, [activeAddress, pending, navigation]);

  return (
    <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 20, gap: 16 }}>

        {isConnected && isWrongChain && (
          <Pressable
            onPress={switchToBaseSepolia}
            className="bg-dracula-yellow/20 border border-dracula-yellow rounded-2xl p-4 items-center active:bg-dracula-yellow/30"
          >
            <Text className="text-dracula-yellow text-sm font-medium">Wrong Network</Text>
            <Text className="text-dracula-yellow/80 text-xs mt-1">Tap to switch to Base Sepolia</Text>
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
                linkedSiblings={accounts}
                onSigilize={handleSigilize}
                onUnregistered={refetch}
              />
            ))
          )}
        </View>

        <Text className="text-dracula-comment/40 text-xs text-center leading-5">
          Your passport data never leaves your device.{'\n'}ZK proofs are generated locally.
        </Text>

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

      {/* First-sigilize education modal — shown once, before the user's first sigilize. */}
      <Modal visible={educationOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={handleEducationCancel}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="bg-dracula-surface rounded-3xl px-6 py-7 w-full max-w-md gap-y-4">
            <Text className="text-dracula-fg text-lg font-bold">Sigilize this wallet?</Text>
            <Text className="text-dracula-comment text-sm leading-5">
              This wallet will be publicly tied to your passport identity. Other wallets you
              sigilize will share this identity on-chain — anyone can see they belong to the
              same person.
            </Text>
            <Text className="text-dracula-comment text-sm leading-5">
              Wallets you don't sigilize stay anonymous. Use a separate, non-sigilized wallet
              for activity you want to keep unconnected.
            </Text>
            <View className="flex-row gap-3 mt-2">
              <Pressable
                onPress={handleEducationCancel}
                className="flex-1 rounded-2xl py-3 items-center bg-dracula-surface/70 active:bg-dracula-comment/40"
              >
                <Text className="text-dracula-fg text-sm font-semibold">Not now</Text>
              </Pressable>
              <Pressable
                onPress={handleEducationContinue}
                className="flex-1 rounded-2xl py-3 items-center bg-dracula-purple active:bg-dracula-purple/80"
              >
                <Text className="text-dracula-fg text-sm font-semibold">Sigilize</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
