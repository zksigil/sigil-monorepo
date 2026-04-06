import { useCallback, useState } from 'react';
import { useChainId } from 'wagmi';
import { createPublicClient, http } from 'viem';
import { anvil, sepolia, mainnet } from 'viem/chains';
import { RPC_URLS } from '../../../infrastructure/blockchain/appKitConfig';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';
import { recoverPrimaryNonce, type NonceRecoveryResult } from '../services/proofService';

const CHAIN_CONFIG = {
  31337: { chain: anvil, rpc: RPC_URLS[anvil.id] },
  11155111: { chain: sepolia, rpc: RPC_URLS[sepolia.id] },
  1: { chain: mainnet, rpc: RPC_URLS[mainnet.id] },
} as const;

function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

/**
 * Convert a decimal string to a bytes32 hex string.
 * Mopro returns nullifiers as decimal field element strings.
 */
function decimalToBytes32(decimal: string): `0x${string}` {
  const hex = BigInt(decimal).toString(16).padStart(64, '0');
  return `0x${hex}` as `0x${string}`;
}

export interface UseNonceRecoveryResult {
  /** Attempt nonce recovery using passport NFC data. */
  recover: (rawDG1Hex: string, rawSODHex: string) => Promise<NonceRecoveryResult | null>;
  isRecovering: boolean;
  result: NonceRecoveryResult | null;
  error: string | null;
}

/**
 * Hook for stateless primary-tier nonce recovery.
 *
 * After a phone loss, the user taps their passport and this hook iterates
 * nonces against on-chain primarySlots to find the active registration.
 * No AsyncStorage dependency — the passport + chain data is sufficient.
 */
export function useNonceRecovery(): UseNonceRecoveryResult {
  const chainId = useChainId();
  const [isRecovering, setIsRecovering] = useState(false);
  const [result, setResult] = useState<NonceRecoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recover = useCallback(async (rawDG1Hex: string, rawSODHex: string): Promise<NonceRecoveryResult | null> => {
    if (!isSupportedChain(chainId)) {
      setError('Unsupported chain');
      return null;
    }

    const contractAddress = CONTRACT_ADDRESSES[chainId].verificationRegistry;
    if (contractAddress === '0x0000000000000000000000000000000000000000') {
      setError('Contract not deployed on this chain');
      return null;
    }

    const cfg = CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG];
    if (!cfg) {
      setError('Chain configuration not found');
      return null;
    }

    setIsRecovering(true);
    setError(null);
    setResult(null);

    try {
      const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });

      const readSlot = async (nullifierDecimal: string) => {
        const nullifierBytes32 = decimalToBytes32(nullifierDecimal);
        const [hashedAddress, nextCommitment] = await client.readContract({
          address: contractAddress,
          abi: VERIFICATION_REGISTRY_ABI,
          functionName: 's_primarySlots',
          args: [nullifierBytes32],
        }) as [`0x${string}`, `0x${string}`];

        return {
          hashedAddress: hashedAddress as string,
          nextCommitment: nextCommitment as string,
        };
      };

      const recovered = await recoverPrimaryNonce(rawDG1Hex, rawSODHex, readSlot);
      setResult(recovered);
      return recovered;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nonce recovery failed';
      console.error('[RECOVERY] Error:', message);
      setError(message);
      return null;
    } finally {
      setIsRecovering(false);
    }
  }, [chainId]);

  return { recover, isRecovering, result, error };
}
