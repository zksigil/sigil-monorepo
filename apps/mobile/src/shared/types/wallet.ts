export interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
  isConnected: boolean;
}
