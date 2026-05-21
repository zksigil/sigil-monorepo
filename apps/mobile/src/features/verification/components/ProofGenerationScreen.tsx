import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAccount, useChainId, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { BaseError } from 'wagmi';
import { getPublicClient } from '../../../infrastructure/blockchain/publicClient';
import type { RootStackRouteProp, RootStackNavigationProp } from '../../../app/navigation/types';
import { useProofGeneration } from '../hooks/useProofGeneration';
import type { SigilProofOutput } from '../services/proofService';
import { SIGIL_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import type { SupportedChainId } from '../../../shared/constants/chains';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import { IS_DEV_BUILD } from '../../../shared/constants/build';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowStep = 'generating' | 'proof_ready' | 'submitting' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Contract error → user-friendly message
// ---------------------------------------------------------------------------

const CONTRACT_ERRORS: { name: string; selector: string; message: string }[] = [
  {
    name: 'SigilRegistry__AlreadyRegistered',
    selector: '0x88eed74a',
    message: 'This address is already sigilized.',
  },
  {
    name: 'SigilRegistry__PassportExpired',
    selector: '0xe6a693bc',
    message: 'Your passport has expired. A valid passport is required to sigilize.',
  },
  {
    name: 'SigilRegistry__RateLimitExceeded',
    selector: '0x6a2e40a8',
    message: 'Daily registration limit reached for this passport. Try again tomorrow.',
  },
  {
    name: 'SigilRegistry__InvalidProof',
    selector: '0x3f9481dd',
    message: 'The proof was rejected by the verifier.',
  },
  {
    name: 'SigilRegistry__NotRegistered',
    selector: '0xc2996607',
    message: 'No active registration found for this address.',
  },
  {
    name: 'SigilRegistry__NullifierMismatch',
    selector: '',
    message: 'The passport does not match the existing registration.',
  },
  {
    name: 'SumcheckFailed',
    selector: '0x9fc3a218',
    message: 'UltraHonk: Sumcheck verification failed (likely VK/transcript mismatch).',
  },
  {
    name: 'ShpleminiFailed',
    selector: '0xa5d82e8a',
    message: 'UltraHonk: Shplemini pairing check failed.',
  },
  {
    name: 'ProofLengthWrong',
    selector: '0xed74ac0a',
    message: 'UltraHonk: Proof length does not match PROOF_SIZE.',
  },
  {
    name: 'PublicInputsLengthWrong',
    selector: '0xfa066593',
    message: 'UltraHonk: Public inputs count does not match publicInputsSize.',
  },
  {
    name: 'ConsistencyCheckFailed',
    selector: '0xa2a2ac83',
    message: 'UltraHonk: Commitment consistency check failed.',
  },
  {
    name: 'GeminiChallengeInSubgroup',
    selector: '0x835eb8f7',
    message: 'UltraHonk: Gemini challenge landed in subgroup (should be negligible).',
  },
];

/**
 * Shape of viem/wagmi error objects we read from. Not all fields exist on every
 * error, hence the `unknown` types; we only access via optional chaining.
 */
interface ViemErrorShape {
  shortMessage?: string;
  message?: string;
  data?: unknown;
  details?: unknown;
  metaMessages?: unknown;
  cause?: {
    name?: string;
    data?: unknown;
    raw?: unknown;
    cause?: { data?: unknown };
  };
}

function parseContractError(err: unknown): string {
  const e = err as ViemErrorShape;
  const raw = e?.shortMessage ?? e?.message ?? (err as BaseError)?.message ?? '';
  try {
    const cand =
      e?.cause?.data ??
      e?.data ??
      e?.cause?.cause?.data ??
      e?.cause?.raw ??
      e?.details;
    console.log('[TX-ERR] shortMessage:', e?.shortMessage);
    console.log('[TX-ERR] raw data field:', cand);
    console.log('[TX-ERR] cause.name:', e?.cause?.name);
    console.log('[TX-ERR] metaMessages:', e?.metaMessages);
  } catch {}
  for (const { name, selector, message } of CONTRACT_ERRORS) {
    if (raw.includes(name) || (selector && raw.includes(selector))) return message;
  }
  return raw || 'Transaction simulation failed. Please try again.';
}

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

/** Convert a field element decimal string OR 0x-prefixed hex to bytes32. */
function decimalOrHexToBytes32(value: string): `0x${string}` {
  const hex = BigInt(value).toString(16);
  return `0x${hex.padStart(64, '0')}` as `0x${string}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProofGenerationScreen(): React.JSX.Element {
  const route = useRoute<RootStackRouteProp<'ProofGeneration'>>();
  const navigation = useNavigation<RootStackNavigationProp<'ProofGeneration'>>();
  const { passportData, mode } = route.params;

  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { generate, isGenerating, error: proofError } = useProofGeneration();

  const [step, setStep] = useState<FlowStep>('generating');
  const [proofResult, setProofResult] = useState<SigilProofOutput | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  console.log('[PROOF-UI-RENDER] step=', step, 'isGenerating=', isGenerating, 'address=', address ? 'set' : 'unset');

  const {
    writeContract,
    data: txHash,
    isPending: isTxPending,
    error: writeError,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash, pollingInterval: 1000 });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    navigation.setOptions({ headerBackVisible: false, gestureEnabled: false });
  }, [navigation]);

  // Defer the heavy synchronous work (SHA-256 hashing, RSA verification, SOD parsing)
  // by ~250ms so the loading-state modal can paint before the JS thread blocks.
  useEffect(() => {
    if (hasStarted.current) return;
    if (!address) return;
    hasStarted.current = true;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const output = await generate({
            rawDG1Hex: passportData.rawDG1Hex,
            rawSODHex: passportData.rawSODHex,
            walletAddress: address,
            passportExpiryUnix: mrzExpiryToUnix(passportData.dateOfExpiry),
          });
          console.log('[PROOF] nullifier:', output.nullifier);
          console.log('[PROOF] epoch_nullifier:', output.epochNullifier);
          setProofResult(output);
          setStep('proof_ready');
        } catch {
          setStep('error');
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [address, generate, passportData]);

  const navigatedRef = useRef(false);
  const navigateToSuccess = useCallback((hash: `0x${string}`, wallet: `0x${string}`) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    navigation.navigate('VerificationSuccess', {
      txHash: hash,
      verifiedAddress: wallet,
      mode,
    });
  }, [navigation, mode]);

  useEffect(() => {
    if (isConfirmed && txHash && address) {
      navigateToSuccess(txHash, address);
    }
  }, [isConfirmed, txHash, address, navigateToSuccess]);

  // Foreground listener: useWaitForTransactionReceipt may not resume polling on RN
  // when the app backgrounds for MetaMask. Manually poll on foreground return.
  useEffect(() => {
    if (!txHash || !address) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const client = getPublicClient(chainId);
      if (!client) return;
      void client.getTransactionReceipt({ hash: txHash }).then((receipt) => {
        if (receipt.status === 'success') {
          console.log('[TX] Receipt found on foreground return');
          navigateToSuccess(txHash, address);
        }
      }).catch(() => { /* tx may not be mined yet */ });
    });
    return () => sub.remove();
  }, [txHash, address, chainId, navigateToSuccess]);

  useEffect(() => {
    const err = writeError ?? receiptError;
    if (err) {
      const reason = parseContractError(err);
      console.error('[TX] Error:', reason);
      setSubmitError(reason);
      setStep('error');
    }
  }, [writeError, receiptError]);

  const handleSubmit = useCallback(async () => {
    if (!proofResult || !address) return;

    const supportedChainId = SUPPORTED_CHAIN_IDS.find((id) => id === chainId) as SupportedChainId | undefined;
    if (!supportedChainId) {
      setSubmitError(`Unsupported chain ${chainId}. Switch to a supported network.`);
      setStep('error');
      return;
    }

    const registryAddress = CONTRACT_ADDRESSES[supportedChainId].verificationRegistry;
    if (registryAddress === '0x0000000000000000000000000000000000000000') {
      setSubmitError(`No registry address for chain ${supportedChainId}. Switch wallet network or rebuild app with EXPO_PUBLIC_*_REGISTRY_ADDRESS set.`);
      setStep('error');
      return;
    }

    setStep('submitting');
    setSubmitError(null);

    // MetaMask 7.57+ removed the global chain picker (multichain accounts).
    // Passing `chainId` to writeContract no longer reliably triggers an in-wallet
    // switch over WalletConnect, so we drive it explicitly. No-op if the wallet
    // is already on the right chain; on 4902 the user must add the network first.
    try {
      await switchChainAsync({ chainId: supportedChainId });
    } catch (switchErr) {
      const e = switchErr as { code?: number; message?: string };
      if (e.code === 4902) {
        setSubmitError(`Base Sepolia isn't added to your wallet. Add it (chain ID ${supportedChainId}, RPC sepolia.base.org) and retry.`);
      } else if (e.code === 4001) {
        setSubmitError('Network switch was declined. Approve the switch in your wallet and retry.');
      } else {
        setSubmitError(`Could not switch wallet to chain ${supportedChainId}: ${e.message ?? 'unknown error'}`);
      }
      setStep('error');
      return;
    }

    const publicClient = getPublicClient(supportedChainId);
    if (!publicClient) {
      setSubmitError(`No RPC configured for chain ${supportedChainId}.`);
      setStep('error');
      return;
    }

    // passportExpiry is uint48 — viem types this as `number` in the generated ABI;
    // a unix-second uint48 fits comfortably in Number.MAX_SAFE_INTEGER (2^53-1).
    // register() and renew() take identical args; only the function name differs.
    const call = {
      address: registryAddress,
      abi: SIGIL_REGISTRY_ABI,
      functionName: mode,
      args: [
        decimalOrHexToBytes32(proofResult.nullifier),
        decimalOrHexToBytes32(proofResult.epochNullifier),
        Number(proofResult.zkProof.passportExpiry),
        proofResult.zkProof.proof,
      ] as const,
      chainId: supportedChainId,
    } as const;

    try {
      console.log(`[TX] Simulating ${mode} to`, registryAddress);
      console.log('[TX-CAST-ARGS]', JSON.stringify({
        registry: registryAddress,
        mode,
        nullifier: decimalOrHexToBytes32(proofResult.nullifier),
        epochNullifier: decimalOrHexToBytes32(proofResult.epochNullifier),
        passportExpiry: Number(proofResult.zkProof.passportExpiry),
        sender: address,
      }));
      await publicClient.simulateContract({ ...call, account: address });
    } catch (simError) {
      console.error('[TX] Simulation failed:', simError);
      setSubmitError(parseContractError(simError));
      setStep('error');
      return;
    }

    console.log(`[TX] Simulation passed, submitting ${mode}`);
    writeContract(call);
  }, [proofResult, address, chainId, switchChainAsync, writeContract, mode]);

  // -------------------------------------------------------------------------
  // Generating state
  // -------------------------------------------------------------------------

  if (step === 'generating' || isGenerating) {
    return (
      <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
        <View className="flex-1 px-6 py-8 justify-center items-center">
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: 'rgba(189, 147, 249, 0.2)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 24,
            }}
          >
            <ActivityIndicator size="large" color="#bd93f9" />
          </View>
          <Text className="text-dracula-fg text-xl font-bold text-center mb-2">
            Generating ZK Proof
          </Text>
          <Text className="text-dracula-comment text-sm text-center max-w-xs">
            Hashing passport data and building zero-knowledge proof…
          </Text>
        </View>

        <Modal visible transparent animationType="fade" statusBarTranslucent>
          <View className="flex-1 bg-black/70 items-center justify-center px-8">
            <View className="bg-dracula-surface rounded-3xl px-8 pt-8 pb-7 items-center w-full max-w-sm">
              <ProofLoadingIndicator />
              <Text className="text-dracula-fg text-lg font-bold text-center mb-2">
                Generating ZK Proof
              </Text>
              <ProofLoadingStatus />
              <View className="flex-row gap-x-2 mb-3 w-full">
                <View className="h-1.5 rounded-full flex-1 bg-dracula-purple" />
                <View className="h-1.5 rounded-full flex-1 bg-dracula-surface/70" />
                <View className="h-1.5 rounded-full flex-1 bg-dracula-surface/70" />
              </View>
              <Text className="text-dracula-comment/70 text-xs mb-4">Step 1 of 3</Text>
              <Text className="text-dracula-comment/60 text-xs text-center leading-5">
                Please do not close the app.{'\n'}
                This process cannot be interrupted.
              </Text>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Submitting state
  // -------------------------------------------------------------------------

  if (step === 'submitting' || isTxPending || isConfirming) {
    return (
      <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
        <View className="flex-1 px-6 py-8 justify-center items-center">
          <View className="w-24 h-24 rounded-full bg-dracula-purple/20 items-center justify-center mb-8">
            <ActivityIndicator size="large" color="#818CF8" />
          </View>
          <Text className="text-dracula-fg text-xl font-bold text-center mb-2">
            {isTxPending ? 'Confirm in Wallet' : 'Waiting for Confirmation'}
          </Text>
          <Text className="text-dracula-comment text-sm text-center max-w-xs mb-8">
            {isTxPending
              ? 'Please approve the transaction in your wallet app.'
              : 'Transaction submitted. Waiting for on-chain confirmation...'}
          </Text>
          {txHash && (
            <Text className="text-dracula-comment/50 text-xs font-mono text-center">
              {txHash.slice(0, 18)}...{txHash.slice(-8)}
            </Text>
          )}
          <View className="flex-row gap-x-2 mb-4 w-full mt-8">
            <View className="h-1.5 rounded-full flex-1 bg-dracula-purple" />
            <View className="h-1.5 rounded-full flex-1 bg-dracula-purple" />
            <View className="h-1.5 rounded-full flex-1 bg-dracula-purple" />
          </View>
          <Text className="text-dracula-comment/70 text-xs">Step 3 of 3</Text>
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
      <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
        <View className="flex-1 px-6 py-8 justify-center items-center gap-y-4">
          <Text className="text-5xl">⚠️</Text>
          <Text className="text-dracula-red text-lg font-semibold">
            {submitError ? 'Transaction Failed' : 'Proof Generation Failed'}
          </Text>
          <Text className="text-dracula-comment text-sm text-center max-w-xs">
            {errorMessage}
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            className="w-full rounded-2xl py-4 items-center bg-dracula-surface/70 active:bg-dracula-comment/40 mt-4"
          >
            <Text className="text-dracula-fg text-base font-semibold">Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Proof ready state
  // -------------------------------------------------------------------------

  return (
    <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
      <ScrollView className="flex-1 px-6 py-6" contentContainerClassName="pb-8">
        <View className="items-center mb-6">
          <View className="w-20 h-20 rounded-full bg-dracula-green/20 items-center justify-center mb-4">
            <Text className="text-4xl">✓</Text>
          </View>
          <Text className="text-dracula-green text-lg font-bold">Proof Generated</Text>
          <Text className="text-dracula-comment/70 text-xs mt-1">
            Ready to submit on-chain
          </Text>
        </View>

        <View className="flex-row gap-x-2 mb-6">
          <View className="h-1.5 rounded-full flex-1 bg-dracula-purple" />
          <View className="h-1.5 rounded-full flex-1 bg-dracula-purple" />
          <View className="h-1.5 rounded-full flex-1 bg-dracula-surface/70" />
        </View>

        {IS_DEV_BUILD && (
          <View className="bg-dracula-surface rounded-2xl p-4 mb-6">
            <Text className="text-dracula-orange text-xs font-bold uppercase tracking-wider mb-3">
              === Generated Proof Debug ===
            </Text>

            <DebugRow label="Address" value={address ?? '(not connected)'} mono />
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
                <View className="h-px bg-dracula-comment/30 my-3" />
                <Text className="text-dracula-purple text-xs font-bold uppercase tracking-wider mb-2">
                  Proof Values
                </Text>
                <DebugRow label="Nullifier" value={proofResult.nullifier} mono />
                <DebugRow label="Epoch Nullifier" value={proofResult.epochNullifier} mono />
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
        )}

        <Pressable
          onPress={handleSubmit}
          className="w-full rounded-2xl py-4 items-center bg-dracula-purple active:bg-dracula-purple/80"
        >
          <Text className="text-dracula-fg text-base font-semibold">
            {mode === 'renew' ? 'Submit Renewal' : 'Submit Sigilization'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Helpers
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
      <Text className="text-dracula-comment/70 text-xs mr-2 flex-shrink-0">{label}</Text>
      <Text
        className={`text-dracula-fg text-xs flex-1 text-right ${mono ? 'font-mono' : ''}`}
        numberOfLines={2}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Proof loading visuals
// ---------------------------------------------------------------------------

function ProofLoadingIndicator(): React.JSX.Element {
  const pulseA = useRef(new Animated.Value(0)).current;
  const pulseB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (value: Animated.Value) =>
      Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
      );
    const animA = make(pulseA);
    const animB = make(pulseB);
    animA.start();
    const delay = setTimeout(() => animB.start(), 900);
    return () => {
      clearTimeout(delay);
      animA.stop();
      animB.stop();
    };
  }, [pulseA, pulseB]);

  const RING_SIZE = 96;
  const RING_COLOR = '#bd93f9';

  const ringStyle = (value: Animated.Value) => ({
    position: 'absolute' as const,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    borderColor: RING_COLOR,
    transform: [
      {
        scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }),
      },
    ],
    opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
  });

  return (
    <View
      style={{
        width: RING_SIZE,
        height: RING_SIZE,
        marginBottom: 32,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View pointerEvents="none" style={ringStyle(pulseA)} />
      <Animated.View pointerEvents="none" style={ringStyle(pulseB)} />
      <View className="w-24 h-24 rounded-full bg-dracula-purple/20 items-center justify-center">
        <ActivityIndicator size="large" color="#818CF8" />
      </View>
    </View>
  );
}

function ProofLoadingStatus(): React.JSX.Element {
  const messages = useMemo(
    () => [
      'Hashing passport data…',
      'Verifying certificate chain…',
      'Computing nullifier…',
      'Building zero-knowledge proof…',
      'Almost there…',
    ],
    [],
  );
  const [index, setIndex] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        setIndex((i) => (i + 1 < messages.length ? i + 1 : i));
      }, 250);
    }, 2800);
    return () => clearInterval(interval);
  }, [messages.length, opacity]);

  return (
    <Animated.Text
      style={{ opacity }}
      className="text-dracula-comment text-sm text-center max-w-xs mb-8"
    >
      {messages[index]}
    </Animated.Text>
  );
}
