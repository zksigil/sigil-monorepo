import React, { useCallback, useEffect } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, CommonActions } from '@react-navigation/native';
import type { RootStackRouteProp, RootStackNavigationProp } from '../../../app/navigation/types';
import { useAccountStore } from '../../../features/wallet/store/accountStore';

const BASESCAN_SEPOLIA_TX_URL = 'https://sepolia.basescan.org/tx/';

export function VerificationSuccessScreen(): React.JSX.Element {
  const route = useRoute<RootStackRouteProp<'VerificationSuccess'>>();
  const navigation = useNavigation<RootStackNavigationProp<'VerificationSuccess'>>();
  const { txHash, groupSize, verifiedAddress, tier } = route.params;
  const { addEntry } = useAccountStore();

  // Ensure the verified address is in the tracked list on first render
  useEffect(() => {
    addEntry(verifiedAddress, tier);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
      <View className="flex-1 px-6 py-8">
        <View className="flex-1 justify-center items-center gap-y-6">
          <View className="w-24 h-24 rounded-full bg-green-900/30 items-center justify-center">
            <Text className="text-5xl">✅</Text>
          </View>

          <View className="items-center gap-y-2">
            <Text className="text-white text-2xl font-bold">Verified!</Text>
            <Text className="text-zinc-400 text-sm text-center max-w-xs">
              Your identity has been verified on-chain. Your wallet is now part of the verified group.
            </Text>
          </View>

          {/* Transaction details card */}
          <View className="w-full bg-zinc-900 rounded-2xl p-5 gap-y-4 mt-4">
            <View className="flex-row justify-between items-center">
              <Text className="text-zinc-400 text-xs">Transaction</Text>
              <Pressable onPress={handleViewOnBaseScan}>
                <Text className="text-indigo-400 text-xs font-medium">{shortTxHash}</Text>
              </Pressable>
            </View>

            <View className="flex-row justify-between items-center">
              <Text className="text-zinc-400 text-xs">Group Size</Text>
              <Text className="text-white text-xs font-medium">
                {groupSize} verified {groupSize === 1 ? 'member' : 'members'}
              </Text>
            </View>

            <View className="flex-row justify-between items-center">
              <Text className="text-zinc-400 text-xs">Network</Text>
              <Text className="text-white text-xs font-medium">Base Sepolia</Text>
            </View>
          </View>

          <Pressable
            onPress={handleViewOnBaseScan}
            className="w-full rounded-2xl py-4 items-center bg-zinc-800 active:bg-zinc-700"
          >
            <Text className="text-indigo-400 text-base font-semibold">View on BaseScan</Text>
          </Pressable>

          <Pressable
            onPress={handleDone}
            className="w-full rounded-2xl py-4 items-center bg-indigo-600 active:bg-indigo-700"
          >
            <Text className="text-white text-base font-semibold">Done</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
