import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackNavigationProp } from '../../../app/navigation/types';
import { useWalletConnection } from '../hooks/useWalletConnection';
import { useChainGuard } from '../hooks/useChainGuard';
import { useVerificationStatus } from '../hooks/useVerificationStatus';
import { WalletCard } from './WalletCard';
import { CHAIN_DISPLAY_NAMES } from '../../../shared/constants/chains';

export function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<RootStackNavigationProp<'Home'>>();
  const {
    address,
    shortAddress,
    isConnected,
    isConnecting,
    chainId,
    connect,
    disconnect,
  } = useWalletConnection();

  const { isWrongChain, switchToBaseSepolia } = useChainGuard();
  const { isVerified } = useVerificationStatus(address);

  const chainName = chainId !== null
    ? (CHAIN_DISPLAY_NAMES[chainId] ?? `Chain ${chainId}`)
    : null;

  const handleVerify = (): void => {
    navigation.navigate('PassportScan');
  };

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
      <View className="flex-1 px-6 py-8">

        <View className="items-center mb-12">
          <Text className="text-white text-3xl font-bold tracking-tight">
            ZK Passport
          </Text>
          <Text className="text-zinc-400 text-base mt-2 text-center">
            Verify your identity with zero-knowledge proofs
          </Text>
        </View>

        <View className="flex-1 justify-center">
          {isConnected && address !== undefined ? (
            <View className="gap-y-4">
              {isWrongChain && (
                <Pressable
                  onPress={switchToBaseSepolia}
                  className="bg-yellow-900/30 border border-yellow-700 rounded-2xl p-4 items-center active:bg-yellow-900/50"
                >
                  <Text className="text-yellow-400 text-sm font-medium">
                    Wrong Network
                  </Text>
                  <Text className="text-yellow-500/80 text-xs mt-1">
                    Tap to switch to Base Sepolia
                  </Text>
                </Pressable>
              )}

              <WalletCard
                address={address}
                shortAddress={shortAddress ?? ''}
                chainName={chainName}
                onDisconnect={disconnect}
              />

              {!isVerified && !isWrongChain && (
                <Pressable
                  onPress={handleVerify}
                  className="w-full rounded-2xl py-4 items-center bg-green-600 active:bg-green-700"
                >
                  <Text className="text-white text-base font-semibold">
                    Verify Identity
                  </Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View className="items-center gap-y-6">
              <View className="w-24 h-24 rounded-full bg-zinc-900 items-center justify-center mb-4">
                <Text className="text-4xl">🔐</Text>
              </View>

              <Text className="text-zinc-400 text-center text-base leading-6 max-w-xs">
                Connect your Ethereum wallet to begin passport verification
              </Text>

              <Pressable
                onPress={connect}
                disabled={isConnecting}
                className={[
                  'w-full rounded-2xl py-4 items-center justify-center',
                  isConnecting ? 'bg-indigo-900' : 'bg-indigo-600 active:bg-indigo-700',
                ].join(' ')}
              >
                {isConnecting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text className="text-white text-base font-semibold">
                    Connect Wallet
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </View>

        <View className="mt-auto">
          <Text className="text-zinc-600 text-xs text-center leading-5">
            Your passport data never leaves your device.{'\n'}
            ZK proofs are generated locally.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
