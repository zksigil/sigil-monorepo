import { useCallback, useState } from 'react';
import {
  generateStubProof,
  type ProofInput,
  type ProofOutput,
} from '../services/proofService';

export interface UseProofGenerationResult {
  generate: (input: ProofInput) => Promise<ProofOutput>;
  isGenerating: boolean;
  result: ProofOutput | null;
  error: string | null;
}

/**
 * Hook wrapping stub ZK proof generation.
 *
 * Simulates async proof generation with a 1s delay to mirror the real
 * circuit proving time. In production, this will call Mopro SDK
 * that takes 5-15 seconds on device.
 */
export function useProofGeneration(): UseProofGenerationResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<ProofOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (input: ProofInput): Promise<ProofOutput> => {
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      // Validate inputs
      if (!input.walletAddress || !input.walletAddress.startsWith('0x')) {
        throw new Error('Invalid wallet address');
      }
      if (!input.rawDG1Hex) {
        throw new Error('Raw DG1 data is required');
      }
      if (!input.rawSODHex) {
        throw new Error('Raw SOD data is required');
      }

      // Simulate proving time (real Mopro circuits take 5-15s)
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      const proofOutput = generateStubProof(input);
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
