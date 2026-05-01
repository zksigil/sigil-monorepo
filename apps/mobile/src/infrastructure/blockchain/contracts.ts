import type { Address } from 'viem';
import type { SupportedChainId } from '../../shared/constants/chains';

/**
 * Contract addresses per chain.
 *
 * Base Sepolia (84532): set EXPO_PUBLIC_BASE_SEPOLIA_REGISTRY_ADDRESS after deploying
 *                       (see Deploy.s.sol).
 * Base mainnet (8453):  set EXPO_PUBLIC_BASE_REGISTRY_ADDRESS after the production deploy.
 * Anvil (31337):        set EXPO_PUBLIC_ANVIL_REGISTRY_ADDRESS after running DeployDev.s.sol.
 *                       Address is deterministic per deployer nonce — re-run the script to get it.
 *
 * Env vars are read at JS bundle time (Expo). Rebuild the app after changing them.
 */
export const CONTRACT_ADDRESSES: Record<SupportedChainId, { verificationRegistry: Address }> = {
  84532: {
    verificationRegistry:
      (process.env['EXPO_PUBLIC_BASE_SEPOLIA_REGISTRY_ADDRESS'] as Address | undefined) ??
      '0x0000000000000000000000000000000000000000',
  },
  8453: {
    verificationRegistry:
      (process.env['EXPO_PUBLIC_BASE_REGISTRY_ADDRESS'] as Address | undefined) ??
      '0x0000000000000000000000000000000000000000',
  },
  31337: {
    verificationRegistry:
      (process.env['EXPO_PUBLIC_ANVIL_REGISTRY_ADDRESS'] as Address | undefined) ??
      '0x0000000000000000000000000000000000000000',
  },
};
