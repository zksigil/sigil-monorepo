import '../../global.css';

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppKit } from '@reown/appkit-react-native';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';
import { validateEnv } from '../infrastructure/env';
import { useCircuitSetup } from '../infrastructure/circuits/useCircuitSetup';
import { testMoproModuleLoading } from '../features/verification/services/proofService';

if (__DEV__) {
  validateEnv();
}

export default function App(): React.JSX.Element {
  useCircuitSetup();

  // Test Mopro module loading on app start
  useEffect(() => {
    console.log('[APP] Testing Mopro native module loading...');
    testMoproModuleLoading();
  }, []);

  return (
    <AppProviders>
      <StatusBar style="light" />
      <RootNavigator />
      {/* AppKit modal must be inside AppKitProvider but outside NavigationContainer */}
      <AppKit />
    </AppProviders>
  );
}
