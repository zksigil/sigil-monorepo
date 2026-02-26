// CRITICAL: crypto polyfill must be imported FIRST — before React Native, before any other import.
// viem and WalletConnect use crypto.getRandomValues internally.
// Hermes JS engine does not implement the Web Crypto API natively.
import 'react-native-get-random-values';

// WalletConnect compat shims (must come before any WC/AppKit imports)
import '@walletconnect/react-native-compat';

// expo-dev-client enables the dev launcher UI for connecting to Metro on physical devices
import 'expo-dev-client';

import { registerRootComponent } from 'expo';
import App from './src/app/App';

registerRootComponent(App);
