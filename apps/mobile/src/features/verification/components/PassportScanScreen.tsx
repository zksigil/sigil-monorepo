import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import type { RootStackNavigationProp } from '../../../app/navigation/types';
import { useNFCReader } from '../hooks/useNFCReader';
import type { NFCReadResult, NFCError } from '../../../infrastructure/nfc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MRZTab = 'manual' | 'camera';
type NFCScanState = 'ready' | 'scanning' | 'success' | 'error';
type MRZScanState = 'idle' | 'capturing' | 'processing' | 'success' | 'failed';
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
  rawSODHex?: string;
  bacUsed?: boolean;
}

// ---------------------------------------------------------------------------
// MRZ OCR parsing
// ---------------------------------------------------------------------------

/**
 * Strip noise and whitespace from a raw OCR line, keeping only characters
 * that could plausibly appear in an MRZ (A-Z, 0-9, < and common OCR look-alikes
 * like '.', '-', 'O', 'I', 'S', 'B', 'G', 'Z'). Spaces are removed so that
 * OCR word-breaks inside a single MRZ field don't split the token.
 */
function normalizeMRZLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9<.\-]/g, '')  // strip chars with no MRZ equivalent
    .replace(/\./g, '<')            // full-stop → filler
    .replace(/-/g, '<');            // hyphen → filler
}

/**
 * Correct a character that must be a digit (0-9 or '<').
 * Common OCR substitutions: S↔5, I/L↔1, O↔0, B↔8, G↔6, Z↔2, T↔7.
 */
function toDigit(ch: string): string {
  switch (ch) {
    case 'O': return '0';
    case 'I': case 'L': return '1';
    case 'Z': return '2';
    case 'S': return '5';
    case 'G': return '6';
    case 'T': return '7';
    case 'B': return '8';
    default:  return ch;
  }
}

/**
 * Correct a character that must be alpha (A-Z or '<').
 * Common OCR substitutions: 0↔O, 1↔I, 8↔B, 6↔G.
 */
function toAlpha(ch: string): string {
  switch (ch) {
    case '0': return 'O';
    case '1': return 'I';
    case '8': return 'B';
    case '6': return 'G';
    default:  return ch;
  }
}

/**
 * Apply position-aware character corrections to a 44-character TD3 line 2.
 *
 * TD3 line 2 layout (ICAO 9303):
 *   [0-8]   Document number  — alphanumeric (no correction: could be letter or digit)
 *   [9]     Check digit      — digit only
 *   [10-12] Nationality      — alpha only
 *   [13-18] Date of birth    — digit only (YYMMDD)
 *   [19]    Check digit      — digit only
 *   [20]    Sex              — alpha only (M / F / <)
 *   [21-26] Date of expiry   — digit only (YYMMDD)
 *   [27]    Check digit      — digit only
 *   [28-42] Optional data    — alphanumeric (no correction)
 *   [43]    Check digit      — digit only
 */
function applyPositionNorm(line: string): string {
  const chars = line.split('');

  const digitPositions = new Set([9, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 43]);
  const alphaPositions = new Set([10, 11, 12, 20]);

  return chars
    .map((ch, i) => {
      if (digitPositions.has(i)) return toDigit(ch);
      if (alphaPositions.has(i)) return toAlpha(ch);
      return ch;
    })
    .join('');
}

/**
 * Parse TD3 passport MRZ line 2 (44 chars) into our MRZInput fields.
 * Position-aware normalization is applied before field extraction so that
 * common OCR character confusions (S↔5, O↔0, etc.) are fixed in context.
 */
function parseMRZLine2(raw44: string): Partial<MRZInput> | null {
  if (raw44.length < 44) return null;

  const line = applyPositionNorm(raw44);

  const docNum      = line.substring(0, 9).replace(/</g, '');
  const nationality = line.substring(10, 13).replace(/</g, '');
  const dob         = line.substring(13, 19);
  const expiry      = line.substring(21, 27);

  if (!/^\d{6}$/.test(dob) || !/^\d{6}$/.test(expiry)) return null;
  if (!docNum) return null;
  if (!/^[A-Z]{0,3}$/.test(nationality)) return null;

  console.log('[SCAN-OCR] Parsed MRZ line 2:', { docNum, nationality, dob, expiry });
  return { documentNumber: docNum, nationality, dateOfBirth: dob, dateOfExpiry: expiry };
}

/**
 * Find and parse MRZ data from a list of raw OCR text lines.
 * Tries candidates closest to 44 characters first.
 */
