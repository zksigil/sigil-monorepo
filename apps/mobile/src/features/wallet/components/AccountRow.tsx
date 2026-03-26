import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { useAppKit } from '@reown/appkit-react-native';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';
import type { RootStackNavigationProp } from '../../../app/navigation/types';
import { useAccountStore } from '../store/accountStore';
import { formatQuarter } from '../hooks/useTrackedAccounts';
import type { TrackedAccount } from '../hooks/useTrackedAccounts';

interface AccountRowProps {
  account: TrackedAccount;
  onUnregistered: () => void;
}

function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function AccountRow({ account, onUnregistered }: AccountRowProps): React.JSX.Element {
  const navigation = useNavigation<RootStackNavigationProp<'Home'>>();
  const { address: activeAddress } = useAccount();
  const chainId = useChainId();
  const { removeEntry, primaryNullifiers } = useAccountStore();
  const { writeContractAsync } = useWriteContract();
  const { open: openAppKit } = useAppKit();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [pendingVerify, setPendingVerify] = useState(false);

  const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    pollingInterval: 1000,
  });

  useEffect(() => {
    if (isConfirmed && txHash) {
      removeEntry(account.address, account.tier);
      onUnregistered();
    }
  }, [isConfirmed, txHash, account.address, account.tier, removeEntry, onUnregistered]);

  const contractAddress = isSupportedChain(chainId)
    ? CONTRACT_ADDRESSES[chainId].verificationRegistry
    : null;

  // When pendingVerify is set and the wallet switches to the target account, auto-proceed
  useEffect(() => {
    if (pendingVerify && activeAddress?.toLowerCase() === account.address.toLowerCase()) {
      setPendingVerify(false);
      navigation.navigate('PassportScan');
    }
  }, [activeAddress, pendingVerify, account.address, navigation]);

  // --- Verify ---
  const handleVerify = useCallback(() => {
    if (activeAddress?.toLowerCase() === account.address.toLowerCase()) {
      navigation.navigate('PassportScan');
      return;
    }
    // Wrong account active — open wallet immediately so user can switch, then auto-proceed
    setPendingVerify(true);
    void openAppKit();
  }, [account.address, activeAddress, navigation, openAppKit]);

  // --- Unregister ---
  const submitUnregister = useCallback(() => {
    if (!contractAddress) return;

    if (account.tier === 'base') {
      writeContractAsync({
        address: contractAddress,
        abi: VERIFICATION_REGISTRY_ABI,
        functionName: 'unregisterBase',
      }).then(setTxHash).catch(() => {
        Alert.alert('Error', 'Transaction failed. Please try again.');
      });
    } else {
      const nullifier = primaryNullifiers[account.address];
      if (!nullifier) {
        Alert.alert('Error', 'Nullifier not found. Cannot unregister primary account.');
        return;
      }
      writeContractAsync({
        address: contractAddress,
        abi: VERIFICATION_REGISTRY_ABI,
        functionName: 'unregisterPrimary',
        args: [nullifier],
      }).then(setTxHash).catch(() => {
        Alert.alert('Error', 'Transaction failed. Please try again.');
      });
    }
  }, [account.address, account.tier, contractAddress, primaryNullifiers, writeContractAsync]);

  const handleUnregister = useCallback(() => {
    if (activeAddress?.toLowerCase() !== account.address.toLowerCase()) {
      void openAppKit();
      return;
    }
    Alert.alert(
      'Unregister',
      `Remove ${account.shortAddress} from ${account.tier === 'primary' ? 'Primary' : 'Base'} verification?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unregister', style: 'destructive', onPress: submitUnregister },
      ],
    );
  }, [account.address, account.shortAddress, account.tier, activeAddress, openAppKit, submitUnregister]);

  const expiryLabel = account.expiresAt && account.expiresAt > 0n
    ? formatQuarter(account.expiresAt)
    : null;

  return (
    <View className="bg-zinc-900 rounded-2xl px-4 py-3 flex-row items-center justify-between">
      <View className="flex-1 gap-y-0.5">
        <Text className="text-white text-sm font-mono">{account.shortAddress}</Text>
        {account.isVerified && expiryLabel ? (
          <Text className="text-zinc-400 text-xs">Expires {expiryLabel}</Text>
        ) : (
          <Text className="text-zinc-500 text-xs">Not verified</Text>
        )}
      </View>

      {account.isVerified ? (
        <Pressable
          onPress={handleUnregister}
          disabled={isConfirming}
          className="ml-4 px-3 py-1.5 rounded-lg border border-zinc-700 active:bg-zinc-800"
        >
          {isConfirming ? (
            <ActivityIndicator size="small" color="#71717a" />
          ) : (
            <Text className="text-zinc-400 text-xs font-medium">Unregister</Text>
          )}
        </Pressable>
      ) : (
        <Pressable
          onPress={handleVerify}
          className="ml-4 px-3 py-1.5 rounded-lg bg-indigo-600 active:bg-indigo-700"
        >
          <Text className="text-white text-xs font-semibold">Verify</Text>
        </Pressable>
      )}
    </View>
  );
}
