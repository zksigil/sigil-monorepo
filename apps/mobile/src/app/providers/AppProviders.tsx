import React from 'react';
import { AppKitProvider } from '@reown/appkit-react-native';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { appKit, wagmiAdapter } from '../../infrastructure/blockchain/appKitConfig';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 30,
      gcTime: 1000 * 60 * 5,
    },
  },
});

interface AppProvidersProps {
  children: React.ReactNode;
}

/**
 * Provider order matters:
 *   AppKitProvider (owns connection modal + session)
 *   └── WagmiProvider (wagmi hooks)
 *       └── QueryClientProvider (TanStack Query cache)
 *           └── SafeAreaProvider (safe area insets)
 *               └── children
 */
export function AppProviders({ children }: AppProvidersProps): React.JSX.Element {
  return (
    <AppKitProvider instance={appKit}>
      <WagmiProvider config={wagmiAdapter.wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            {children}
          </SafeAreaProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </AppKitProvider>
  );
}
