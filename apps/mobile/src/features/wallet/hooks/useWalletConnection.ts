import { useCallback } from 'react';
import { useAccount, useDisconnect, useChainId } from 'wagmi';
import { useAppKit } from '@reown/appkit-react-native';

/**
 * Thin wrapper over wagmi + AppKit hooks.
 * Provides a single interface for the wallet connection UI.
 */
export function useWalletConnection() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { open: openAppKit } = useAppKit();

  const connect = useCallback(() => {
    void openAppKit();
  }, [openAppKit]);

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  return {
    address,
    shortAddress,
    isConnected,
    isConnecting: isConnecting || isReconnecting,
    chainId,
    connect,
    disconnect: handleDisconnect,
  } as const;
}
