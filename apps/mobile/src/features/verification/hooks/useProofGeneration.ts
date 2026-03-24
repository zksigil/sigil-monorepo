import { useCallback, useState } from 'react';
import {
  generateBaseProof,
  generateStubProof,
  type ProofInput,
  type BaseProofOutput,
} from '../services/proofService';

export interface UseProofGenerationResult {
  generate: (input: ProofInput) => Promise<BaseProofOutput>;
  isGenerating: boolean;
  result: BaseProofOutput | null;
  error: string | null;
}

/**
 * Hook wrapping base-tier ZK proof generation.
 *
 * Tries the real Mopro native module (UltraHonk-Keccak, ~5–15s on device).
 * Falls back to a stub proof if the native module is unavailable (development).
 */
export function useProofGeneration(): UseProofGenerationResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<BaseProofOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (input: ProofInput): Promise<BaseProofOutput> => {
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      if (!input.walletAddress || !input.walletAddress.startsWith('0x')) {
        throw new Error('Invalid wallet address');
      }
      if (!input.rawDG1Hex) {
        throw new Error('Raw DG1 data is required');
      }
      if (!input.rawSODHex) {
        throw new Error('Raw SOD data is required');
      }

      let proofOutput: BaseProofOutput;

      try {
        proofOutput = await generateBaseProof(input);
      } catch (moproErr) {
        const msg = moproErr instanceof Error ? moproErr.message : '';
        if (
          msg.includes('Mopro native module not available') ||
          msg.includes('circuit path not set')
        ) {
          // Development fallback: stub proof (not verifiable on-chain)
          console.warn('[PROOF] Mopro unavailable — using stub proof for development');
          const stub = generateStubProof(input);
          proofOutput = {
            type: 'base',
            zkProof: {
              proof: stub.zkProof.proof,
              vk: ('0x' + '00'.repeat(32)) as `0x${string}`,
              epochNullifier: stub.passportNullifierHex,
              hashedAddress: stub.zkProof.publicSignals[1].toString(),
              passportExpiry: (input.passportExpiryUnix ?? 0).toString(),
            },
            epochNullifier: stub.passportNullifierHex,
          };
        } else {
          throw moproErr;
        }
      }

      setResult(proofOutput);
      return proofOutput;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Proof generation failed';
      console.error('[PROOF] Generation error:', message);
      setError(message);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return { generate, isGenerating, result, error };
}
