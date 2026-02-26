export const CHAIN_DISPLAY_NAMES: Record<number, string> = {
  84532: 'Base Sepolia',
  8453: 'Base',
  1: 'Ethereum',
  31337: 'Anvil (local)',
} as const;

export const SUPPORTED_CHAIN_IDS = [84532, 8453] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];
