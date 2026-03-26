import { useCallback } from 'react';
import { useChainId, useSwitchChain } from 'wagmi';
import { useAccount } from 'wagmi';
import { sepolia, anvil } from 'viem/chains';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';

interface UseChainGuardResult {
  isWrongChain: boolean;
  switchToSepolia: () => void;
  switchToAnvil: () => void;
}

export function useChainGuard(): UseChainGuardResult {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  const isWrongChain =
    isConnected && !(SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);

  const switchToSepolia = useCallback(() => {
    switchChain({ chainId: sepolia.id });
  }, [switchChain]);

  const switchToAnvil = useCallback(() => {
    switchChain({ chainId: anvil.id });
  }, [switchChain]);

  return { isWrongChain, switchToSepolia, switchToAnvil };
}
