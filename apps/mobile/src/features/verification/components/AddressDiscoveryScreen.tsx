import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useChainId } from 'wagmi';
import { getPublicClient } from '../../../infrastructure/blockchain/publicClient';
import type { RootStackRouteProp, RootStackNavigationProp } from '../../../app/navigation/types';
import { computeNullifierOnly } from '../services/proofService';
import { SIGIL_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS, CHAIN_DISPLAY_NAMES } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';
import { useEnsName } from '../../wallet/hooks/useEnsName';
import { useTrackedExternalAddresses } from '../../wallet/hooks/useTrackedExternalAddresses';
import { useAccount } from 'wagmi';

type Step = 'computing' | 'querying' | 'done' | 'error';

function decimalToBytes32(decimal: string): `0x${string}` {
  return `0x${BigInt(decimal).toString(16).padStart(64, '0')}` as `0x${string}`;
}

/**
 * Translate raw error messages from the discovery flow into something a user
 * can act on. Falls back to the raw message (truncated) for unrecognized errors.
 */
function humanizeDiscoveryError(raw: string | null, chainName: string): string {
  if (!raw) return 'Could not look up addresses for this passport.';
  if (raw.includes('Mopro native module not available')) {
    return 'The on-device prover is not loaded. Try restarting the app.';
  }
  if (raw.includes('No registry deployed')) {
    return `Sigil isn't deployed on ${chainName}. Switch your wallet to a supported chain and try again.`;
  }
  if (raw.includes('No RPC configured')) {
    return `Couldn't reach ${chainName}. Check your internet connection and try again.`;
  }
  if (/network|fetch|timeout|ECONNREFUSED/i.test(raw)) {
    return 'Network request failed. Check your connection and try again.';
  }
  return raw;
}

