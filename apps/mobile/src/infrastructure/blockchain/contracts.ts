import type { Address } from 'viem';
import type { SupportedChainId } from '../../shared/constants/chains';

/**
 * Contract addresses per chain.
 *
 * Sepolia:  set EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS after deploying to Sepolia.
 * Anvil:    set EXPO_PUBLIC_ANVIL_REGISTRY_ADDRESS after running Deploy.s.sol locally.
 *           Address is deterministic per deployer nonce — re-run `forge script` to get it.
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
    verificationRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address,
  },
};
