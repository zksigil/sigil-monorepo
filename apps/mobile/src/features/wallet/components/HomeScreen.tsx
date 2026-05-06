import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAccount, useChainId } from 'wagmi';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RegistrationMode, RootStackNavigationProp } from '../../../app/navigation/types';
import { useWalletConnection } from '../hooks/useWalletConnection';
import { useChainGuard } from '../hooks/useChainGuard';
import { useTrackedAccounts } from '../hooks/useTrackedAccounts';
import { useOpenWallet } from '../hooks/useOpenWallet';
import { AccountRow } from './AccountRow';
import { PreConnectInfo } from './PreConnectInfo';
import { CHAIN_DISPLAY_NAMES } from '../../../shared/constants/chains';

const FIRST_SIGILIZE_DISMISSED_KEY = 'sigil:first-sigilize-dismissed:v1';

export function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<RootStackNavigationProp<'Home'>>();
  const { isConnected, isConnecting, connect, disconnect } = useWalletConnection();
  const { isWrongChain, switchToBaseSepolia, switchToAnvil } = useChainGuard();
  const { accounts, isLoading, refetch } = useTrackedAccounts();
  const { address: activeAddress } = useAccount();
  const chainId = useChainId();
  const chainName = CHAIN_DISPLAY_NAMES[chainId] ?? `Chain ${chainId}`;
  const openWallet = useOpenWallet();

  // Tapping the connected pill offers both available actions: switching the
  // active account (which is wallet-side, so we deep-link the user out) and
  // disconnecting the WalletConnect session entirely.
  const handleManageWallet = useCallback(() => {
    Alert.alert(
      'Manage Connection',
      undefined,
      [
        { text: 'Change active account', onPress: openWallet },
        { text: 'Disconnect', style: 'destructive', onPress: disconnect },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [openWallet, disconnect]);

  const [pending, setPending] = useState<{ address: `0x${string}`; mode: RegistrationMode } | null>(null);
  const [educationOpen, setEducationOpen] = useState(false);
  const [educationTarget, setEducationTarget] = useState<{ address: `0x${string}`; mode: RegistrationMode } | null>(null);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  // Number of already-sigilized accounts. If > 0, the user already understands the
  // linkability model; we skip the education modal on subsequent sigilizes.
  const sigilizedCount = accounts.filter((a) => a.isVerified).length;

  // Once the wallet has switched to the requested address, navigate.
  const proceedToScan = useCallback((address: `0x${string}`, mode: RegistrationMode) => {
    if (activeAddress?.toLowerCase() === address.toLowerCase()) {
      navigation.navigate('PassportScan', { mode });
      return;
    }
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    setPending({ address, mode });
    Alert.alert(
      'Switch Account',
      `Switch your active wallet account to ${short} to continue.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPending(null) },
        { text: 'Open Wallet', onPress: () => openWallet() },
      ],
    );
  }, [activeAddress, navigation, openWallet]);

  const handleSigilize = useCallback(async (address: `0x${string}`, mode: RegistrationMode) => {
    // Education modal only on the user's *first* fresh registration. Renewals
    // and re-sigilizes always skip it — user has already seen the consequence.
    if (mode === 'register' && sigilizedCount === 0) {
      const dismissed = await AsyncStorage.getItem(FIRST_SIGILIZE_DISMISSED_KEY);
      if (!dismissed) {
        setEducationTarget({ address, mode });
        setEducationOpen(true);
        return;
      }
    }
    proceedToScan(address, mode);
  }, [proceedToScan, sigilizedCount]);

  const handleEducationContinue = useCallback(async () => {
    await AsyncStorage.setItem(FIRST_SIGILIZE_DISMISSED_KEY, '1');
    const target = educationTarget;
    setEducationOpen(false);
    setEducationTarget(null);
    if (target) proceedToScan(target.address, target.mode);
  }, [educationTarget, proceedToScan]);

  const handleEducationCancel = useCallback(() => {
    setEducationOpen(false);
    setEducationTarget(null);
  }, []);

  // Once the wallet switches to the pending address, proceed.
  React.useEffect(() => {
    if (pending && activeAddress?.toLowerCase() === pending.address.toLowerCase()) {
      const { mode } = pending;
      setPending(null);
      navigation.navigate('PassportScan', { mode });
    }
  }, [activeAddress, pending, navigation]);

  return (
    <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 20, paddingBottom: 24, gap: 16 }}
      >

        {isConnected && isWrongChain && (
          <Pressable
            onPress={switchToBaseSepolia}
            className="bg-dracula-yellow/20 border border-dracula-yellow rounded-2xl p-4 items-center active:bg-dracula-yellow/30"
          >
            <Text className="text-dracula-yellow text-sm font-medium">Wrong Network</Text>
            <Text className="text-dracula-yellow/80 text-xs mt-1">
              On {chainName} — tap to switch to Base Sepolia
            </Text>
          </Pressable>
        )}

        {isConnected && !isWrongChain && (
          <View className="flex-row items-center justify-center gap-x-1.5">
            <View className="w-1.5 h-1.5 rounded-full bg-dracula-green" />
            <Text className="text-dracula-comment/60 text-[11px] font-medium">{chainName}</Text>
          </View>
        )}

        {process.env.EXPO_PUBLIC_DEV_BYPASS === 'true' && (
          <Pressable
            onPress={switchToAnvil}
            className="border border-dracula-orange/50 rounded-2xl p-3 items-center active:bg-dracula-orange/20"
          >
            <Text className="text-dracula-orange text-xs font-medium">[DEV] Switch to Anvil (31337)</Text>
          </Pressable>
        )}

        {!isConnected && <PreConnectInfo />}

        {isConnected && (
          <View className="gap-y-3">
            <Text className="text-dracula-comment/70 text-xs font-semibold uppercase tracking-widest">
              Accounts
            </Text>

            {isLoading ? (
              <ActivityIndicator color="#6272a4" />
            ) : accounts.length === 0 ? (
              <View className="bg-dracula-surface/50 rounded-2xl px-4 py-6 items-center">
                <Text className="text-dracula-comment/50 text-sm">
                  No accounts found in wallet
                </Text>
              </View>
            ) : (
              accounts.map((account) => (
                <AccountRow
                  key={account.address}
                  account={account}
                  linkedSiblings={accounts}
                  isActive={activeAddress?.toLowerCase() === account.address.toLowerCase()}
                  onSigilize={handleSigilize}
                  onUnregistered={refetch}
                />
              ))
            )}
          </View>
        )}

        {isConnected && (
          <Text className="text-dracula-comment/40 text-xs text-center leading-5">
            Your passport data never leaves your device.{'\n'}ZK proofs are generated locally.
          </Text>
        )}

        {/* Recovery / discovery entry point. Tap passport → derive nullifier → list
            wallets registered under it. No tx, no proof. Useful when migrating
            phones or just confirming what's sigilized. */}
        <Pressable
          onPress={() => navigation.navigate('PassportScan', { mode: 'discover' })}
          className="w-full rounded-2xl py-3.5 items-center border border-dracula-purple/40 active:bg-dracula-purple/10"
        >
          <Text className="text-dracula-purple text-sm font-semibold">
            Find my sigilized wallets
          </Text>
          <Text className="text-dracula-comment/60 text-[11px] mt-0.5">
            Tap your passport — no transaction
          </Text>
        </Pressable>
      </ScrollView>

      {/* Fixed footer — single button slot. Connected state is a two-line
          purple pill: status on top, available actions (change account /
          disconnect) on the subtitle. Tapping opens an Alert with both
          options. The address itself is intentionally NOT shown here since
          the accounts list above already surfaces it. */}
      <View
        className="px-6 pt-3 pb-2 border-t border-dracula-comment/15"
        style={{ backgroundColor: '#282a36' }}
      >
        {isConnected ? (
          <Pressable
            onPress={handleManageWallet}
            className="w-full rounded-2xl py-3 items-center bg-dracula-purple active:bg-dracula-purple/80"
          >
            <Text className="text-dracula-fg text-base font-semibold">Connected</Text>
            <Text className="text-dracula-fg/65 text-[11px] mt-0.5">
              Change account · Disconnect
            </Text>
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
      </View>

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