export function AddressDiscoveryScreen(): React.JSX.Element {
  const route = useRoute<RootStackRouteProp<'AddressDiscovery'>>();
  const navigation = useNavigation<RootStackNavigationProp<'AddressDiscovery'>>();
  const chainId = useChainId();
  const { passportData } = route.params;

  // Default to Base Sepolia if not on a supported chain (e.g. user not connected).
  const queryChainId: SupportedChainId =
    (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId)
      ? (chainId as SupportedChainId)
      : 84532;
  const queryChainName = CHAIN_DISPLAY_NAMES[queryChainId] ?? `Chain ${queryChainId}`;

  const [step, setStep] = useState<Step>('computing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<`0x${string}`[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setStep('computing');
        const nullifierDecimal = await computeNullifierOnly(passportData.rawDG1Hex, passportData.rawSODHex);
        if (cancelled) return;

        setStep('querying');
        const nullifier = decimalToBytes32(nullifierDecimal);

        const client = getPublicClient(queryChainId);
        if (!client) throw new Error(`No RPC configured for ${queryChainName}.`);

        const registryAddress = CONTRACT_ADDRESSES[queryChainId].verificationRegistry;
        if (registryAddress === '0x0000000000000000000000000000000000000000') {
          throw new Error(`No registry deployed on ${queryChainName}.`);
        }

        const result = await client.readContract({
          address: registryAddress,
          abi: SIGIL_REGISTRY_ABI,
          functionName: 'getWallets',
          args: [nullifier],
        }) as readonly `0x${string}`[];

        if (cancelled) return;
        setAddresses([...result]);
        setStep('done');
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Unexpected error during discovery.';
        console.error('[DISCOVER]', msg);
        setErrorMessage(msg);
        setStep('error');
      }
    })();
    return () => { cancelled = true; };
  }, [passportData.rawDG1Hex, passportData.rawSODHex, queryChainId, queryChainName]);

  const handleDone = useCallback(() => navigation.popToTop(), [navigation]);

  if (step === 'computing' || step === 'querying') {
    return (
      <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
        <View className="flex-1 px-6 py-8 justify-center items-center">
          <View className="w-24 h-24 rounded-full bg-dracula-purple/20 items-center justify-center mb-6">
            <ActivityIndicator size="large" color="#bd93f9" />
          </View>
          <Text className="text-dracula-fg text-xl font-bold text-center mb-2">
            {step === 'computing' ? 'Deriving nullifier…' : 'Looking up addresses…'}
          </Text>
          <Text className="text-dracula-comment text-sm text-center max-w-xs">
            {step === 'computing'
              ? 'Hashing passport data and computing your sigil identity locally.'
              : `Querying ${queryChainName} for addresses registered under your passport.`}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'error') {
    return (
      <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
        <View className="flex-1 px-6 py-8 justify-center items-center gap-y-4">
          <Text className="text-5xl">⚠️</Text>
          <Text className="text-dracula-red text-lg font-semibold">Discovery Failed</Text>
          <Text className="text-dracula-comment text-sm text-center max-w-xs">
            {humanizeDiscoveryError(errorMessage, queryChainName)}
          </Text>
          <Pressable
            onPress={handleDone}
            className="w-full rounded-2xl py-4 items-center bg-dracula-surface/70 active:bg-dracula-comment/40 mt-4"
          >
            <Text className="text-dracula-fg text-base font-semibold">Back to Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // step === 'done' — distinct visual treatment for found vs empty so the
  // celebratory checkmark only shows when there's actually something to find.
  const isEmpty = addresses.length === 0;
  return (
    <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
      <ScrollView className="flex-1 px-6 py-6" contentContainerClassName="pb-8">
        <View className="items-center mb-6">
          <View
            className={`w-20 h-20 rounded-full items-center justify-center mb-4 ${
              isEmpty ? 'bg-dracula-surface' : 'bg-dracula-green/20'
            }`}
          >
            <Text className={`text-4xl ${isEmpty ? 'opacity-70' : ''}`}>
              {isEmpty ? '🔎' : '✓'}
            </Text>
          </View>
          <Text className="text-dracula-fg text-xl font-bold">
            {isEmpty
              ? 'No sigilized addresses'
              : `${addresses.length} sigilized ${addresses.length === 1 ? 'address' : 'addresses'} found`}
          </Text>
          <Text className="text-dracula-comment/70 text-xs mt-1">on {queryChainName}</Text>
        </View>

        {isEmpty ? (
          <View className="bg-dracula-surface rounded-2xl px-5 py-5 mb-6 gap-y-2">
            <Text className="text-dracula-fg/80 text-sm font-semibold">
              Why am I seeing this?
            </Text>
            <Text className="text-dracula-comment text-xs leading-5">
              Either this passport has never been sigilized, or you sigilized on a different
              chain. Switch your wallet network to {queryChainName === 'Base Sepolia' ? 'Base mainnet' : 'Base Sepolia'} and tap "Look up addresses by passport" again to check there.
            </Text>
          </View>
        ) : (
          <View className="gap-y-2 mb-6">
            {addresses.map((address) => (
              <DiscoveredAddressRow key={address} address={address} />
            ))}
          </View>
        )}

        <Pressable
          onPress={handleDone}
          className="w-full rounded-2xl py-4 items-center bg-dracula-purple active:bg-dracula-purple/80"
        >
          <Text className="text-dracula-fg text-base font-semibold">Back to Home</Text>
        </Pressable>

        <View className="mt-6">
          <Text className="text-dracula-comment/50 text-xs text-center leading-5">
            Your passport data was processed locally.{'\n'}
            Only the public sigil nullifier was sent on-chain.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Row — one discovered address, with ENS name + copy + view-on-explorer
// ---------------------------------------------------------------------------

function DiscoveredAddressRow({ address }: { address: `0x${string}` }): React.JSX.Element {
  const ensName = useEnsName(address);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const [copied, setCopied] = useState(false);
  const { addresses: walletAddresses } = useAccount();
  const { addresses: trackedExternal, add: addExternal } = useTrackedExternalAddresses();

  const inWallet = walletAddresses?.some((a) => a.toLowerCase() === address.toLowerCase()) ?? false;
  const isTracked = trackedExternal.some((a) => a.toLowerCase() === address.toLowerCase());

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  const handleTrack = useCallback(() => {
    void addExternal(address);
  }, [addExternal, address]);

  return (
    <View className="bg-dracula-surface rounded-2xl px-4 py-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 min-w-0 mr-3">
          {ensName ? (
            <>
              <Text className="text-dracula-fg text-sm font-semibold" numberOfLines={1}>
                {ensName}
              </Text>
              <Text className="text-dracula-comment/60 text-[11px] font-mono mt-0.5" numberOfLines={1}>
                {short}
              </Text>
            </>
          ) : (
            <Text className="text-dracula-fg text-sm font-mono" numberOfLines={1}>
              {short}
            </Text>
          )}
        </View>
        <Pressable
          onPress={handleCopy}
          className="px-3 py-1.5 rounded-lg bg-dracula-bg/60 active:bg-dracula-bg/40"
        >
          <Text className="text-dracula-comment text-xs font-medium">
            {copied ? '✓ Copied' : 'Copy'}
          </Text>
        </Pressable>
      </View>

      {/* Add-to-account-list affordance. Already in wallet → no need; already
          tracked → show confirmation; otherwise → offer to track. */}
      <View className="mt-2.5">
        {inWallet ? (
          <Text className="text-dracula-green/80 text-[11px]">In your connected wallet</Text>
        ) : isTracked ? (
          <Text className="text-dracula-comment/70 text-[11px]">✓ Tracked on Home</Text>
        ) : (
          <Pressable
            onPress={handleTrack}
            className="self-start rounded-lg px-3 py-1.5 border border-dracula-purple/50 active:bg-dracula-purple/15"
          >
            <Text className="text-dracula-purple text-xs font-semibold">+ Track on Home</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
