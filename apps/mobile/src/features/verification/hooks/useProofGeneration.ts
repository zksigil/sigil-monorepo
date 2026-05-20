import { useCallback, useState } from 'react';
import {
  generateSigilProof,
  generateStubProof,
  CSCA_MERKLE_ROOT,
  type ProofInput,
  type SigilProofOutput,
} from '../services/proofService';
import { IS_DEV_BUILD } from '../../../shared/constants/build';

export interface UseProofGenerationResult {
  generate: (input: ProofInput) => Promise<SigilProofOutput>;
  isGenerating: boolean;
  result: SigilProofOutput | null;
  error: string | null;
}

/**
 * Hook wrapping ZK proof generation for the unified sigil flow.
 *
 * Tries the real Mopro native module (UltraHonk-Keccak, ~5-15s on device).
 * Falls back to a stub proof if the native module is unavailable (development).
 */
export function useProofGeneration(): UseProofGenerationResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<SigilProofOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (input: ProofInput): Promise<SigilProofOutput> => {
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      if (!input.walletAddress || !input.walletAddress.startsWith('0x')) {
        throw new Error('Invalid address');
      }
      if (!input.rawDG1Hex) {
        throw new Error('Raw DG1 data is required');
      }
      if (!input.rawSODHex) {
        throw new Error('Raw SOD data is required');
      }

      let proofOutput: SigilProofOutput;

      try {
        proofOutput = await generateSigilProof(input);
      } catch (moproErr) {
        const innerMsg = (moproErr != null && typeof moproErr === 'object' && 'inner' in moproErr && Array.isArray((moproErr as { inner: unknown[] }).inner))
          ? String((moproErr as { inner: unknown[] }).inner[0])
          : null;
        const msg = innerMsg ?? (moproErr instanceof Error ? moproErr.message : '');
        // Stub fallback is a dev-only safety net for when Mopro hasn't been
        // built (e.g. fresh checkout, JS reload). Production bundles always
        // ship the native module, so this branch is stripped — any real prod
        // proof failure should surface, not be swallowed by a useless stub.
        const moproUnavailable =
          msg.includes('Mopro native module not available') ||
          msg.includes('circuit path not set') ||
          msg.includes('Incompatible versions of uniffi') ||
          msg.includes('ContractVersionMismatch');
        if (IS_DEV_BUILD && moproUnavailable) {
          console.warn('[PROOF] Mopro unavailable - using stub proof for development');
          const stub = generateStubProof(input);

          // Stub: nullifier and epoch_nullifier both derived from the keccak surrogate.
          // Real circuit uses Poseidon2; stub is only valid against MockUltraHonkVerifier.
          const stubNullifier = stub.passportNullifierHex;
          proofOutput = {
            zkProof: {
              proof: stub.zkProof.proof,
              vk: ('0x' + '00'.repeat(32)) as `0x${string}`,
              nullifier: stubNullifier,
              epochNullifier: stubNullifier,
              hashedAddress: stub.zkProof.publicSignals[1].toString(),
              passportExpiry: (input.passportExpiryUnix ?? 0).toString(),
              cscaMerkleRoot: CSCA_MERKLE_ROOT,
            },
            nullifier: stubNullifier,
            epochNullifier: stubNullifier,
            cscaMerkleRoot: CSCA_MERKLE_ROOT,
          };
        } else {
          throw moproErr;
        }
      }

      setResult(proofOutput);
      return proofOutput;
    } catch (err) {
      const innerMsg = (err != null && typeof err === 'object' && 'inner' in err && Array.isArray((err as { inner: unknown[] }).inner))
        ? String((err as { inner: unknown[] }).inner[0])
        : null;
      const message = innerMsg ?? (err instanceof Error ? err.message : 'Proof generation failed');
      console.error('[PROOF] Generation error:', message);
      setError(message);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return { generate, isGenerating, result, error };
}
