import '../../global.css';

import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppKit } from '@reown/appkit-react-native';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';
import { SplashOverlay } from '../shared/components/SplashOverlay';
import { validateEnv } from '../infrastructure/env';
import { useCircuitSetup } from '../infrastructure/circuits/useCircuitSetup';
import { testMoproModuleLoading } from '../features/verification/services/proofService';

if (__DEV__) {
  validateEnv();
}

// Module-level flag — splash plays once per process, not per mount.
let splashHasPlayed = false;

export default function App(): React.JSX.Element {
  useCircuitSetup();

  const [splashDone, setSplashDone] = useState<boolean>(splashHasPlayed);

  useEffect(() => {
    console.log('[APP] Testing Mopro native module loading...');
    testMoproModuleLoading();
  }, []);

  const handleSplashDone = useCallback((): void => {
    splashHasPlayed = true;
    setSplashDone(true);
  }, []);

  return (
    <AppProviders>
      <StatusBar style="light" />
      <RootNavigator />
      {/* AppKit modal must be inside AppKitProvider but outside NavigationContainer */}
      <AppKit />
      {!splashDone && <SplashOverlay onDone={handleSplashDone} />}
    </AppProviders>
  );
}
