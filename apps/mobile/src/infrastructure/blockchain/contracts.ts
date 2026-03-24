import type { Address } from 'viem';
import type { SupportedChainId } from '../../shared/constants/chains';

/**
 * Contract addresses per chain.
 * After deploying VerificationRegistry.sol to Sepolia, update
 * EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS in apps/mobile/.env AND this mapping.
 */
export const CONTRACT_ADDRESSES: Record<SupportedChainId, { verificationRegistry: Address }> = {
  11155111: {
    verificationRegistry:
      (process.env['EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS'] as Address | undefined) ??
      '0x0000000000000000000000000000000000000000',
  },
  1: {
    verificationRegistry: '0x0000000000000000000000000000000000000000',
  },
  31337: {
    verificationRegistry:
      (process.env['EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS'] as Address | undefined) ??
      '0x0000000000000000000000000000000000000000',
  },
};
