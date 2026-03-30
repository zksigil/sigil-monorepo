import React from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useVerificationStatus } from '../hooks/useVerificationStatus';

interface WalletCardProps {
  address: `0x${string}`;
  shortAddress: string;
  chainName: string | null;
  onDisconnect: () => void;
}

export function WalletCard({
  address,
  shortAddress,
  chainName,
  onDisconnect,
}: WalletCardProps): React.JSX.Element {
  const { isVerified, isLoading } = useVerificationStatus(address);

  const handleCopyAddress = async (): Promise<void> => {
    await Clipboard.setStringAsync(address);
    Alert.alert('Copied', 'Wallet address copied to clipboard');
  };

  const handleDisconnect = (): void => {
    Alert.alert(
      'Disconnect Wallet',
      'Are you sure you want to disconnect your wallet?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: onDisconnect },
      ],
    );
  };

  return (
    <View className="bg-dracula-surface rounded-3xl p-6 gap-y-5">
      <View className="flex-row items-center gap-x-2">
        <View className="w-2.5 h-2.5 rounded-full bg-dracula-green" />
        <Text className="text-dracula-green text-sm font-medium">Connected</Text>
        {chainName !== null && (
          <View className="ml-auto bg-dracula-surface/70 px-3 py-1 rounded-full">
            <Text className="text-dracula-fg/80 text-xs">{chainName}</Text>
          </View>
        )}
      </View>

      <Pressable
        onPress={handleCopyAddress}
        className="bg-dracula-surface/70 rounded-2xl p-4 active:bg-dracula-comment/40"
      >
        <Text className="text-dracula-comment text-xs mb-1">Wallet Address</Text>
        <Text className="text-dracula-fg text-base font-mono">{shortAddress}</Text>
        <Text className="text-dracula-comment/70 text-xs mt-1">Tap to copy</Text>
      </Pressable>

      <View className="bg-dracula-surface/70 rounded-2xl p-4">
        <Text className="text-dracula-comment text-xs mb-1">Verification Status</Text>
        {isLoading ? (
          <ActivityIndicator size="small" color="#A1A1AA" className="self-start mt-1" />
        ) : isVerified ? (
          <Text className="text-dracula-green text-sm font-medium">Verified</Text>
        ) : (
          <>
            <Text className="text-dracula-yellow text-sm font-medium">Not Verified</Text>
            <Text className="text-dracula-comment/70 text-xs mt-1">
              Complete passport verification to register on-chain
            </Text>
          </>
        )}
      </View>

      <Pressable
        onPress={handleDisconnect}
        className="border border-dracula-comment/40 rounded-2xl py-3 items-center active:bg-dracula-surface/70"
      >
        <Text className="text-dracula-red text-sm font-medium">Disconnect</Text>
      </Pressable>
    </View>
  );
}
