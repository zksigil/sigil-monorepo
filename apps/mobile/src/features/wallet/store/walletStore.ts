import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface WalletState {
  connectionStatus: ConnectionStatus;
  address: `0x${string}` | null;
  chainId: number | null;
  ensName: string | null;

  setConnectionStatus: (status: ConnectionStatus) => void;
  setAddress: (address: `0x${string}` | null) => void;
  setChainId: (chainId: number | null) => void;
  setEnsName: (name: string | null) => void;
  reset: () => void;
}

const initialState: Pick<WalletState, 'connectionStatus' | 'address' | 'chainId' | 'ensName'> = {
  connectionStatus: 'disconnected',
  address: null,
  chainId: null,
  ensName: null,
};

// Note: wagmi is the source of truth for on-chain state.
// This store holds derived/UI state that doesn't live in wagmi.
export const useWalletStore = create<WalletState>()((set) => ({
  ...initialState,

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setAddress: (address) => set({ address }),
  setChainId: (chainId) => set({ chainId }),
  setEnsName: (ensName) => set({ ensName }),
  reset: () => set(initialState),
}));
