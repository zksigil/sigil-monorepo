import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { HomeScreen } from '../../features/wallet/components/HomeScreen';
import { PassportScanScreen } from '../../features/verification/components/PassportScanScreen';
import { ProofGenerationScreen } from '../../features/verification/components/ProofGenerationScreen';
import { VerificationSuccessScreen } from '../../features/verification/components/VerificationSuccessScreen';
import { AddressDiscoveryScreen } from '../../features/verification/components/AddressDiscoveryScreen';

// React Navigation defaults colors.background to '#fff' which paints white
// behind any screen before the screen mounts. Override to the dracula canvas
// (matches AppDelegate window + storyboard + SplashOverlay) so the navigator
// background never flashes white during the JS first-paint window.
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#282a36',
  },
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Deep-link config for WalletConnect callbacks. We declare the URL prefix so
// iOS knows this app handles `sigil://`, but we deliberately do NOT map any
// path → screen. WalletConnect returns from MetaMask (and other wallets) open
// the app via `sigil://` to bring it back to foreground; if we mapped the
// empty path to Home, that return would force-navigate the user to Home,
// dismissing whatever screen they were on (e.g. VerificationSuccess flashed
// for one frame before getting replaced).
const linking = {
  prefixes: ['sigil://'],
  config: {
    screens: {},
  },
};

export function RootNavigator(): React.JSX.Element {
  return (
    <NavigationContainer linking={linking} theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#000000' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#000000' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'Sigil' }}
        />
        <Stack.Screen
          name="PassportScan"
          component={PassportScanScreen}
          options={{ title: 'Passport Scan' }}
        />
        <Stack.Screen
          name="ProofGeneration"
          component={ProofGenerationScreen}
          options={{
            title: 'Generating Proof',
            headerBackVisible: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="VerificationSuccess"
          component={VerificationSuccessScreen}
          options={{
            title: 'Success',
            headerBackVisible: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="AddressDiscovery"
          component={AddressDiscoveryScreen}
          options={{ title: 'Find Addresses' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
