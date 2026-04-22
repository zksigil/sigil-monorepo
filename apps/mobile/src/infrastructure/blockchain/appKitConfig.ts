import { createAppKit } from '@reown/appkit-react-native';
import { WagmiAdapter } from '@reown/appkit-wagmi-react-native';
import { http } from 'wagmi';
import { sepolia, mainnet, anvil as anvilDefault } from 'wagmi/chains';
import { defineChain } from 'viem';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Storage } from '@reown/appkit-react-native';

// ---------------------------------------------------------------------------
// Override anvil's default RPC (127.0.0.1) with the LAN IP so that all
// viem/wagmi internals use the correct URL on a physical device.
// ---------------------------------------------------------------------------
const ANVIL_RPC = process.env['EXPO_PUBLIC_ANVIL_RPC_URL'] ?? 'http://192.168.45.10:8545';
const anvil = defineChain({
  ...anvilDefault,
  rpcUrls: {
    default: { http: [ANVIL_RPC] },
  },
});

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
// RPC URLs — single source of truth for all transports (wagmi + standalone viem clients)
// ---------------------------------------------------------------------------
export const RPC_URLS = {
  [anvil.id]: process.env['EXPO_PUBLIC_ANVIL_RPC_URL'] ?? 'http://192.168.45.10:8545',
  [sepolia.id]: process.env['EXPO_PUBLIC_SEPOLIA_RPC_URL'] ?? 'https://rpc.sepolia.org',
  [mainnet.id]: process.env['EXPO_PUBLIC_MAINNET_RPC_URL'] ?? 'https://ethereum.publicnode.com',
} as const;

// ---------------------------------------------------------------------------
// WagmiAdapter — requires wagmi Chain tuple (readonly non-empty)
// ---------------------------------------------------------------------------
export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [sepolia, mainnet, anvil] as const,
  transports: {
    [sepolia.id]: http(RPC_URLS[sepolia.id]),
    [mainnet.id]: http(RPC_URLS[mainnet.id]),
    [anvil.id]: http(RPC_URLS[anvil.id]),
  },
});

// ---------------------------------------------------------------------------
// AppKit instance (singleton)
// ---------------------------------------------------------------------------
export const appKit = createAppKit({
  projectId,
  // wagmi Chain objects are structurally compatible with AppKit's Network type
  networks: [sepolia, mainnet, anvil] as unknown as Parameters<typeof createAppKit>[0]['networks'],
  defaultNetwork: anvil,
  adapters: [wagmiAdapter],
  storage: appKitStorage,
  enableAnalytics: false,
  metadata: {
    name: 'Sigil',
    description: 'Verify your Ethereum wallet with your passport — privately.',
    url: 'https://sigil.app',
    icons: ['https://sigil.app/icon.png'],
    redirect: {
      native: 'sigil://',
      universal: 'https://sigil.app',
    },
  },
  features: {
    socials: false,
    onramp: false,
    swaps: false,
  },
  // customWallets are set synchronously in the AppKit constructor — they appear
  // immediately when the connect view renders, with no API fetch required.
  customWallets: [
    {
      id: 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
      name: 'MetaMask',
      mobile_link: 'metamask://',
      app_store: 'https://apps.apple.com/us/app/metamask/id1438144202',
      play_store: 'https://play.google.com/store/apps/details?id=io.metamask',
    },
    {
      id: 'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa',
      name: 'Coinbase Wallet',
      mobile_link: 'cbwallet://',
      app_store: 'https://apps.apple.com/us/app/coinbase-wallet/id1278383455',
      play_store: 'https://play.google.com/store/apps/details?id=org.toshi',
    },
    {
      id: '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369',
      name: 'Rainbow',
      mobile_link: 'rainbow://',
      app_store: 'https://apps.apple.com/us/app/rainbow-ethereum-wallet/id1457119021',
    },
    {
      id: 'ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18',
      name: 'Zerion',
      mobile_link: 'zerion://',
      app_store: 'https://apps.apple.com/us/app/zerion-crypto-web3-wallet/id1456732565',
      play_store: 'https://play.google.com/store/apps/details?id=io.zerion.android',
    },
  ],
});
