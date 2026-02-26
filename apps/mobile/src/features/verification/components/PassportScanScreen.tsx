import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackNavigationProp } from '../../../app/navigation/types';
import { useNFCReader } from '../hooks/useNFCReader';
import type { NFCReadResult, NFCError } from '../../../infrastructure/nfc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MRZTab = 'manual' | 'camera';
type NFCScanState = 'ready' | 'scanning' | 'success' | 'error';
type ScreenStep = 'mrz-entry' | 'nfc-scan';

interface MRZInput {
  documentNumber: string;
  dateOfBirth: string;
  dateOfExpiry: string;
  nationality: string;
}

interface NFCSuccessData {
  documentNumber: string;
  dateOfBirth: string;
  dateOfExpiry: string;
  nationality: string;
}

interface NFCSuccessResult {
  data: NFCSuccessData;
  rawDG1Hex?: string;
  bacUsed?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMRZComplete(mrz: MRZInput): boolean {
  return (
    mrz.documentNumber.length > 0 &&
    mrz.dateOfBirth.length === 6 &&
    mrz.dateOfExpiry.length === 6 &&
    mrz.nationality.length === 3
  );
}

function getErrorMessage(error: NFCError): string {
  return error.message;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PassportScanScreen(): React.JSX.Element {
  const navigation = useNavigation<RootStackNavigationProp<'PassportScan'>>();
  const { readPassport, isScanning, cancelScan } = useNFCReader();

  // Screen step
  const [step, setStep] = useState<ScreenStep>('mrz-entry');

  // MRZ entry state
  const [activeTab, setActiveTab] = useState<MRZTab>('manual');
  const [mrzInput, setMrzInput] = useState<MRZInput>({
    documentNumber: '',
    dateOfBirth: '',
    dateOfExpiry: '',
    nationality: '',
  });

  // NFC scan state
  const [scanState, setScanState] = useState<NFCScanState>('ready');
  const [nfcResult, setNfcResult] = useState<NFCSuccessResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debugExpanded, setDebugExpanded] = useState(true);

  const mrzComplete = isMRZComplete(mrzInput);

  // MRZ field updaters
  const updateField = useCallback(
    (field: keyof MRZInput, maxLength: number, uppercase: boolean) =>
      (value: string) => {
        const processed = uppercase ? value.toUpperCase() : value;
        setMrzInput((prev) => ({
          ...prev,
          [field]: processed.slice(0, maxLength),
        }));
      },
    [],
  );

  const handleContinueToNFC = useCallback(() => {
    setStep('nfc-scan');
    setScanState('ready');
  }, []);

  const handleBeginScan = useCallback(async () => {
    setScanState('scanning');
    setErrorMessage(null);

    const result: NFCReadResult = await readPassport({
      documentNumber: mrzInput.documentNumber,
      dateOfBirth: mrzInput.dateOfBirth,
      dateOfExpiry: mrzInput.dateOfExpiry,
    });

    if (result.success) {
      const successResult: NFCSuccessResult = {
        data: result.data,
        rawDG1Hex: result.rawDG1Hex,
        bacUsed: result.bacUsed,
      };
      setNfcResult(successResult);
      setScanState('success');

      console.log('[SCAN] === Passport Scan Debug ===');
      console.log('[SCAN] MRZ Input:', mrzInput);
      console.log('[SCAN] NFC Result:', successResult.data);
      console.log('[SCAN] BAC Used:', successResult.bacUsed);
      console.log('[SCAN] Raw DG1 (hex):', successResult.rawDG1Hex);
    } else {
      setErrorMessage(getErrorMessage(result.error));
      setScanState('error');
    }
  }, [readPassport, mrzInput]);

  const handleCancel = useCallback(() => {
    cancelScan();
    setScanState('ready');
  }, [cancelScan]);

  const handleRetry = useCallback(() => {
    setScanState('ready');
    setErrorMessage(null);
  }, []);

  const handleContinueToProof = useCallback(() => {
    if (!nfcResult) return;
    navigation.navigate('ProofGeneration', {
      passportData: {
        documentNumber: nfcResult.data.documentNumber,
        dateOfBirth: nfcResult.data.dateOfBirth,
        dateOfExpiry: nfcResult.data.dateOfExpiry,
        nationality: nfcResult.data.nationality,
      },
    });
  }, [navigation, nfcResult]);

  const handleBackToMRZ = useCallback(() => {
    setStep('mrz-entry');
    setScanState('ready');
    setNfcResult(null);
    setErrorMessage(null);
  }, []);

  // -------------------------------------------------------------------------
  // Render: MRZ Entry Step
  // -------------------------------------------------------------------------

  if (step === 'mrz-entry') {
    return (
      <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
        <ScrollView className="flex-1 px-6 py-6" keyboardShouldPersistTaps="handled">
          <Text className="text-white text-2xl font-bold mb-2">Scan Passport</Text>
          <Text className="text-zinc-400 text-sm mb-6">
            Enter your passport MRZ details to enable NFC reading
          </Text>

          {/* Tab buttons */}
          <View className="flex-row mb-6 rounded-xl overflow-hidden bg-zinc-900">
            <Pressable
              onPress={() => setActiveTab('manual')}
              className={`flex-1 py-3 items-center ${activeTab === 'manual' ? 'bg-zinc-700' : ''}`}
            >
              <Text
                className={`text-sm font-semibold ${activeTab === 'manual' ? 'text-white' : 'text-zinc-500'}`}
              >
                Manual Entry
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('camera')}
              className={`flex-1 py-3 items-center ${activeTab === 'camera' ? 'bg-zinc-700' : ''}`}
            >
              <Text
                className={`text-sm font-semibold ${activeTab === 'camera' ? 'text-white' : 'text-zinc-500'}`}
              >
                Camera Guide
              </Text>
            </Pressable>
          </View>

          {/* Camera tab placeholder */}
          {activeTab === 'camera' && (
            <View className="bg-zinc-900 rounded-2xl p-6 mb-6 items-center">
              <View className="w-full aspect-[4/3] bg-zinc-800 rounded-xl mb-4 justify-end items-center pb-8">
                <View className="w-4/5 h-8 border-2 border-white/40 rounded mb-1" />
                <View className="w-4/5 h-8 border-2 border-white/40 rounded" />
                <Text className="text-white/60 text-xs mt-2">Align MRZ here</Text>
              </View>
              <Text className="text-zinc-400 text-xs text-center mb-2">
                Install expo-camera to enable camera guide
              </Text>
              <Text className="text-zinc-500 text-xs text-center">
                Position the bottom lines of your passport data page in the zone above
              </Text>
            </View>
          )}

          {/* MRZ input fields */}
          <View className="gap-y-4 mb-8">
            <View>
              <Text className="text-zinc-400 text-xs font-medium mb-1.5 uppercase tracking-wider">
                Document Number
              </Text>
              <TextInput
                className="bg-zinc-900 text-white rounded-xl px-4 py-3.5 text-base"
                value={mrzInput.documentNumber}
                onChangeText={updateField('documentNumber', 9, true)}
                placeholder="e.g. AB1234567"
                placeholderTextColor="#52525b"
                autoCapitalize="characters"
                maxLength={9}
              />
            </View>

            <View>
              <Text className="text-zinc-400 text-xs font-medium mb-1.5 uppercase tracking-wider">
                Date of Birth (YYMMDD)
              </Text>
              <TextInput
                className="bg-zinc-900 text-white rounded-xl px-4 py-3.5 text-base"
                value={mrzInput.dateOfBirth}
                onChangeText={updateField('dateOfBirth', 6, false)}
                placeholder="e.g. 901231"
                placeholderTextColor="#52525b"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>

            <View>
              <Text className="text-zinc-400 text-xs font-medium mb-1.5 uppercase tracking-wider">
                Expiry Date (YYMMDD)
              </Text>
              <TextInput
                className="bg-zinc-900 text-white rounded-xl px-4 py-3.5 text-base"
                value={mrzInput.dateOfExpiry}
                onChangeText={updateField('dateOfExpiry', 6, false)}
                placeholder="e.g. 301231"
                placeholderTextColor="#52525b"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>

            <View>
              <Text className="text-zinc-400 text-xs font-medium mb-1.5 uppercase tracking-wider">
                Nationality (3-letter code)
              </Text>
              <TextInput
                className="bg-zinc-900 text-white rounded-xl px-4 py-3.5 text-base"
                value={mrzInput.nationality}
                onChangeText={updateField('nationality', 3, true)}
                placeholder="e.g. USA"
                placeholderTextColor="#52525b"
                autoCapitalize="characters"
                maxLength={3}
              />
            </View>
          </View>

          {/* Continue button */}
          <Pressable
            onPress={handleContinueToNFC}
            disabled={!mrzComplete}
            className={`w-full rounded-2xl py-4 items-center ${
              mrzComplete
                ? 'bg-indigo-600 active:bg-indigo-700'
                : 'bg-zinc-800 opacity-50'
            }`}
          >
            <Text className="text-white text-base font-semibold">
              Continue to NFC Scan
            </Text>
          </Pressable>

          <View className="mt-6 mb-4">
            <Text className="text-zinc-600 text-xs text-center leading-5">
              Your passport data is processed locally.{'\n'}
              Nothing is sent to any server.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Render: NFC Scan Step
  // -------------------------------------------------------------------------

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['bottom']}>
      <ScrollView className="flex-1 px-6 py-6" contentContainerClassName="flex-grow">
        {/* Back button */}
        <Pressable onPress={handleBackToMRZ} className="mb-4">
          <Text className="text-indigo-400 text-sm font-medium">
            ← Back to MRZ Entry
          </Text>
        </Pressable>

        <Text className="text-white text-2xl font-bold mb-2">NFC Scan</Text>
        <Text className="text-zinc-400 text-sm mb-8">
          Read passport chip via NFC
        </Text>

        <View className="flex-1 justify-center items-center gap-y-6">
          {/* Ready state */}
          {scanState === 'ready' && (
            <>
              <View className="w-32 h-32 rounded-full bg-zinc-900 items-center justify-center">
                <Text className="text-6xl">📔</Text>
              </View>

              <Text className="text-zinc-300 text-base text-center leading-6 max-w-xs">
                Hold the back of your phone against the data page of your passport
              </Text>

              <Pressable
                onPress={handleBeginScan}
                className="w-full rounded-2xl py-4 items-center bg-indigo-600 active:bg-indigo-700"
              >
                <Text className="text-white text-base font-semibold">
                  Begin NFC Scan
                </Text>
              </Pressable>
            </>
          )}

          {/* Scanning state */}
          {scanState === 'scanning' && (
            <>
              <View className="w-32 h-32 rounded-full bg-indigo-900/30 items-center justify-center">
                <ActivityIndicator size="large" color="#818CF8" />
              </View>

              <Text className="text-white text-lg font-semibold">
                Keep phone steady against passport...
              </Text>

              <Pressable
                onPress={handleCancel}
                className="w-full rounded-2xl py-4 items-center bg-zinc-800 active:bg-zinc-700"
              >
                <Text className="text-white text-base font-semibold">Cancel</Text>
              </Pressable>
            </>
          )}

          {/* Success state */}
          {scanState === 'success' && nfcResult && (
            <>
              <View className="w-24 h-24 rounded-full bg-green-900/30 items-center justify-center">
                <Text className="text-5xl">✓</Text>
              </View>

              <Text className="text-green-400 text-lg font-semibold">
                Passport read successfully!
              </Text>

              {/* Debug panel */}
              <View className="w-full bg-zinc-900 rounded-2xl overflow-hidden">
                <Pressable
                  onPress={() => setDebugExpanded((prev) => !prev)}
                  className="px-4 py-3 flex-row justify-between items-center"
                >
                  <Text className="text-zinc-300 text-sm font-semibold">
                    🔍 Debug Info — Tap to {debugExpanded ? 'collapse' : 'expand'}
                  </Text>
                </Pressable>

                {debugExpanded && (
                  <View className="px-4 pb-4 gap-y-4">
                    {/* MRZ Input section */}
                    <View>
                      <Text className="text-indigo-400 text-xs font-bold uppercase tracking-wider mb-2">
                        MRZ Input (entered by user)
                      </Text>
                      <DebugRow label="Document Number" value={mrzInput.documentNumber} />
                      <DebugRow label="Date of Birth" value={mrzInput.dateOfBirth} />
                      <DebugRow label="Expiry Date" value={mrzInput.dateOfExpiry} />
                      <DebugRow label="Nationality" value={mrzInput.nationality} />
                    </View>

                    {/* NFC Chip Data section */}
                    <View>
                      <Text className="text-green-400 text-xs font-bold uppercase tracking-wider mb-2">
                        NFC Chip Data (read from passport)
                      </Text>
                      <DebugRow label="Document Number" value={nfcResult.data.documentNumber} />
                      <DebugRow label="Date of Birth" value={nfcResult.data.dateOfBirth} />
                      <DebugRow label="Expiry Date" value={nfcResult.data.dateOfExpiry} />
                      <DebugRow label="Nationality" value={nfcResult.data.nationality} />
                      <DebugRow
                        label="BAC Used"
                        value={nfcResult.bacUsed != null ? String(nfcResult.bacUsed) : 'N/A'}
                      />
                    </View>

                    {/* Raw NFC Data section */}
                    {nfcResult.rawDG1Hex && (
                      <View>
                        <Text className="text-amber-400 text-xs font-bold uppercase tracking-wider mb-2">
                          Raw NFC Data
                        </Text>
                        <DebugRow
                          label="DG1 Hex"
                          value={
                            nfcResult.rawDG1Hex.length > 64
                              ? `${nfcResult.rawDG1Hex.slice(0, 64)}...`
                              : nfcResult.rawDG1Hex
                          }
                        />
                      </View>
                    )}
                  </View>
                )}
              </View>

              <Pressable
                onPress={handleContinueToProof}
                className="w-full rounded-2xl py-4 items-center bg-indigo-600 active:bg-indigo-700"
              >
                <Text className="text-white text-base font-semibold">
                  Continue to Proof Generation
                </Text>
              </Pressable>
            </>
          )}

          {/* Error state */}
          {scanState === 'error' && (
            <>
              <View className="w-32 h-32 rounded-full bg-red-900/20 items-center justify-center">
                <Text className="text-5xl">⚠️</Text>
              </View>

              <Text className="text-red-400 text-lg font-semibold">Scan Failed</Text>
              <Text className="text-zinc-400 text-sm text-center max-w-xs">
                {errorMessage ?? 'Could not read passport NFC chip. Please try again.'}
              </Text>

              <Pressable
                onPress={handleRetry}
                className="w-full rounded-2xl py-4 items-center bg-zinc-800 active:bg-zinc-700"
              >
                <Text className="text-white text-base font-semibold">Try Again</Text>
              </Pressable>
            </>
          )}
        </View>

        <View className="mt-auto pt-6">
          <Text className="text-zinc-600 text-xs text-center leading-5">
            Your passport data is processed locally.{'\n'}
            Nothing is sent to any server.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Debug row helper
// ---------------------------------------------------------------------------

function DebugRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="text-zinc-500 text-xs">{label}</Text>
      <Text className="text-zinc-300 text-xs font-mono flex-shrink ml-4" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
