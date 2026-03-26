import { useCallback } from 'react';
import { Linking } from 'react-native';
import { useConnectors } from 'wagmi';
import { useAppKit } from '@reown/appkit-react-native';

/**
 * Returns a function that deep-links into the currently connected wallet app.
 * Reads the native/universal redirect URL from the active WalletConnect session.
 * Falls back to opening the AppKit modal if no redirect URL is found.
 */
export function useOpenWallet(): () => void {
  const connectors = useConnectors();
  const { open: openAppKit } = useAppKit();

  return useCallback(() => {
    const wcConnector = connectors.find((c) => c.type === 'walletConnect');
    if (!wcConnector) {
      void openAppKit();
      return;
    }

    wcConnector.getProvider().then((provider) => {
      // WalletConnect EthereumProvider stores the wallet's redirect in the session
      const redirect = (provider as {
        session?: { peer?: { metadata?: { redirect?: { native?: string; universal?: string } } } };
      })?.session?.peer?.metadata?.redirect;

      const url = redirect?.native ?? redirect?.universal;
      if (url) {
        void Linking.openURL(url);
      } else {
        void openAppKit();
      }
    }).catch(() => {
      void openAppKit();
    });
  }, [connectors, openAppKit]);
}
