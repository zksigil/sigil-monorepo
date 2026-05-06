import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { HomeScreen } from '../../features/wallet/components/HomeScreen';
import { PassportScanScreen } from '../../features/verification/components/PassportScanScreen';
import { ProofGenerationScreen } from '../../features/verification/components/ProofGenerationScreen';
import { VerificationSuccessScreen } from '../../features/verification/components/VerificationSuccessScreen';
import { WalletDiscoveryScreen } from '../../features/verification/components/WalletDiscoveryScreen';
const Stack = createNativeStackNavigator<RootStackParamList>();

// Deep-link config for WalletConnect callbacks
const linking = {
  prefixes: ['sigil://'],
  config: {
    screens: {
      Home: '',
    },
  },
};

export function RootNavigator(): React.JSX.Element {
  return (
    <NavigationContainer linking={linking}>
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
          name="WalletDiscovery"
          component={WalletDiscoveryScreen}
          options={{ title: 'Find Wallets' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
