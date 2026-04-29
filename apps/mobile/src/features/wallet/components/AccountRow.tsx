import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { useOpenWallet } from '../hooks/useOpenWallet';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';
import { formatQuarter } from '../hooks/useTrackedAccounts';
import type { TrackedAccount } from '../hooks/useTrackedAccounts';

interface AccountRowProps {
  account: TrackedAccount;
  /** Whether any tracked address is already Sigilized. */
  hasExistingSigilized: boolean;
  onVerify: (address: `0x${string}`) => void;
  onSigilize: (address: `0x${string}`) => void;
  onUnregistered: () => void;
}

function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function AccountRow({ account, hasExistingSigilized, onVerify, onSigilize, onUnregistered }: AccountRowProps): React.JSX.Element {
  const { address: activeAddress } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const openWallet = useOpenWallet();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  // Tracks an unregister request that's waiting for the user to switch their
  // active wallet account before we surface the confirmation dialog.
  const [pendingUnregister, setPendingUnregister] = useState<'base' | 'primary' | null>(null);

  const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    pollingInterval: 1000,
  });

  useEffect(() => {
    if (isConfirmed && txHash) {
      onUnregistered();
    }
  }, [isConfirmed, txHash, onUnregistered]);

  const contractAddress = isSupportedChain(chainId)
    ? CONTRACT_ADDRESSES[chainId].verificationRegistry
    : null;

  // --- Unregister ---
  const submitUnregister = useCallback((tier: 'base' | 'primary') => {
    if (!contractAddress) return;

    const fnName = tier === 'base' ? 'unregisterBase' : 'unregisterPrimary';
    writeContractAsync({
      address: contractAddress,
      abi: VERIFICATION_REGISTRY_ABI,
      functionName: fnName,
    }).then(setTxHash).catch(() => {
      Alert.alert('Error', 'Transaction failed. Please try again.');
    });
  }, [contractAddress, writeContractAsync]);

  const promptUnregisterConfirm = useCallback((tier: 'base' | 'primary') => {
    const label = tier === 'primary' ? 'Sigilized' : 'Verified';
    const body = tier === 'primary'
      ? `Remove Sigilized status from ${account.shortAddress}? You'll need to wait the cooldown period before re-Sigilizing any account with this passport.`
      : `Remove ${account.shortAddress} from ${label} verification?`;
    Alert.alert(
      'Unregister',
      body,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unregister', style: 'destructive', onPress: () => submitUnregister(tier) },
      ],
    );
  }, [account.shortAddress, submitUnregister]);

  const handleUnregister = useCallback((tier: 'base' | 'primary') => {
    if (activeAddress?.toLowerCase() === account.address.toLowerCase()) {
      promptUnregisterConfirm(tier);
      return;
    }
    setPendingUnregister(tier);
    Alert.alert(
      'Switch Account',
      `Switch your active wallet account to ${account.shortAddress} to unregister.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPendingUnregister(null) },
        { text: 'Open Wallet', onPress: () => openWallet() },
      ],
    );
  }, [account.address, account.shortAddress, activeAddress, openWallet, promptUnregisterConfirm]);

  // Once the wallet switches to this account, surface the unregister confirmation.
  useEffect(() => {
    if (pendingUnregister && activeAddress?.toLowerCase() === account.address.toLowerCase()) {
      const tier = pendingUnregister;
      setPendingUnregister(null);
      promptUnregisterConfirm(tier);
    }
  }, [activeAddress, account.address, pendingUnregister, promptUnregisterConfirm]);

  // --- Verify ---
  const handleVerify = useCallback(() => {
    onVerify(account.address);
  }, [account.address, onVerify]);

  // --- Sigilize (promote a Verified account to Sigilized) ---
  const handleSigilize = useCallback(() => {
    Alert.alert(
      'Sigilize this account?',
      "Sigilizing makes this address publicly linkable to any future Sigilized address you register from the same passport. Only one account per passport can be Sigilized at a time.\n\nYou'll need to tap your passport again to generate the proof.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => onSigilize(account.address) },
      ],
    );
  }, [account.address, onSigilize]);

  const isActive = activeAddress?.toLowerCase() === account.address.toLowerCase();
  const showVerifyButton = !account.isBaseVerified;
  const showSigilizeButton = account.isBaseVerified && !account.isUniqueVerified && !hasExistingSigilized;

  return (
    <View className="bg-dracula-surface rounded-2xl px-4 py-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          {isActive && (
            <View className="w-2 h-2 rounded-full bg-dracula-green mr-2" />
          )}
          <Text className="text-dracula-fg text-sm font-mono">{account.shortAddress}</Text>
        </View>

        {/* Action button */}
        {isConfirming ? (
          <ActivityIndicator size="small" color="#6272a4" className="ml-4" />
        ) : showVerifyButton ? (
          <Pressable
            onPress={handleVerify}
            className="ml-4 px-3 py-1.5 rounded-lg bg-dracula-purple active:bg-dracula-purple/80"
          >
            <Text className="text-dracula-fg text-xs font-semibold">Verify</Text>
          </Pressable>
        ) : showSigilizeButton ? (
          <Pressable
            onPress={handleSigilize}
            className="ml-4 px-3 py-1.5 rounded-lg border border-dracula-purple active:bg-dracula-purple/20"
          >
            <Text className="text-dracula-purple text-xs font-semibold">Sigilize</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Status chips */}
      <View className="flex-row flex-wrap gap-2 mt-2">
        {account.isBaseVerified && (
          <Chip
            label={`Verified${account.baseExpiry ? ` · ${formatQuarter(account.baseExpiry)}` : ''}`}
            variant="verified"
            onLongPress={() => handleUnregister('base')}
          />
        )}
        {account.isUniqueVerified && (
          <Chip
            label={`Sigilized${account.uniqueExpiry ? ` · ${formatQuarter(account.uniqueExpiry)}` : ''}`}
            variant="sigilized"
            onLongPress={() => handleUnregister('primary')}
          />
        )}
        {!account.hasAnyVerification && (
          <Text className="text-dracula-comment/50 text-xs">Not verified</Text>
        )}
        {/* Subtle hint: this account is Verified but another is already Sigilized */}
        {account.isBaseVerified && !account.isUniqueVerified && hasExistingSigilized && (
          <Text className="text-dracula-comment/40 text-[10px] mt-1 w-full">
            Another account is already Sigilized.
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chip component
// ---------------------------------------------------------------------------

function Chip({
  label,
  variant,
  onLongPress,
}: {
  label: string;
  variant: 'sigilized' | 'verified';
  onLongPress?: () => void;
}): React.JSX.Element {
  const bg = variant === 'sigilized' ? 'bg-dracula-purple/20' : 'bg-dracula-green/20';
  const text = variant === 'sigilized' ? 'text-dracula-purple' : 'text-dracula-green';

  return (
    <Pressable
      onLongPress={onLongPress}
      className={`px-2.5 py-1 rounded-full ${bg}`}
    >
      <Text className={`text-xs font-medium ${text}`}>{label}</Text>
    </Pressable>
  );
}
