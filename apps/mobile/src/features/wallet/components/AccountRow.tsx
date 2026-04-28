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
  /** Whether any tracked address already has unique verification. */
  hasExistingUnique: boolean;
  onVerify: (address: `0x${string}`) => void;
  onUnregistered: () => void;
}

function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function AccountRow({ account, hasExistingUnique, onVerify, onUnregistered }: AccountRowProps): React.JSX.Element {
  const { address: activeAddress } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const openWallet = useOpenWallet();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

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

  const handleUnregister = useCallback((tier: 'base' | 'primary') => {
    if (activeAddress?.toLowerCase() !== account.address.toLowerCase()) {
      openWallet();
      return;
    }
    const label = tier === 'primary' ? 'Unique' : 'Verified';
    Alert.alert(
      'Unregister',
      `Remove ${account.shortAddress} from ${label} verification?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unregister', style: 'destructive', onPress: () => submitUnregister(tier) },
      ],
    );
  }, [account.address, account.shortAddress, activeAddress, openWallet, submitUnregister]);

  // --- Verify ---
  const handleVerify = useCallback(() => {
    onVerify(account.address);
  }, [account.address, onVerify]);

  // Determine which tiers can still be verified
  const canVerifyUnique = !account.isUniqueVerified && !hasExistingUnique;
  const canVerifyBase = !account.isBaseVerified;
  const canVerifyAny = canVerifyUnique || canVerifyBase;
  const isActive = activeAddress?.toLowerCase() === account.address.toLowerCase();

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
        ) : canVerifyAny ? (
          <Pressable
            onPress={handleVerify}
            className="ml-4 px-3 py-1.5 rounded-lg bg-dracula-purple active:bg-dracula-purple/80"
          >
            <Text className="text-dracula-fg text-xs font-semibold">Verify</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Status chips */}
      <View className="flex-row flex-wrap gap-2 mt-2">
        {account.isUniqueVerified && (
          <Chip
            label={`Unique${account.uniqueExpiry ? ` · ${formatQuarter(account.uniqueExpiry)}` : ''}`}
            variant="unique"
            onLongPress={() => handleUnregister('primary')}
          />
        )}
        {account.isBaseVerified && (
          <Chip
            label={`Verified${account.baseExpiry ? ` · ${formatQuarter(account.baseExpiry)}` : ''}`}
            variant="verified"
            onLongPress={() => handleUnregister('base')}
          />
        )}
        {!account.hasAnyVerification && (
          <Text className="text-dracula-comment/50 text-xs">Not verified</Text>
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
  variant: 'unique' | 'verified';
  onLongPress?: () => void;
}): React.JSX.Element {
  const bg = variant === 'unique' ? 'bg-dracula-purple/20' : 'bg-dracula-green/20';
  const text = variant === 'unique' ? 'text-dracula-purple' : 'text-dracula-green';

  return (
    <Pressable
      onLongPress={onLongPress}
      className={`px-2.5 py-1 rounded-full ${bg}`}
    >
      <Text className={`text-xs font-medium ${text}`}>{label}</Text>
    </Pressable>
  );
}