function parseMRZFromOCRText(rawLines: string[]): Partial<MRZInput> | null {
  const candidates = rawLines
    .map(normalizeMRZLine)
    .filter((l) => l.length >= 30);

  const sorted = [...candidates].sort((a, b) => Math.abs(44 - a.length) - Math.abs(44 - b.length));

  for (const candidate of sorted) {
    const normalized = candidate.padEnd(44, '<').substring(0, 44);
    const result = parseMRZLine2(normalized);
    if (result) return result;
  }

  console.warn('[SCAN-OCR] No valid MRZ line 2 found in OCR output');
  return null;
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
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

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
  const [mrzScanState, setMrzScanState] = useState<MRZScanState>('idle');

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

  // ---- MRZ OCR scan --------------------------------------------------------

  const handleScanMRZ = useCallback(async () => {
    if (!cameraRef.current) return;

    setMrzScanState('capturing');
    console.log('[SCAN-OCR] Capturing photo for MRZ recognition...');

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
      });

      setMrzScanState('processing');
      console.log('[SCAN-OCR] Photo captured, running text recognition...');

      const result = await TextRecognition.recognize(photo.uri);

      // Collect all text lines from all blocks
      const allLines: string[] = [];
      for (const block of result.blocks) {
        for (const line of block.lines) {
          allLines.push(line.text);
        }
        // Also try the full block text in case line segmentation missed something
        allLines.push(block.text);
      }

      console.log('[SCAN-OCR] Raw OCR lines:', allLines);

      const parsed = parseMRZFromOCRText(allLines);

      if (parsed) {
        setMrzInput((prev) => ({ ...prev, ...parsed }));
        setMrzScanState('success');
        // Switch to Manual tab so user can review / correct the auto-filled fields
        setTimeout(() => {
          setActiveTab('manual');
          setMrzScanState('idle');
        }, 1200);
      } else {
        setMrzScanState('failed');
      }
    } catch (err) {
      console.error('[SCAN-OCR] OCR error:', err instanceof Error ? err.message : err);
      setMrzScanState('failed');
    }
  }, []);

  // ---- NFC scan ------------------------------------------------------------

  const handleContinueToNFC = useCallback(() => {
    setStep('nfc-scan');
    setScanState('ready');
  }, []);

  const handleBeginScan = useCallback(async () => {
    setScanState('scanning');
    setErrorMessage(null);

    try {
      const result: NFCReadResult = await readPassport({
        documentNumber: mrzInput.documentNumber,
        dateOfBirth: mrzInput.dateOfBirth,
        dateOfExpiry: mrzInput.dateOfExpiry,
      });

      if (result.success) {
        const successResult: NFCSuccessResult = {
          data: result.data,
          rawDG1Hex: result.rawDG1Hex,
          rawSODHex: result.rawSODHex,
          bacUsed: result.bacUsed,
        };
        setNfcResult(successResult);
        setScanState('success');

        console.log('[SCAN] === Passport Scan Debug ===');
        console.log('[SCAN] MRZ Input:', mrzInput);
        console.log('[SCAN] NFC Result:', successResult.data);
        console.log('[SCAN] BAC Used:', successResult.bacUsed);
        console.log('[SCAN] Raw DG1 (hex):', successResult.rawDG1Hex);
        console.log('[SCAN] Raw SOD (hex, length):', successResult.rawSODHex?.length ?? 0);
      } else {
        setErrorMessage(getErrorMessage(result.error));
        setScanState('error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'NFC scan failed unexpectedly';
      console.error('[SCAN] Unhandled scan error:', msg);
      setErrorMessage(msg);
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
        rawDG1Hex: nfcResult.rawDG1Hex ?? '',
        rawSODHex: nfcResult.rawSODHex ?? '',
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
                Scan MRZ
              </Text>
            </Pressable>
          </View>

          {/* Camera tab */}
          {activeTab === 'camera' && (
            <View className="mb-6">
              {/* Permission not yet determined — request it */}
              {!cameraPermission && (
                <View className="bg-zinc-900 rounded-2xl p-6 items-center gap-y-3">
                  <Text className="text-zinc-300 text-sm text-center">
                    Camera access is needed to scan your passport MRZ.
                  </Text>
                  <Pressable
                    onPress={requestCameraPermission}
                    className="bg-indigo-600 active:bg-indigo-700 rounded-xl px-6 py-3"
                  >
                    <Text className="text-white text-sm font-semibold">Allow Camera</Text>
                  </Pressable>
                </View>
              )}

              {/* Permission granted — live camera with scan button */}
              {cameraPermission?.granted && (
                <View>
                  <View className="rounded-2xl overflow-hidden" style={{ aspectRatio: 4 / 3 }}>
                    <CameraView
                      ref={cameraRef}
                      facing="back"
                      style={{ flex: 1 }}
                    >
                      {/* MRZ guide overlay */}
                      <View className="flex-1 justify-end pb-4 px-4">
                        <View className="border-2 border-white/70 rounded-lg py-3 items-center">
                          <Text className="text-white/80 text-xs font-medium tracking-widest">
                            ALIGN MRZ LINES HERE
                          </Text>
                        </View>
                        <Text className="text-white/50 text-xs text-center mt-1">
                          The bottom two lines of your passport data page
                        </Text>
                      </View>
                    </CameraView>
                  </View>

                  {/* Scan button + state feedback */}
                  <View className="mt-3">
                    {mrzScanState === 'idle' && (
                      <Pressable
                        onPress={handleScanMRZ}
                        className="w-full rounded-2xl py-4 items-center bg-indigo-600 active:bg-indigo-700"
                      >
                        <Text className="text-white text-base font-semibold">Scan MRZ</Text>
                      </Pressable>
                    )}

                    {(mrzScanState === 'capturing' || mrzScanState === 'processing') && (
                      <View className="w-full rounded-2xl py-4 items-center bg-zinc-800 flex-row justify-center gap-x-3">
                        <ActivityIndicator size="small" color="#818CF8" />
                        <Text className="text-zinc-300 text-base font-semibold">
                          {mrzScanState === 'capturing' ? 'Capturing...' : 'Reading MRZ...'}
                        </Text>
                      </View>
                    )}

                    {mrzScanState === 'success' && (
                      <View className="w-full rounded-2xl py-4 items-center bg-green-900/40">
                        <Text className="text-green-400 text-base font-semibold">
                          MRZ Scanned — Review fields below
                        </Text>
                      </View>
                    )}

                    {mrzScanState === 'failed' && (
                      <View className="gap-y-2">
                        <View className="w-full rounded-2xl py-3 items-center bg-red-900/30">
                          <Text className="text-red-400 text-sm font-semibold">
                            Couldn't read MRZ — try better lighting
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => setMrzScanState('idle')}
                          className="w-full rounded-2xl py-4 items-center bg-indigo-600 active:bg-indigo-700"
                        >
                          <Text className="text-white text-base font-semibold">Try Again</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Permission explicitly denied */}
              {cameraPermission && !cameraPermission.granted && !cameraPermission.canAskAgain && (
                <View className="bg-zinc-900 rounded-2xl p-6 items-center gap-y-3">
                  <Text className="text-zinc-300 text-sm text-center">
                    Camera permission was denied. Enable it in Settings to scan MRZ.
                  </Text>
                  <Pressable
                    onPress={() => void Linking.openSettings()}
                    className="bg-zinc-700 active:bg-zinc-600 rounded-xl px-6 py-3"
                  >
                    <Text className="text-white text-sm font-semibold">Open Settings</Text>
                  </Pressable>
                  <Text className="text-zinc-500 text-xs text-center">
                    Or use Manual Entry tab to continue
                  </Text>
                </View>
              )}

              {/* Permission denied but can ask again */}
              {cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain && (
                <View className="bg-zinc-900 rounded-2xl p-6 items-center gap-y-3">
                  <Text className="text-zinc-300 text-sm text-center">
                    Camera access was denied. Grant access to scan MRZ.
                  </Text>
                  <Pressable
                    onPress={requestCameraPermission}
                    className="bg-indigo-600 active:bg-indigo-700 rounded-xl px-6 py-3"
                  >
                    <Text className="text-white text-sm font-semibold">Grant Camera Access</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {/* MRZ input fields — always visible so user can review/edit after scan */}
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
                        {nfcResult.rawSODHex && (
                          <DebugRow
                            label="SOD Hex"
                            value={
                              nfcResult.rawSODHex.length > 64
                                ? `${nfcResult.rawSODHex.slice(0, 64)}...`
                                : nfcResult.rawSODHex
                            }
                          />
                        )}
                        {nfcResult.rawSODHex && (
                          <DebugRow
                            label="SOD Size"
                            value={`${nfcResult.rawSODHex.length / 2} bytes`}
                          />
                        )}
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
