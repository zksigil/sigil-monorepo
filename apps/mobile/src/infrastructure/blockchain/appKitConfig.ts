import { createAppKit } from '@reown/appkit-react-native';
import { WagmiAdapter } from '@reown/appkit-wagmi-react-native';
import { http } from 'wagmi';
import { sepolia, mainnet, anvil } from 'wagmi/chains';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Storage } from '@reown/appkit-react-native';

// ---------------------------------------------------------------------------
// Project ID — obtain from https://cloud.reown.com (free tier available)
// Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID in your .env file
// ---------------------------------------------------------------------------
const projectId = process.env['EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? '';

if (!projectId) {
  console.warn(
    '[AppKit] EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. ' +
    'WalletConnect features will not work. ' +
    'Create a project at https://cloud.reown.com and add it to .env',
  );
}

// ---------------------------------------------------------------------------
// AsyncStorage-backed Storage adapter required by AppKit React Native
// ---------------------------------------------------------------------------
export const appKitStorage: Storage = {
  getKeys: async () => {
    const keys = await AsyncStorage.getAllKeys();
    return [...keys];
  },

  getEntries: async <T = unknown>(): Promise<[string, T][]> => {
    const keys = await AsyncStorage.getAllKeys();
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs
      .filter((pair): pair is [string, string] => pair[1] !== null)
      .map(([key, value]) => [key, JSON.parse(value) as T]);
  },

  getItem: async <T = unknown>(key: string): Promise<T | undefined> => {
    const value = await AsyncStorage.getItem(key);
    if (value === null) return undefined;
    return JSON.parse(value) as T;
  },

  setItem: async <T = unknown>(key: string, value: T): Promise<void> => {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },

  removeItem: async (key: string): Promise<void> => {
    await AsyncStorage.removeItem(key);
  },
};

// ---------------------------------------------------------------------------
// WagmiAdapter — requires wagmi Chain tuple (readonly non-empty)
// ---------------------------------------------------------------------------
export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [sepolia, mainnet, anvil] as const,
  transports: {
    [sepolia.id]: http(
      process.env['EXPO_PUBLIC_SEPOLIA_RPC_URL'] ?? 'https://rpc.sepolia.org',
    ),
    [mainnet.id]: http(
      process.env['EXPO_PUBLIC_MAINNET_RPC_URL'] ?? 'https://ethereum.publicnode.com',
    ),
    [anvil.id]: http(
      process.env['EXPO_PUBLIC_ANVIL_RPC_URL'] ?? 'http://127.0.0.1:8545',
    ),
  },
});

// ---------------------------------------------------------------------------
// AppKit instance (singleton)
// ---------------------------------------------------------------------------
export const appKit = createAppKit({
  projectId,
  // wagmi Chain objects are structurally compatible with AppKit's Network type
  networks: [sepolia, mainnet, anvil] as unknown as Parameters<typeof createAppKit>[0]['networks'],
  defaultNetwork: sepolia,
  adapters: [wagmiAdapter],
  storage: appKitStorage,
  enableAnalytics: false,
  metadata: {
    name: 'ZK Identity Verifier',
    description: 'Verify your Ethereum wallet with your passport — privately.',
    url: 'https://zkidentity.app',
    icons: ['https://zkidentity.app/icon.png'],
    redirect: {
      native: 'zkidentity://',
      universal: 'https://zkidentity.app',
    },
  },
  features: {
    socials: false,
    onramp: false,
    swaps: false,
  },
});
