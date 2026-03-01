import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  BackHandler,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAccount } from 'wagmi';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RootStackRouteProp, RootStackNavigationProp } from '../../../app/navigation/types';
import { useProofGeneration } from '../hooks/useProofGeneration';
import type { ProofOutput } from '../services/proofService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowStep = 'generating' | 'proof_ready' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProofGenerationScreen(): React.JSX.Element {
  const route = useRoute<RootStackRouteProp<'ProofGeneration'>>();
  const navigation = useNavigation<RootStackNavigationProp<'ProofGeneration'>>();
  const { passportData } = route.params;

  const { address } = useAccount();
  const { generate, isGenerating, error: proofError } = useProofGeneration();

  const [step, setStep] = useState<FlowStep>('generating');
  const [proofResult, setProofResult] = useState<ProofOutput | null>(null);
  const hasStarted = useRef(false);

  // Prevent back navigation during generation
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    navigation.setOptions({ headerBackVisible: false, gestureEnabled: false });
  }, [navigation]);

  // Run proof generation once on mount
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const walletAddress = address ?? '0x0000000000000000000000000000000000000000';

    void generate({
      rawDG1Hex: passportData.rawDG1Hex,
      rawSODHex: passportData.rawSODHex,
      walletAddress,
    }).then(async (output) => {
      // Cache passportNullifier for future unregistration (avoids NFC rescan)
      try {
        await AsyncStorage.setItem('passportNullifier', output.passportNullifierHex);
        console.log('[PROOF] passportNullifier cached:', output.passportNullifierHex);
      } catch (e) {
        console.warn('[PROOF] Failed to cache passportNullifier:', e);
      }
      setProofResult(output);
      setStep('proof_ready');
    }).catch(() => {
      setStep('error');
    });
  }, [address, generate, passportData]);

  const handleComplete = useCallback(() => {
    // Phase 2: Contract not deployed — use dummy tx for now
    const dummyTxHash: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000001';
    console.log('[TX] Skipping on-chain submission — contract not yet deployed');
    console.log('[TX] Would call register() with proof from proofResult');
    navigation.navigate('VerificationSuccess', {
      txHash: dummyTxHash,
      groupSize: 1,
    });
  }, [navigation]);

  // -------------------------------------------------------------------------
  // Generating state
  // -------------------------------------------------------------------------

  if (step === 'generating' || isGenerating) {
    return (
      <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
        <View className="flex-1 px-6 py-8 justify-center items-center">
          <View className="w-24 h-24 rounded-full bg-indigo-900/30 items-center justify-center mb-8">
            <ActivityIndicator size="large" color="#818CF8" />
          </View>
          <Text className="text-white text-xl font-bold text-center mb-2">
            Generating ZK Proof
          </Text>
          <Text className="text-zinc-400 text-sm text-center max-w-xs mb-8">
            Creating a zero-knowledge proof from your passport data...
          </Text>
          {/* Step indicator */}
          <View className="flex-row gap-x-2 mb-4 w-full">
            <View className="h-1.5 rounded-full flex-1 bg-indigo-500" />
            <View className="h-1.5 rounded-full flex-1 bg-zinc-800" />
            <View className="h-1.5 rounded-full flex-1 bg-zinc-800" />
          </View>
          <Text className="text-zinc-500 text-xs">Step 1 of 3</Text>
          <View className="mt-auto">
            <Text className="text-zinc-600 text-xs text-center leading-5">
              Please do not close the app.{'\n'}
              This process cannot be interrupted.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (step === 'error') {
    return (
      <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
        <View className="flex-1 px-6 py-8 justify-center items-center gap-y-4">
          <Text className="text-5xl">⚠️</Text>
          <Text className="text-red-400 text-lg font-semibold">Proof Generation Failed</Text>
          <Text className="text-zinc-400 text-sm text-center max-w-xs">
            {proofError ?? 'An unexpected error occurred. Please try again.'}
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            className="w-full rounded-2xl py-4 items-center bg-zinc-800 active:bg-zinc-700 mt-4"
          >
            <Text className="text-white text-base font-semibold">Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Proof ready state — show debug panel
  // -------------------------------------------------------------------------

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
      <ScrollView className="flex-1 px-6 py-6" contentContainerClassName="pb-8">
        {/* Success indicator */}
        <View className="items-center mb-6">
          <View className="w-20 h-20 rounded-full bg-green-900/30 items-center justify-center mb-4">
            <Text className="text-4xl">✓</Text>
          </View>
          <Text className="text-green-400 text-lg font-bold">Proof Generated</Text>
          <Text className="text-zinc-500 text-xs mt-1">
            (Stub proof — Phase 3 will use real Groth16 circuit)
          </Text>
        </View>

        {/* Step indicator — step 2 active */}
        <View className="flex-row gap-x-2 mb-6">
          <View className="h-1.5 rounded-full flex-1 bg-indigo-500" />
          <View className="h-1.5 rounded-full flex-1 bg-indigo-500" />
          <View className="h-1.5 rounded-full flex-1 bg-zinc-800" />
        </View>

        {/* DEBUG PANEL */}
        <View className="bg-zinc-900 rounded-2xl p-4 mb-6">
          <Text className="text-amber-400 text-xs font-bold uppercase tracking-wider mb-3">
            === Generated Proof Debug ===
          </Text>

          <DebugRow label="Wallet Address" value={address ?? '(not connected)'} mono />
          <DebugRow label="Doc Number" value={passportData.documentNumber} mono />
          <DebugRow
            label="DG1 Hex"
            value={passportData.rawDG1Hex.length > 32
              ? `${passportData.rawDG1Hex.slice(0, 32)}...`
              : passportData.rawDG1Hex}
            mono
          />
          <DebugRow
            label="SOD Hex"
            value={passportData.rawSODHex.length > 32
              ? `${passportData.rawSODHex.slice(0, 32)}...`
              : passportData.rawSODHex}
            mono
          />

          {proofResult && (
            <>
              <View className="h-px bg-zinc-800 my-3" />
              <Text className="text-indigo-400 text-xs font-bold uppercase tracking-wider mb-2">
                Proof Values
              </Text>
              <DebugRow
                label="Passport Nullifier"
                value={proofResult.passportNullifierHex}
                mono
              />
              <DebugRow
                label="ZK Proof bytes"
                value={`${proofResult.zkProof.proof.slice(0, 34)}...`}
                mono
              />
            </>
          )}

          <View className="h-px bg-zinc-800 my-3" />
          <Text className="text-zinc-600 text-xs italic">
            Note: On-chain submission skipped — contract not deployed yet.
          </Text>
        </View>

        {/* Skip submission notice */}
        <View className="bg-zinc-900/50 rounded-xl p-3 mb-6 border border-zinc-800">
          <Text className="text-zinc-500 text-xs text-center">
            Phase 2 Demo: Contract submission skipped.{'\n'}
            Deploy VerificationRegistry.sol to enable real on-chain verification.
          </Text>
        </View>

        {/* Complete button */}
        <Pressable
          onPress={handleComplete}
          className="w-full rounded-2xl py-4 items-center bg-indigo-600 active:bg-indigo-700"
        >
          <Text className="text-white text-base font-semibold">
            Complete Verification
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Debug row helper
// ---------------------------------------------------------------------------

function DebugRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <View className="flex-row justify-between py-1.5 flex-wrap">
      <Text className="text-zinc-500 text-xs mr-2 flex-shrink-0">{label}</Text>
      <Text
        className={`text-zinc-200 text-xs flex-1 text-right ${mono ? 'font-mono' : ''}`}
        numberOfLines={2}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}
