import React, { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import type { RootStackRouteProp } from '../../../app/navigation/types';
import { MRZEntryStep } from './MRZEntryStep';
import { NFCScanStep } from './NFCScanStep';
import type { MRZInput } from '../services/mrzParser';

type Step = 'mrz-entry' | 'nfc-scan';

const EMPTY_MRZ: MRZInput = {
  documentNumber: '',
  dateOfBirth: '',
  dateOfExpiry: '',
  nationality: '',
};

export function PassportScanScreen(): React.JSX.Element {
  const route = useRoute<RootStackRouteProp<'PassportScan'>>();
  const mode = route.params?.mode ?? 'register'; // ScanMode

  const [step, setStep] = useState<Step>('mrz-entry');
  const [mrz, setMrz] = useState<MRZInput>(EMPTY_MRZ);

  const handleContinueToNFC = useCallback(() => setStep('nfc-scan'), []);
  const handleBackToMRZ = useCallback(() => setStep('mrz-entry'), []);

  return (
    <SafeAreaView className="flex-1 bg-dracula-bg" edges={['bottom']}>
      <ScrollView
        className="flex-1 px-6 py-6"
        contentContainerClassName={step === 'nfc-scan' ? 'flex-grow' : undefined}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'mrz-entry' ? (
          <MRZEntryStep mrz={mrz} onChange={setMrz} onContinue={handleContinueToNFC} mode={mode} />
        ) : (
          <NFCScanStep mrz={mrz} onBack={handleBackToMRZ} mode={mode} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
