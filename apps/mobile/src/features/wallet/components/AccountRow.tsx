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
  /** Other tracked addresses already linked to a passport. Empty if this is the first sigil. */
  linkedSiblings: TrackedAccount[];
  onSigilize: (address: `0x${string}`) => void;
  onUnregistered: () => void;
}

function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function AccountRow({ account, linkedSiblings, onSigilize, onUnregistered }: AccountRowProps): React.JSX.Element {
  const { address: activeAddress } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const openWallet = useOpenWallet();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [pendingUnregister, setPendingUnregister] = useState(false);

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

  const submitUnregister = useCallback(() => {
    if (!contractAddress) return;
    writeContractAsync({
      address: contractAddress,
      abi: VERIFICATION_REGISTRY_ABI,
      functionName: 'unregister',
    }).then(setTxHash).catch(() => {
      Alert.alert('Error', 'Transaction failed. Please try again.');
    });
  }, [contractAddress, writeContractAsync]);

  const promptUnregisterConfirm = useCallback(() => {
    Alert.alert(
      'Unregister',
      `Remove sigil from ${account.shortAddress}? This wallet will no longer be linked to your passport on-chain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unregister', style: 'destructive', onPress: submitUnregister },
      ],
    );
  }, [account.shortAddress, submitUnregister]);

  const handleUnregister = useCallback(() => {
    if (activeAddress?.toLowerCase() === account.address.toLowerCase()) {
      promptUnregisterConfirm();
      return;
    }
    setPendingUnregister(true);
    Alert.alert(
      'Switch Account',
      `Switch your active wallet account to ${account.shortAddress} to unregister.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPendingUnregister(false) },
        { text: 'Open Wallet', onPress: () => openWallet() },
      ],
    );
  }, [account.address, account.shortAddress, activeAddress, openWallet, promptUnregisterConfirm]);

  useEffect(() => {
    if (pendingUnregister && activeAddress?.toLowerCase() === account.address.toLowerCase()) {
      setPendingUnregister(false);
      promptUnregisterConfirm();
    }
  }, [activeAddress, account.address, pendingUnregister, promptUnregisterConfirm]);

  const handleSigilize = useCallback(() => {
    onSigilize(account.address);
  }, [account.address, onSigilize]);

  const isActive = activeAddress?.toLowerCase() === account.address.toLowerCase();
  const linkedSiblingCount = linkedSiblings.filter((s) =>
    account.nullifier && s.nullifier === account.nullifier && s.address.toLowerCase() !== account.address.toLowerCase(),
  ).length;

  return (
    <View className="bg-dracula-surface rounded-2xl px-4 py-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          {isActive && (
            <View className="w-2 h-2 rounded-full bg-dracula-green mr-2" />
          )}
          <Text className="text-dracula-fg text-sm font-mono">{account.shortAddress}</Text>
        </View>

        {isConfirming ? (
          <ActivityIndicator size="small" color="#6272a4" className="ml-4" />
        ) : !account.isVerified ? (
          <Pressable
            onPress={handleSigilize}
            className="ml-4 px-3 py-1.5 rounded-lg bg-dracula-purple active:bg-dracula-purple/80"
          >
            <Text className="text-dracula-fg text-xs font-semibold">Sigilize</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Status chip */}
      <View className="flex-row flex-wrap gap-2 mt-2">
        {account.isVerified ? (
          <Pressable
            onLongPress={handleUnregister}
            className="px-2.5 py-1 rounded-full bg-dracula-purple/20"
          >
            <Text className="text-dracula-purple text-xs font-medium">
              {`Sigilized${account.expiry ? ` · ${formatQuarter(account.expiry)}` : ''}`}
            </Text>
          </Pressable>
        ) : (
          <Text className="text-dracula-comment/50 text-xs">Not sigilized</Text>
        )}
        {linkedSiblingCount > 0 && (
          <Text className="text-dracula-comment/40 text-[10px] mt-1 w-full">
            Linked to {linkedSiblingCount} other sigilized {linkedSiblingCount === 1 ? 'wallet' : 'wallets'} on-chain.
          </Text>
        )}
      </View>
    </View>
  );
}
