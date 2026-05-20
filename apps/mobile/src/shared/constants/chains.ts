import { IS_DEV_BUILD } from './build';

// Display names cover all chains the app has ever supported. Production
// builds never reach the 31337 branch because anvil isn't registered with
// wagmi/AppKit, but keeping the entry costs nothing and avoids "Chain 31337"
// fallback labels in case of a misconfiguration.
export const CHAIN_DISPLAY_NAMES: Record<number, string> = {
  84532: 'Base Sepolia',
  8453: 'Base',
  31337: 'Anvil (local)',
} as const;

// Production bundles drop anvil so the chain switcher / "wrong network" UI
// never points at it. SupportedChainId keeps the full literal union for
// CONTRACT_ADDRESSES indexing.
export const SUPPORTED_CHAIN_IDS: readonly number[] = IS_DEV_BUILD
  ? [84532, 8453, 31337]
  : [84532, 8453];

export type SupportedChainId = 84532 | 8453 | 31337;
