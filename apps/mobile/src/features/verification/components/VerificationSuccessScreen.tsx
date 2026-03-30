import React, { useCallback } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, CommonActions } from '@react-navigation/native';
import type { RootStackRouteProp, RootStackNavigationProp } from '../../../app/navigation/types';

const BASESCAN_SEPOLIA_TX_URL = 'https://sepolia.basescan.org/tx/';

export function VerificationSuccessScreen(): React.JSX.Element {
  const route = useRoute<RootStackRouteProp<'VerificationSuccess'>>();
  const navigation = useNavigation<RootStackNavigationProp<'VerificationSuccess'>>();
  const { txHash, groupSize, tier } = route.params;

  const tierLabel = tier === 'unique' ? 'Unique' : 'Verified';

  const shortTxHash = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;

  const handleViewOnBaseScan = useCallback(() => {
    void Linking.openURL(`${BASESCAN_SEPOLIA_TX_URL}${txHash}`);
  }, [txHash]);

  const handleDone = useCallback(() => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      }),
    );
  }, [navigation]);

  return (
    <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
      <View className="flex-1 px-6 py-8">
        <View className="flex-1 justify-center items-center gap-y-6">
          <View className="w-24 h-24 rounded-full bg-dracula-green/20 items-center justify-center">
            <Text className="text-5xl">✅</Text>
          </View>

          <View className="items-center gap-y-2">
            <Text className="text-dracula-fg text-2xl font-bold">{tierLabel} Verified!</Text>
            <Text className="text-dracula-comment text-sm text-center max-w-xs">
              Your identity has been verified on-chain. Your wallet is now part of the verified group.
            </Text>
          </View>

          {/* Transaction details card */}
          <View className="w-full bg-dracula-surface rounded-2xl p-5 gap-y-4 mt-4">
            <View className="flex-row justify-between items-center">
              <Text className="text-dracula-comment text-xs">Transaction</Text>
              <Pressable onPress={handleViewOnBaseScan}>
                <Text className="text-dracula-purple text-xs font-medium">{shortTxHash}</Text>
              </Pressable>
            </View>

            <View className="flex-row justify-between items-center">
              <Text className="text-dracula-comment text-xs">Tier</Text>
              <Text className="text-dracula-fg text-xs font-medium">{tierLabel}</Text>
            </View>

            <View className="flex-row justify-between items-center">
              <Text className="text-dracula-comment text-xs">Group Size</Text>
              <Text className="text-dracula-fg text-xs font-medium">
                {groupSize} verified {groupSize === 1 ? 'member' : 'members'}
              </Text>
            </View>

            <View className="flex-row justify-between items-center">
              <Text className="text-dracula-comment text-xs">Network</Text>
              <Text className="text-dracula-fg text-xs font-medium">Sepolia</Text>
            </View>
          </View>

          <Pressable
            onPress={handleViewOnBaseScan}
            className="w-full rounded-2xl py-4 items-center bg-dracula-surface/70 active:bg-dracula-comment/40"
          >
            <Text className="text-dracula-purple text-base font-semibold">View on Explorer</Text>
          </Pressable>

          <Pressable
            onPress={handleDone}
            className="w-full rounded-2xl py-4 items-center bg-dracula-purple active:bg-dracula-purple/80"
          >
            <Text className="text-dracula-fg text-base font-semibold">Done</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
