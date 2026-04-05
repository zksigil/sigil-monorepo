import { useCallback } from 'react';
import { Linking } from 'react-native';
import { useAppKit } from '@reown/appkit-react-native';
import { useWalletInfo } from '@reown/appkit-react-native';

/**
 * Returns a function that deep-links into the currently connected wallet app.
 * Uses AppKit's useWalletInfo() for the redirect URL (more reliable than raw
 * WC provider session), then falls back to opening the AppKit Account view.
 */
export function useOpenWallet(): () => void {
  const { walletInfo } = useWalletInfo();
  const { open: openAppKit } = useAppKit();

  return useCallback(() => {
    const url = walletInfo?.redirect?.native ?? walletInfo?.redirect?.universal;
    if (url) {
      void Linking.openURL(url);
    } else {
      void openAppKit({ view: 'Account' });
    }
  }, [walletInfo, openAppKit]);
}
