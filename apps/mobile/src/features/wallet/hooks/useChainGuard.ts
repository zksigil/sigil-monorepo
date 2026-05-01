import { useCallback } from 'react';
import { useChainId, useSwitchChain } from 'wagmi';
import { useAccount } from 'wagmi';
import { baseSepolia, anvil } from 'viem/chains';
import { SUPPORTED_CHAIN_IDS, type SupportedChainId } from '../../../shared/constants/chains';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface UseChainGuardResult {
  isWrongChain: boolean;
  switchToBaseSepolia: () => void;
  switchToAnvil: () => void;
}

/**
 * `isWrongChain` is true when the user is connected but the current chain either:
 *   1. Isn't in `SUPPORTED_CHAIN_IDS`, OR
 *   2. Is supported in principle but has no registry address configured for it
 *      (e.g. Base mainnet before the production deploy).
 *
 * Either way, the right action is "switch to Base Sepolia" — the only chain we
 * actively support today. The banner copy reflects that.
 */
export function useChainGuard(): UseChainGuardResult {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  const isSupportedChain = (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
  const registryAddress = isSupportedChain
    ? CONTRACT_ADDRESSES[chainId as SupportedChainId].verificationRegistry
    : ZERO_ADDRESS;
  const hasRegistry = registryAddress !== ZERO_ADDRESS;

  const isWrongChain = isConnected && !hasRegistry;

  const switchToBaseSepolia = useCallback(() => {
    switchChain({ chainId: baseSepolia.id });
  }, [switchChain]);

  const switchToAnvil = useCallback(() => {
    switchChain({ chainId: anvil.id });
  }, [switchChain]);

  return { isWrongChain, switchToBaseSepolia, switchToAnvil };
}
