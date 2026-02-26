import type { Address } from 'viem';
import type { SupportedChainId } from '../../shared/constants/chains';

/**
 * Contract addresses per chain.
 * After deploying VerificationRegistry.sol to Base Sepolia, update
 * EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS in .env AND this mapping.
 */
export const CONTRACT_ADDRESSES: Record<SupportedChainId, { verificationRegistry: Address }> = {
  84532: {
    verificationRegistry:
      (process.env['EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS'] as Address | undefined) ??
      '0x0000000000000000000000000000000000000000',
  },
  8453: {
    verificationRegistry: '0x0000000000000000000000000000000000000000',
  },
};
