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
  const { isVerified, isLoading, walletInfo } = useVerificationStatus(address);

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
    <View className="bg-zinc-900 rounded-3xl p-6 gap-y-5">
      <View className="flex-row items-center gap-x-2">
        <View className="w-2.5 h-2.5 rounded-full bg-green-500" />
        <Text className="text-green-400 text-sm font-medium">Connected</Text>
        {chainName !== null && (
          <View className="ml-auto bg-zinc-800 px-3 py-1 rounded-full">
            <Text className="text-zinc-300 text-xs">{chainName}</Text>
          </View>
        )}
      </View>

      <Pressable
        onPress={handleCopyAddress}
        className="bg-zinc-800 rounded-2xl p-4 active:bg-zinc-700"
      >
        <Text className="text-zinc-400 text-xs mb-1">Wallet Address</Text>
        <Text className="text-white text-base font-mono">{shortAddress}</Text>
        <Text className="text-zinc-500 text-xs mt-1">Tap to copy</Text>
      </Pressable>

      <View className="bg-zinc-800 rounded-2xl p-4">
        <Text className="text-zinc-400 text-xs mb-1">Verification Status</Text>
        {isLoading ? (
          <ActivityIndicator size="small" color="#A1A1AA" className="self-start mt-1" />
        ) : isVerified ? (
          <>
            <Text className="text-green-400 text-sm font-medium">Verified</Text>
            {walletInfo !== null && walletInfo.groupSizeAtVerification > 0n && (
              <Text className="text-zinc-500 text-xs mt-1">
                Group member #{walletInfo.groupSizeAtVerification.toString()}
              </Text>
            )}
          </>
        ) : (
          <>
            <Text className="text-yellow-400 text-sm font-medium">Not Verified</Text>
            <Text className="text-zinc-500 text-xs mt-1">
              Complete passport verification to register on-chain
            </Text>
          </>
        )}
      </View>

      <Pressable
        onPress={handleDisconnect}
        className="border border-zinc-700 rounded-2xl py-3 items-center active:bg-zinc-800"
      >
        <Text className="text-red-400 text-sm font-medium">Disconnect</Text>
      </Pressable>
    </View>
  );
}
