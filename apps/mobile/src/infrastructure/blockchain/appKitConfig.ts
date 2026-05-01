import { createAppKit } from '@reown/appkit-react-native';
import { ApiController, AssetController, OptionsController } from '@reown/appkit-core-react-native';
import { WagmiAdapter } from '@reown/appkit-wagmi-react-native';
import { http } from 'wagmi';
import { baseSepolia, base, anvil as anvilDefault } from 'wagmi/chains';
import { defineChain } from 'viem';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subscribeKey } from 'valtio/utils';
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
  [baseSepolia.id]: process.env['EXPO_PUBLIC_BASE_SEPOLIA_RPC_URL'] ?? 'https://sepolia.base.org',
  [base.id]: process.env['EXPO_PUBLIC_BASE_RPC_URL'] ?? 'https://mainnet.base.org',
} as const;

// ---------------------------------------------------------------------------
// WagmiAdapter — requires wagmi Chain tuple (readonly non-empty)
// ---------------------------------------------------------------------------
export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [baseSepolia, base, anvil] as const,
  transports: {
    [baseSepolia.id]: http(RPC_URLS[baseSepolia.id]),
    [base.id]: http(RPC_URLS[base.id]),
    [anvil.id]: http(RPC_URLS[anvil.id]),
  },
});

// ---------------------------------------------------------------------------
// AppKit instance (singleton)
// ---------------------------------------------------------------------------
export const appKit = createAppKit({
  projectId,
  // wagmi Chain objects are structurally compatible with AppKit's Network type
  networks: [baseSepolia, base, anvil] as unknown as Parameters<typeof createAppKit>[0]['networks'],
  defaultNetwork: baseSepolia,
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
  // featuredWalletIds prioritizes a curated set at the top of the connect list
  // and the "All Wallets" page. The matching /getWallets request runs in
  // parallel with the slow /getIosData call, so these wallets render with
  // images well before the full registry finishes loading.
  //
  // Order matters — AppKit sorts the response by the index in this array.
  // The first ~4 (after dedup against installed/recents) surface in the
  // 4-tile connect sheet; the rest pre-fill the top of "All Wallets".
  // IDs are from the Reown explorer (api.web3modal.org/getWallets).
  featuredWalletIds: [
    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
    'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa', // Coinbase Wallet
    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
    '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // Rainbow
    'ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18', // Zerion
    'c03dfee351b6fcc421b4494ea33b9d4b92a984f87aa76d1663bb28705e95034a', // Uniswap Wallet
    '19177a98252e07ddfc9af2083ba8e07ef627cb6103467ffebb3f8f4205fd7927', // Ledger Wallet
    '971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709', // OKX Wallet
    '38f5d18bd8522c244bdd70cb4a68e0e718865155811c043f052fb9f1c51de662', // Bitget Wallet
    '225affb176778569276e484e1b92637ad061b01e13a048b35a9d280c3b58970f', // Safe
    'c286eebc742a537cd1d6818363e9dc53b21759a1e8e5d9b263d0c03ec7703576', // 1inch Wallet
    'f2436c67184f158d1beda5df53298ee84abfc367581e4505134b5bcf5f46697d', // Crypto.com Onchain
    'ef333840daf915aafdc4a004525502d6d49d77bd9c65e0642dbaefb3c2893bef', // imToken
    '20459438007b75f4f4acb98bf29aa3b800550309646d375da5fd4aac6c2a2c66', // TokenPocket
    '0b415a746fb9ee99cce155c2ceca0c6f6061b1dbca2d722b3ba16381d0562150', // SafePal
    '6b0182d679b72eb2733dec38d9dee70551cc16a6ce5e7a7f4155ffb6f493c521', // Trezor Suite
    '15c8b91ade1a4e58f3ce4e7a0dd7f42b47db0c8df7e0d84f63eb39bcb96c4e0f', // Bybit Wallet
    '107bb20463699c4e614d3a2fb7b961e66f48774cb8f6d6c1aee789853280972c', // Bitcoin.com Wallet
    '8a0ee50d1f22f6651afcae7eb4253e52a3310b90af5daef78a8c4929a9bb99d4', // Binance Wallet
    'fe68cea63541aa53ce020de7398968566dfe8f3725663a564cac89490247ed49', // Best Wallet
  ],
  // customWallets are set synchronously in the AppKit constructor — they appear
  // immediately when the connect view renders, with no API fetch required.
  // image_id lets fetchCustomWalletImages() warm the tile artwork in parallel.
  customWallets: [
    {
      id: 'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
      name: 'MetaMask',
      image_id: 'eebe4a7f-7166-402f-92e0-1f64ca2aa800',
      mobile_link: 'metamask://',
      app_store: 'https://apps.apple.com/us/app/metamask/id1438144202',
      play_store: 'https://play.google.com/store/apps/details?id=io.metamask',
    },
    {
      id: 'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa',
      name: 'Coinbase Wallet',
      image_id: '04c88bf0-f115-4686-8c29-90a3d018a400',
      mobile_link: 'cbwallet://',
      app_store: 'https://apps.apple.com/us/app/coinbase-wallet/id1278383455',
      play_store: 'https://play.google.com/store/apps/details?id=org.toshi',
    },
    {
      id: '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369',
      name: 'Rainbow',
      image_id: '7a33d7f1-3d12-4b5c-f3ee-5cd83cb1b500',
      mobile_link: 'rainbow://',
      app_store: 'https://apps.apple.com/us/app/rainbow-ethereum-wallet/id1457119021',
    },
    {
      id: 'ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18',
      name: 'Zerion',
      image_id: '77c1d3dd-0213-400a-f9cc-bfd524c47f00',
      mobile_link: 'zerion://',
      app_store: 'https://apps.apple.com/us/app/zerion-crypto-web3-wallet/id1456732565',
      play_store: 'https://play.google.com/store/apps/details?id=io.zerion.android',
    },
  ],
});

