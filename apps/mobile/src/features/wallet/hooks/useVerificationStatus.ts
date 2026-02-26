import { useReadContract } from 'wagmi';
import { useChainId } from 'wagmi';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';
import type { WalletInfo } from '@zkproof-verifier/shared-types';

interface UseVerificationStatusResult {
  isVerified: boolean;
  walletInfo: WalletInfo | null;
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
    isLoading: isVerifiedLoading,
    isError: isVerifiedError,
    refetch: refetchVerified,
  } = useReadContract({
    address: contractAddress,
    abi: VERIFICATION_REGISTRY_ABI,
    functionName: 'isVerified',
    args: address ? [address] : undefined,
    query: { enabled },
  });

  const {
    data: walletInfoData,
    isLoading: isWalletInfoLoading,
    isError: isWalletInfoError,
    refetch: refetchWalletInfo,
  } = useReadContract({
    address: contractAddress,
    abi: VERIFICATION_REGISTRY_ABI,
    functionName: 'getWalletInfo',
    args: address ? [address] : undefined,
    query: { enabled },
  });

  const walletInfo: WalletInfo | null = walletInfoData
    ? {
        verified: walletInfoData.verified,
        previouslyUnregistered: walletInfoData.previouslyUnregistered,
        groupSizeAtVerification: walletInfoData.groupSizeAtVerification,
        verifiedAt: walletInfoData.verifiedAt,
        identityCommitment: walletInfoData.identityCommitment,
      }
    : null;

  const refetch = () => {
    void refetchVerified();
    void refetchWalletInfo();
  };

  return {
    isVerified: isVerifiedData ?? false,
    walletInfo,
    isLoading: isVerifiedLoading || isWalletInfoLoading,
    isError: isVerifiedError || isWalletInfoError,
    refetch,
  };
}
