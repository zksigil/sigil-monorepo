export const CHAIN_DISPLAY_NAMES: Record<number, string> = {
  11155111: 'Sepolia',
  1: 'Ethereum',
  31337: 'Anvil (local)',
} as const;

export const SUPPORTED_CHAIN_IDS = [11155111, 1, 31337] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];
