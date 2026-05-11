import { useReadContract, useChainId } from 'wagmi';
import { SIGIL_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';

interface UseVerificationStatusResult {
  isVerified: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

export function useVerificationStatus(
  address: `0x${string}` | undefined,
): UseVerificationStatusResult {
  const chainId = useChainId();
  const enabled = address !== undefined && isSupportedChain(chainId);
  const contractAddress = isSupportedChain(chainId)
    ? CONTRACT_ADDRESSES[chainId].verificationRegistry
    : '0x0000000000000000000000000000000000000000';

  const {
    data: isVerifiedData,
    isLoading,
    isError,
    refetch,
  } = useReadContract({
    address: contractAddress,
    abi: SIGIL_REGISTRY_ABI,
    functionName: 'isVerified',
    args: address ? [address] : undefined,
    query: { enabled, staleTime: 0, refetchOnMount: 'always' },
  });

  return {
    isVerified: isVerifiedData ?? false,
    isLoading,
    isError,
    refetch: () => { void refetch(); },
  };
}
