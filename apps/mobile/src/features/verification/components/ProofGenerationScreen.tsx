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
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { BaseError } from 'wagmi';
import type { RootStackRouteProp, RootStackNavigationProp } from '../../../app/navigation/types';
import { useProofGeneration } from '../hooks/useProofGeneration';
import type { BaseProofOutput } from '../services/proofService';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import type { SupportedChainId } from '../../../shared/constants/chains';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowStep = 'generating' | 'proof_ready' | 'submitting' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse YYMMDD MRZ expiry to unix seconds. YY < 70 → 2000s, YY >= 70 → 1900s. */
function mrzExpiryToUnix(yymmdd: string): number {
  if (yymmdd.length !== 6) return 0;
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  const year = yy < 70 ? 2000 + yy : 1900 + yy;
  return Math.floor(new Date(Date.UTC(year, mm - 1, dd)).getTime() / 1000);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProofGenerationScreen(): React.JSX.Element {
  const route = useRoute<RootStackRouteProp<'ProofGeneration'>>();
  const navigation = useNavigation<RootStackNavigationProp<'ProofGeneration'>>();
  const { passportData } = route.params;

  const { address } = useAccount();
  const chainId = useChainId();
  const { generate, isGenerating, error: proofError } = useProofGeneration();

  const [step, setStep] = useState<FlowStep>('generating');
  const [proofResult, setProofResult] = useState<BaseProofOutput | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  // wagmi writeContract hook
  const {
    writeContract,
    data: txHash,
    isPending: isTxPending,
    error: writeError,
  } = useWriteContract();

  // Wait for tx confirmation
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash, pollingInterval: 1000 });

  // Prevent back navigation during generation / submission
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    navigation.setOptions({ headerBackVisible: false, gestureEnabled: false });
  }, [navigation]);

  // Run proof generation once — wait for a real wallet address first
  useEffect(() => {
    if (hasStarted.current) return;
    if (!address) return;
    hasStarted.current = true;

    const walletAddress = address;

    void generate({
      rawDG1Hex: passportData.rawDG1Hex,
      rawSODHex: passportData.rawSODHex,
      walletAddress,
      passportExpiryUnix: mrzExpiryToUnix(passportData.dateOfExpiry),
    }).then((output) => {
      console.log('[PROOF] epochNullifier:', output.epochNullifier);
      setProofResult(output);
      setStep('proof_ready');
    }).catch(() => {
      setStep('error');
    });
  }, [address, generate, passportData]);

  // Navigate to success when tx is confirmed
  useEffect(() => {
    if (isConfirmed && txHash && address) {
      navigation.navigate('VerificationSuccess', {
        txHash,
        groupSize: 1,
        verifiedAddress: address,
        tier: 'base',
      });
    }
  }, [isConfirmed, txHash, navigation]);

  // Surface write/receipt errors
  useEffect(() => {
    const err = writeError ?? receiptError;
    if (err) {
      const baseErr = err as BaseError;
      const reason = baseErr.shortMessage ?? baseErr.message ?? 'Transaction failed';
      console.error('[TX] Error:', reason);
      setSubmitError(reason);
      setStep('error');
    }
  }, [writeError, receiptError]);

  const handleSubmit = useCallback(() => {
    if (!proofResult || !address) return;

    const supportedChainId = SUPPORTED_CHAIN_IDS.find((id) => id === chainId) as SupportedChainId | undefined;
    if (!supportedChainId) {
      setSubmitError(`Unsupported chain ${chainId}. Switch to a supported network.`);
      setStep('error');
      return;
    }

    const registryAddress = CONTRACT_ADDRESSES[supportedChainId].verificationRegistry;
    if (registryAddress === '0x0000000000000000000000000000000000000000') {
      setSubmitError('Contract not deployed on this chain. Deploy VerificationRegistry first.');
      setStep('error');
      return;
    }

    setStep('submitting');
    setSubmitError(null);

    // epochNullifier from proof is a decimal string — convert to bytes32
    const epochNullifierBytes32 = decimalToBytes32(proofResult.epochNullifier);
    const passportExpiry = Number(proofResult.zkProof.passportExpiry);

    console.log('[TX] Submitting registerBase to', registryAddress);
    console.log('[TX] epochNullifier:', epochNullifierBytes32);
    console.log('[TX] passportExpiry:', passportExpiry);
    console.log('[TX] proof bytes:', proofResult.zkProof.proof.slice(0, 34) + '...');

    writeContract({
      address: registryAddress,
      abi: VERIFICATION_REGISTRY_ABI,
      functionName: 'registerBase',
      args: [
        epochNullifierBytes32,
        passportExpiry,
        proofResult.zkProof.proof,
      ],
    });
  }, [proofResult, address, chainId, writeContract]);

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
  // Submitting state
  // -------------------------------------------------------------------------

  if (step === 'submitting' || isTxPending || isConfirming) {
    return (
      <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
        <View className="flex-1 px-6 py-8 justify-center items-center">
          <View className="w-24 h-24 rounded-full bg-indigo-900/30 items-center justify-center mb-8">
            <ActivityIndicator size="large" color="#818CF8" />
          </View>
          <Text className="text-white text-xl font-bold text-center mb-2">
            {isTxPending ? 'Confirm in Wallet' : 'Waiting for Confirmation'}
          </Text>
          <Text className="text-zinc-400 text-sm text-center max-w-xs mb-8">
            {isTxPending
              ? 'Please approve the transaction in your wallet app.'
              : 'Transaction submitted. Waiting for on-chain confirmation...'}
          </Text>
          {txHash && (
            <Text className="text-zinc-600 text-xs font-mono text-center">
              {txHash.slice(0, 18)}...{txHash.slice(-8)}
            </Text>
          )}
          {/* Step indicator — step 3 active */}
          <View className="flex-row gap-x-2 mb-4 w-full mt-8">
            <View className="h-1.5 rounded-full flex-1 bg-indigo-500" />
            <View className="h-1.5 rounded-full flex-1 bg-indigo-500" />
            <View className="h-1.5 rounded-full flex-1 bg-indigo-500" />
          </View>
          <Text className="text-zinc-500 text-xs">Step 3 of 3</Text>
        </View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (step === 'error') {
    const errorMessage = submitError ?? proofError ?? 'An unexpected error occurred. Please try again.';
    return (
      <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
        <View className="flex-1 px-6 py-8 justify-center items-center gap-y-4">
          <Text className="text-5xl">⚠️</Text>
          <Text className="text-red-400 text-lg font-semibold">
            {submitError ? 'Transaction Failed' : 'Proof Generation Failed'}
          </Text>
          <Text className="text-zinc-400 text-sm text-center max-w-xs">
            {errorMessage}
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
  // Proof ready state — show debug panel + submit button
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
            Ready to submit on-chain
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
          <DebugRow label="Chain ID" value={String(chainId)} mono />
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
                label="Epoch Nullifier"
                value={proofResult.epochNullifier}
                mono
              />
              <DebugRow
                label="Passport Expiry"
                value={proofResult.zkProof.passportExpiry}
                mono
              />
              <DebugRow
                label="ZK Proof bytes"
                value={`${proofResult.zkProof.proof.slice(0, 34)}...`}
                mono
              />
            </>
          )}
        </View>

        {/* Submit button */}
        <Pressable
          onPress={handleSubmit}
          className="w-full rounded-2xl py-4 items-center bg-indigo-600 active:bg-indigo-700"
        >
          <Text className="text-white text-base font-semibold">
            Submit Verification
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a decimal string to a bytes32 hex value (zero-padded, 0x-prefixed). */
function decimalToBytes32(decimal: string): `0x${string}` {
  const hex = BigInt(decimal).toString(16);
  return `0x${hex.padStart(64, '0')}` as `0x${string}`;
}

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
