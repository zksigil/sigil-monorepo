import '../../global.css';

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppKit } from '@reown/appkit-react-native';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';
import { validateEnv } from '../infrastructure/env';
import { useCircuitSetup } from '../infrastructure/circuits/useCircuitSetup';

if (__DEV__) {
  validateEnv();
}

export default function App(): React.JSX.Element {
  useCircuitSetup();

  return (
    <AppProviders>
      <StatusBar style="light" />
      <RootNavigator />
      {/* AppKit modal must be inside AppKitProvider but outside NavigationContainer */}
      <AppKit />
    </AppProviders>
  );
}
