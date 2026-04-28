import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert, Modal } from 'react-native';
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

  // Tier selection modal state
  const [tierModalAddress, setTierModalAddress] = useState<`0x${string}` | null>(null);
  const [pendingVerifyAddress, setPendingVerifyAddress] = useState<`0x${string}` | null>(null);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const handleDisconnect = useCallback(() => {
    Alert.alert('Disconnect', 'Disconnect your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: disconnect },
    ]);
  }, [disconnect]);

  const hasExistingUnique = accounts.some((a) => a.isUniqueVerified);
  const existingPrimaryAddress = accounts.find((a) => a.isUniqueVerified)?.address ?? null;

  // Handle verify: ensure correct wallet is active, then show tier selector
  const handleVerify = useCallback((address: `0x${string}`) => {
    if (activeAddress?.toLowerCase() === address.toLowerCase()) {
      setTierModalAddress(address);
    } else {
      const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
      setPendingVerifyAddress(address);
      Alert.alert(
        'Switch Account',
        `Switch your active wallet account to ${short} to continue verification.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setPendingVerifyAddress(null) },
          { text: 'Open Wallet', onPress: () => openWallet() },
        ],
      );
    }
  }, [activeAddress, openWallet]);

  // When wallet switches to the pending address, show the tier modal
  React.useEffect(() => {
    if (pendingVerifyAddress && activeAddress?.toLowerCase() === pendingVerifyAddress.toLowerCase()) {
      setPendingVerifyAddress(null);
      setTierModalAddress(pendingVerifyAddress);
    }
  }, [activeAddress, pendingVerifyAddress]);

  const handleTierSelected = useCallback((tier: VerificationTier) => {
    setTierModalAddress(null);
    navigation.navigate('PassportScan', { tier });
  }, [navigation]);

  // Check which tiers are available for the address being verified
  const modalAccount = tierModalAddress
    ? accounts.find((a) => a.address.toLowerCase() === tierModalAddress.toLowerCase())
    : null;
  const canSelectUnique = modalAccount ? !modalAccount.isUniqueVerified && !hasExistingUnique : false;
  const canSelectBase = modalAccount ? !modalAccount.isBaseVerified : false;

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
                hasExistingUnique={hasExistingUnique}
                onVerify={handleVerify}
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

      {/* Tier selection modal */}
      <TierSelectionModal
        visible={tierModalAddress !== null}
        canSelectUnique={canSelectUnique}
        canSelectBase={canSelectBase}
        hasExistingUnique={hasExistingUnique}
        existingPrimaryAddress={existingPrimaryAddress}
        onSelect={handleTierSelected}
        onClose={() => setTierModalAddress(null)}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Tier Selection Modal
// ---------------------------------------------------------------------------

function TierSelectionModal({
  visible,
  canSelectUnique,
  canSelectBase,
  hasExistingUnique,
  existingPrimaryAddress,
  onSelect,
  onClose,
}: {
  visible: boolean;
  canSelectUnique: boolean;
  canSelectBase: boolean;
  hasExistingUnique: boolean;
  existingPrimaryAddress: `0x${string}` | null;
  onSelect: (tier: VerificationTier) => void;
  onClose: () => void;
}): React.JSX.Element {
  const primaryShort = existingPrimaryAddress
    ? `${existingPrimaryAddress.slice(0, 6)}…${existingPrimaryAddress.slice(-4)}`
    : null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="bg-dracula-surface rounded-t-3xl px-6 pt-6 pb-10">
          <Text className="text-dracula-fg text-lg font-bold text-center mb-2">
            How do you want to verify?
          </Text>
          <Text className="text-dracula-comment/70 text-xs text-center mb-6">
            Choose a verification tier for this account.
          </Text>

          {/* Unique tier */}
          <Pressable
            onPress={() => canSelectUnique && onSelect('unique')}
            disabled={!canSelectUnique}
            className={[
              'rounded-2xl p-4 mb-3 border',
              canSelectUnique
                ? 'border-dracula-purple/50 bg-dracula-purple/10 active:bg-dracula-purple/20'
                : 'border-dracula-comment/20 bg-dracula-bg/50 opacity-50',
            ].join(' ')}
          >
            <Text className={`text-base font-semibold mb-1 ${canSelectUnique ? 'text-dracula-purple' : 'text-dracula-comment/50'}`}>
              Unique
            </Text>
            <Text className="text-dracula-comment text-xs leading-5">
              One account per passport. Proves you're a real person and that this is your only address with this status.
            </Text>
            {canSelectUnique && (
              <View className="mt-3 rounded-xl bg-dracula-yellow/10 border border-dracula-yellow/30 p-3">
                <Text className="text-dracula-yellow text-xs font-semibold mb-1">
                  Heads up: Unique addresses are linkable
                </Text>
                <Text className="text-dracula-comment text-xs leading-5">
                  If you ever switch your Unique address (unregister, wait 7 days, then re-register
                  from a different account), the old and new addresses will be publicly linked
                  on-chain as belonging to the same passport. Pick Verified instead if you want
                  multiple accounts that can't be linked to each other.
                </Text>
              </View>
            )}
            {!canSelectUnique && hasExistingUnique && (
              <View className="mt-3 rounded-xl bg-dracula-yellow/10 border border-dracula-yellow/30 p-3">
                <Text className="text-dracula-yellow text-xs font-semibold mb-1">
                  Primary already registered{primaryShort ? ` to ${primaryShort}` : ''}
                </Text>
                <Text className="text-dracula-comment text-xs leading-5">
                  Only one address per passport can be primary. To switch primary to this account,
                  unregister {primaryShort ?? 'the existing primary address'} on its account row,
                  wait 7 days for cooldown, then verify this account as Unique.
                </Text>
              </View>
            )}
          </Pressable>

          {/* Verified tier */}
          <Pressable
            onPress={() => canSelectBase && onSelect('verified')}
            disabled={!canSelectBase}
            className={[
              'rounded-2xl p-4 mb-6 border',
              canSelectBase
                ? 'border-dracula-green/50 bg-dracula-green/10 active:bg-dracula-green/20'
                : 'border-dracula-comment/20 bg-dracula-bg/50 opacity-50',
            ].join(' ')}
          >
            <Text className={`text-base font-semibold mb-1 ${canSelectBase ? 'text-dracula-green' : 'text-dracula-comment/50'}`}>
              Verified
            </Text>
            <Text className="text-dracula-comment text-xs leading-5">
              Multiple accounts allowed. Proves you're a real person.
            </Text>
          </Pressable>

          {/* Cancel */}
          <Pressable
            onPress={onClose}
            className="rounded-2xl py-3.5 items-center border border-dracula-comment/30 active:bg-dracula-bg"
          >
            <Text className="text-dracula-comment text-sm font-medium">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