// ---------------------------------------------------------------------------
// Wallet image fetch — direct remote URLs instead of fetch→blob→FileReader
//
// AppKit's stock _fetchWalletImage does:
//   fetch(getWalletImage/<id>) → response.blob() → FileReader.readAsDataURL
// On iOS React Native that pipeline silently fails for many image responses
// (FileReader can't convert blobs sourced from native fetch), so walletImages
// stays empty and every tile renders as a placeholder.
//
// We override _fetchWalletImage to skip the blob roundtrip entirely: store the
// remote URL directly. AllWalletList passes imageHeaders into RN's Image,
// which then fetches and decodes the PNG natively. Works on all wallets,
// not just our customWallets.
// ---------------------------------------------------------------------------
const _walletImageBaseUrl = 'https://api.web3modal.org/getWalletImage';
ApiController._fetchWalletImage = async (imageId: string): Promise<void> => {
  const params = ApiController._getApiParams();
  const query = new URLSearchParams({
    projectId: params.projectId,
    st: params.st,
    sv: params.sv,
  }).toString();
  AssetController.setWalletImage(imageId, `${_walletImageBaseUrl}/${imageId}?${query}`);
};

// ---------------------------------------------------------------------------
// Wallet API prewarm — show customWallets instantly, fetch real data in background
//
// AppKit's stock prefetch sets state.prefetchLoading=true at the start of the
// run, which makes AllWalletList swap its content for two skeleton loaders.
// The customWallets we configured above ARE in state, but the loading flag
// hides them. That's the root cause of the "Connect wallet" modal showing
// skeletons for several seconds on a fresh install.
//
// We replace prefetch with our own implementation that:
//   1. Never flips prefetchLoading=true, so customWallets render immediately
//   2. Fires fetchFeaturedWallets first (small, fast — the 6 IDs we pinned)
//   3. Runs the slow getIosData / installed lookup + recommended in parallel
//      in the background. Their results merge in as they arrive.
//
// The in-flight coalescer guarantees the AppKit modal's mount-effect call
// reuses the same promise, so we don't fire two parallel sets of requests.
// ---------------------------------------------------------------------------
let _prefetchInFlight: Promise<void> | null = null;

ApiController.prefetch = function prefetch(): Promise<void> {
  if (_prefetchInFlight) return _prefetchInFlight;

  _prefetchInFlight = (async () => {
    try {
      ApiController.state.prefetchError = false;

      // Seed state.wallets synchronously so the "All Wallets" view doesn't
      // gate on its own /getWallets call. Its mount logic does:
      //   useState(state.wallets.length === 0)  // → loading=true if empty
      // With customWallets seeded in, loading starts false and the merged
      // [installed, featured, recommended, customs, wallets] list renders
      // immediately. Featured/installed/recommended layer in via valtio
      // reactivity as fetches resolve. Background fetchWallets below sets
      // state.count so scroll pagination kicks in once page 1 is back.
      const customWallets = OptionsController.state.customWallets ?? [];
      if (ApiController.state.wallets.length === 0 && customWallets.length > 0) {
        ApiController.state.wallets = [...customWallets];
      }

      // Image warming — fire and forget, doesn't block the list render
      void ApiController.fetchNetworkImages();
      void ApiController.fetchCustomWalletImages();

      // Featured first: small /getWallets request, ~1 round-trip, returns
      // our 6 pinned wallets with images. Renders at the top of the list.
      const featuredPromise = ApiController.fetchFeaturedWallets().catch(() => {});

      // Installed wallets requires fetching the full /getIosData registry,
      // then probing canOpenURL per wallet. Slowest call. fetchRecommended
      // depends on installed having populated, so sequence them.
      void ApiController.fetchInstalledWallets()
        .catch(() => {})
        .then(() => ApiController.fetchRecommendedWallets().catch(() => {}));

      // Prefetch page 1 of the paginated wallet list — AllWalletsList gates
      // its render on state.wallets.length being non-zero, so without this
      // tapping "All Wallets" shows skeletons even though featured is loaded.
      void ApiController.fetchWallets({ page: 1 }).catch(() => {});

      await featuredPromise;
    } catch {
      ApiController.state.prefetchError = true;
    } finally {
      _prefetchInFlight = null;
    }
  })();

  return _prefetchInFlight;
};

if (OptionsController.state.projectId) {
  void ApiController.prefetch();
} else {
  const _unsubscribeProjectId = subscribeKey(OptionsController.state, 'projectId', (id) => {
    if (id) {
      void ApiController.prefetch();
      _unsubscribeProjectId();
    }
  });
}
