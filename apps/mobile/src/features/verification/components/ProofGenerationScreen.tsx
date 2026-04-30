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
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { BaseError } from 'wagmi';
import { createPublicClient, http } from 'viem';
import { anvil, sepolia, mainnet } from 'viem/chains';
import { RPC_URLS } from '../../../infrastructure/blockchain/appKitConfig';
import type { RootStackRouteProp, RootStackNavigationProp } from '../../../app/navigation/types';
import { useProofGeneration } from '../hooks/useProofGeneration';
import type { BaseProofOutput, PrimaryProofOutput } from '../services/proofService';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import type { SupportedChainId } from '../../../shared/constants/chains';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowStep = 'generating' | 'proof_ready' | 'submitting' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Contract error → user-friendly message
// ---------------------------------------------------------------------------

/** Maps error name OR 4-byte selector to a user-friendly message. */
const CONTRACT_ERRORS: { name: string; selector: string; message: string }[] = [
  {
    name: 'VerificationRegistry__AlreadyRegistered',
    selector: '0x88eed74a',
    message: 'This address is already registered.',
  },
  {
    name: 'VerificationRegistry__PrimaryInCooldown',
    selector: '0xa80eb1f4',
    message:
      'Your primary registration is in a cooldown period. You must wait 7 days after unregistering before you can re-register.',
  },
  {
    name: 'VerificationRegistry__NullifierAlreadyUsed',
    selector: '0x85b930aa',
    message: 'This passport is already registered for primary verification. Unregister first.',
  },
  {
    name: 'VerificationRegistry__PassportExpired',
    selector: '0xe6a693bc',
    message: 'Your passport has expired. A valid passport is required for verification.',
  },
  {
    name: 'VerificationRegistry__RateLimitExceeded',
    selector: '0x6a2e40a8',
    message: 'Daily registration limit reached for this passport. Try again tomorrow.',
  },
  {
    name: 'VerificationRegistry__InvalidProof',
    selector: '0x3f9481dd',
    message: 'The proof was rejected by the verifier.',
  },
  {
    name: 'VerificationRegistry__NotRegistered',
    selector: '0xc2996607',
    message: 'No active registration found for this address.',
  },
  {
    name: 'VerificationRegistry__NotAuthorized',
    selector: '0x129696e4',
    message: 'You are not authorized for this action.',
  },
  // UltraHonk verifier errors (zkmopro-honk-zk template)
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

function parseContractError(err: unknown): string {
  const raw = (err as BaseError)?.shortMessage ?? (err as BaseError)?.message ?? '';
  // Log the full error shape so we can extract the raw revert data (selector)
  try {
    const anyErr = err as any;
    const cand =
      anyErr?.cause?.data ??
      anyErr?.data ??
      anyErr?.cause?.cause?.data ??
      anyErr?.cause?.raw ??
      anyErr?.details;
    console.log('[TX-ERR] shortMessage:', anyErr?.shortMessage);
    console.log('[TX-ERR] raw data field:', cand);
    console.log('[TX-ERR] cause.name:', anyErr?.cause?.name);
    console.log('[TX-ERR] metaMessages:', anyErr?.metaMessages);
  } catch {}
  for (const { name, selector, message } of CONTRACT_ERRORS) {
    if (raw.includes(name) || raw.includes(selector)) return message;
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

/**
 * Convert a field element to a bytes32 hex value (zero-padded, 0x-prefixed).
 * Accepts both decimal strings (from real Mopro) and 0x-prefixed hex strings (from stub).
 * BigInt() handles both forms natively.
 */
function decimalOrHexToBytes32(value: string): `0x${string}` {
  const hex = BigInt(value).toString(16);
  return `0x${hex.padStart(64, '0')}` as `0x${string}`;
}

// ---------------------------------------------------------------------------
// Standalone public client for simulation — avoids wagmi/WalletConnect transport
// which can fail when the app backgrounds during a WC session check.
// ---------------------------------------------------------------------------

const CHAIN_CONFIG = {
  31337: { chain: anvil, rpc: RPC_URLS[anvil.id] },
  11155111: { chain: sepolia, rpc: RPC_URLS[sepolia.id] },
  1: { chain: mainnet, rpc: RPC_URLS[mainnet.id] },
} as const;

function getPublicClient(chainId: number) {
  const cfg = CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG];
  if (!cfg) return null;
  return createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProofGenerationScreen(): React.JSX.Element {
  const route = useRoute<RootStackRouteProp<'ProofGeneration'>>();
  const navigation = useNavigation<RootStackNavigationProp<'ProofGeneration'>>();
  const { passportData, tier } = route.params;

  // The contract uses msg.sender — the tx must come from the connected address.
  const { address } = useAccount();
  const chainId = useChainId();
  const { generate, isGenerating, error: proofError } = useProofGeneration();

  const [step, setStep] = useState<FlowStep>('generating');
  const [proofResult, setProofResult] = useState<BaseProofOutput | PrimaryProofOutput | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  // Fires on every render so we can verify in device logs that the screen
  // mounted and what state branch is being taken.
  console.log('[PROOF-UI-RENDER] step=', step, 'isGenerating=', isGenerating, 'address=', address ? 'set' : 'unset');

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

  // Run proof generation once — wait for a real wallet address first.
  //
  // We defer the actual call by ~250ms (one nav animation frame) so the
  // navigation slide can finish and the loading-state modal can paint BEFORE
  // the heavy synchronous work in generate() (SHA-256 hashing, RSA-2048
  // signature verification, SOD ASN.1 parsing) blocks the JS thread.
  // setTimeout is used over InteractionManager because the new-arch nav stack
  // doesn't always register its animation as an InteractionManager handle.
  useEffect(() => {
    if (hasStarted.current) return;
    if (!address) return;
    hasStarted.current = true;

    console.log('[PROOF-UI] effect armed — deferring generate() by 250ms');
    const timer = setTimeout(() => {
      console.log('[PROOF-UI] deferred timer fired — starting generate()');
      void (async () => {
        try {
          const output = await generate({
            rawDG1Hex: passportData.rawDG1Hex,
            rawSODHex: passportData.rawSODHex,
            walletAddress: address,
            passportExpiryUnix: mrzExpiryToUnix(passportData.dateOfExpiry),
          }, tier);
          if (output.type === 'base') {
            console.log('[PROOF] epochNullifier:', output.epochNullifier);
          } else {
            console.log('[PROOF] nullifier:', output.nullifier);
          }
          setProofResult(output);
          setStep('proof_ready');
        } catch {
          setStep('error');
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [address, generate, passportData, tier]);

  // Navigate to success when tx is confirmed
  const navigatedRef = useRef(false);
  const navigateToSuccess = useCallback((hash: `0x${string}`, wallet: `0x${string}`) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    navigation.navigate('VerificationSuccess', {
      txHash: hash,
      groupSize: 1,
      verifiedAddress: wallet,
      tier,
    });
  }, [navigation, tier]);

  useEffect(() => {
    if (isConfirmed && txHash && address) {
      navigateToSuccess(txHash, address);
    }
  }, [isConfirmed, txHash, address, navigateToSuccess]);

  // When the app returns from background (e.g. after MetaMask approval), wagmi's
  // useWaitForTransactionReceipt may not resume polling on React Native. Manually
  // check the receipt using the standalone viem client as a fallback.
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
      }).catch(() => {
        // tx may not be mined yet — wagmi hook will keep polling
      });
    });
    return () => sub.remove();
  }, [txHash, address, chainId, navigateToSuccess]);

  // Surface write/receipt errors
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

    // Use a standalone viem publicClient for simulation so the RPC call
    // doesn't go through wagmi's WalletConnect transport (which fails when
    // the app backgrounds during a WC session check).
    const publicClient = getPublicClient(chainId);
    if (!publicClient) {
      setSubmitError(`No RPC configured for chain ${chainId}.`);
      setStep('error');
      return;
    }

    if (proofResult.type === 'primary') {
      const primaryCall = {
        address: registryAddress,
        abi: VERIFICATION_REGISTRY_ABI,
        functionName: 'registerPrimary' as const,
        args: [
          decimalOrHexToBytes32(proofResult.nullifier),
          Number(proofResult.zkProof.passportExpiry),
          proofResult.zkProof.proof,
        ] as const,
      };

      console.log('[PROOF SUBMIT] Input args:', {
        nullifier: decimalOrHexToBytes32(proofResult.nullifier),
        passportExpiry: Number(proofResult.zkProof.passportExpiry),
        proofLength: proofResult.zkProof.proof.length,
      });

      try {
        console.log('[TX] Simulating registerPrimary to', registryAddress);
        await publicClient.simulateContract({ ...primaryCall, account: address });
      } catch (simError) {
        console.error('[TX] Simulation failed:', simError);
        const friendly = parseContractError(simError);
        setSubmitError(friendly);
        setStep('error');
        return;
      }

      console.log('[TX] Simulation passed, submitting registerPrimary');
      writeContract(primaryCall);
    } else {
      const baseCall = {
        address: registryAddress,
        abi: VERIFICATION_REGISTRY_ABI,
        functionName: 'registerBase' as const,
        args: [
          decimalOrHexToBytes32(proofResult.epochNullifier),
          Number(proofResult.zkProof.passportExpiry),
          proofResult.zkProof.proof,
        ] as const,
      };

      try {
        console.log('[TX] Simulating registerBase to', registryAddress);
        const proofHex = proofResult.zkProof.proof;
        console.log('[TX-PROOF] bytes:', (proofHex.length - 2) / 2);
        console.log('[TX-PROOF-FULL]', proofHex);
        console.log('[TX-CAST-ARGS]', JSON.stringify({
          registry: registryAddress,
          epochNullifier: decimalOrHexToBytes32(proofResult.epochNullifier),
          passportExpiry: Number(proofResult.zkProof.passportExpiry),
          hashedAddress: proofResult.zkProof.hashedAddress,
          cscaMerkleRoot: proofResult.cscaMerkleRoot,
          sender: address,
        }));
        await publicClient.simulateContract({ ...baseCall, account: address });
      } catch (simError) {
        console.error('[TX] Simulation failed:', simError);
        const friendly = parseContractError(simError);
        setSubmitError(friendly);
        setStep('error');
        return;
      }

      console.log('[TX] Simulation passed, submitting registerBase');
      writeContract(baseCall);
    }
  }, [proofResult, address, chainId, writeContract]);

  // -------------------------------------------------------------------------
  // Generating state
  // -------------------------------------------------------------------------

  if (step === 'generating' || isGenerating) {
    console.log('[PROOF-UI] rendering loading state — step:', step, 'isGenerating:', isGenerating);
    return (
      <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
        {/* Visible content underneath the modal so even if Modal is broken, the
            user still sees the spinner and label. */}
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
          {/* Step indicator — step 3 active */}
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
  // Proof ready state — show debug panel + submit button
  // -------------------------------------------------------------------------

  const isPrimary = proofResult?.type === 'primary';

  return (
    <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
      <ScrollView className="flex-1 px-6 py-6" contentContainerClassName="pb-8">
        {/* Success indicator */}
        <View className="items-center mb-6">
          <View className="w-20 h-20 rounded-full bg-dracula-green/20 items-center justify-center mb-4">
            <Text className="text-4xl">✓</Text>
          </View>
          <Text className="text-dracula-green text-lg font-bold">Proof Generated</Text>
          <Text className="text-dracula-comment/70 text-xs mt-1">
            Ready to submit on-chain
          </Text>
        </View>

        {/* Step indicator — step 2 active */}
        <View className="flex-row gap-x-2 mb-6">
          <View className="h-1.5 rounded-full flex-1 bg-dracula-purple" />
          <View className="h-1.5 rounded-full flex-1 bg-dracula-purple" />
          <View className="h-1.5 rounded-full flex-1 bg-dracula-surface/70" />
        </View>

        {/* DEBUG PANEL */}
        <View className="bg-dracula-surface rounded-2xl p-4 mb-6">
          <Text className="text-dracula-orange text-xs font-bold uppercase tracking-wider mb-3">
            === Generated Proof Debug ===
          </Text>

          <DebugRow label="Action" value={tier === 'unique' ? 'Sigilize (sybil-resistant)' : 'Verify (proof of personhood)'} />
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
              <View className="h-px bg-dracula-comment/30 my-3" />
              <Text className="text-dracula-purple text-xs font-bold uppercase tracking-wider mb-2">
                Proof Values
              </Text>
              {isPrimary && proofResult.type === 'primary' ? (
                <DebugRow label="Nullifier" value={proofResult.nullifier} mono />
              ) : proofResult.type === 'base' ? (
                <DebugRow label="Epoch Nullifier" value={proofResult.epochNullifier} mono />
              ) : null}
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
          className="w-full rounded-2xl py-4 items-center bg-dracula-purple active:bg-dracula-purple/80"
        >
          <Text className="text-dracula-fg text-base font-semibold">
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

/**
 * Spinner inside a circle, with two pulsing rings expanding outward to give
 * a sense of motion while Mopro generates the proof on-device (~5–15s).
 */
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
    // Stagger so the two rings don't overlap
    const delay = setTimeout(() => animB.start(), 900);
    return () => {
      clearTimeout(delay);
      animA.stop();
      animB.stop();
    };
  }, [pulseA, pulseB]);

  // Inline styles for the rings — NativeWind classNames don't always compose
  // with Animated.View's style prop, especially for border colors. Hardcoding
  // here guarantees the rings render.
  const RING_SIZE = 96;
  const RING_COLOR = '#bd93f9'; // dracula-purple

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

/**
 * Cycles through friendly status messages while the proof is being generated.
 * Mopro doesn't expose progress callbacks, so the messages are timed; they
 * give the user a sense of motion without claiming real progress.
 */
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
      // Swap message at the midpoint of the fade
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
