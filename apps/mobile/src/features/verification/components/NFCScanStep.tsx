import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { RegistrationMode, RootStackNavigationProp, ScanMode } from '../../../app/navigation/types';
import { useNFCReader } from '../hooks/useNFCReader';
import type { NFCError, NFCReadResult } from '../../../infrastructure/nfc';
import type { MRZInput } from '../services/mrzParser';
import { inspectPassportCompatibility, type PassportCompatibility } from '../../../infrastructure/sod/parseSod';
import { IS_DEV_BUILD } from '../../../shared/constants/build';

type NFCScanState = 'ready' | 'scanning' | 'checking' | 'success' | 'unsupported' | 'error';

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

interface Props {
  mrz: MRZInput;
  onBack: () => void;
  mode: ScanMode;
}

function getErrorMessage(error: NFCError): string {
  return error.message;
}

export function NFCScanStep({ mrz, onBack, mode }: Props): React.JSX.Element {
  const navigation = useNavigation<RootStackNavigationProp<'PassportScan'>>();
  const { readPassport, cancelScan } = useNFCReader();

  const [scanState, setScanState] = useState<NFCScanState>('ready');
  const [nfcResult, setNfcResult] = useState<NFCSuccessResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<PassportCompatibility | null>(null);
  const [debugExpanded, setDebugExpanded] = useState(true);

  const handleBeginScan = useCallback(async () => {
    setScanState('scanning');
    setErrorMessage(null);
    setUnsupported(null);
    try {
      const result: NFCReadResult = await readPassport({
        documentNumber: mrz.documentNumber,
        dateOfBirth: mrz.dateOfBirth,
        dateOfExpiry: mrz.dateOfExpiry,
      });

      if (result.success) {
        const successResult: NFCSuccessResult = {
          data: result.data,
          rawDG1Hex: result.rawDG1Hex,
          rawSODHex: result.rawSODHex,
          bacUsed: result.bacUsed,
        };
        setNfcResult(successResult);
        console.log('[SCAN] NFC OK — DG1', successResult.rawDG1Hex?.length ?? 0, 'SOD', successResult.rawSODHex?.length ?? 0);

        if (successResult.rawSODHex) {
          setScanState('checking');
          const compat = await inspectPassportCompatibility(successResult.rawSODHex);
          if (!compat.supported) {
            console.log('[SCAN] Passport incompatible:', compat.reason, compat.algorithm);
            setUnsupported(compat);
            setScanState('unsupported');
            return;
          }
        }
        setScanState('success');
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
  }, [readPassport, mrz]);

  const handleCancel = useCallback(() => {
    cancelScan();
    setScanState('ready');
  }, [cancelScan]);

  const handleRetry = useCallback(() => {
    setScanState('ready');
    setErrorMessage(null);
  }, []);

  const handleBackHome = useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  const handleDevSkip = useCallback(() => {
    // Dev-only skip — invalid DG1/SOD bytes route useProofGeneration to the
    // stub fallback. Only works against MockUltraHonkVerifier on anvil. Discovery
    // mode skips this fallback since it never produces a real nullifier.
    if (mode === 'discover') return;
    navigation.navigate('ProofGeneration', {
      mode: mode as RegistrationMode,
      passportData: {
        documentNumber: 'AB1234567',
        dateOfBirth: '900101',
        dateOfExpiry: '300101',
        nationality: 'USA',
        rawDG1Hex: '615b5f1f58' + '00'.repeat(88),
        rawSODHex: 'deadbeef' + '00'.repeat(252),
      },
    });
  }, [navigation, mode]);

  const handleContinueToProof = useCallback(() => {
    if (!nfcResult) return;
    const passportData = {
      documentNumber: nfcResult.data.documentNumber,
      dateOfBirth: nfcResult.data.dateOfBirth,
      dateOfExpiry: nfcResult.data.dateOfExpiry,
      nationality: nfcResult.data.nationality,
      rawDG1Hex: nfcResult.rawDG1Hex ?? '',
      rawSODHex: nfcResult.rawSODHex ?? '',
    };
    if (mode === 'discover') {
      navigation.navigate('AddressDiscovery', { passportData });
    } else {
      navigation.navigate('ProofGeneration', { mode, passportData });
    }
  }, [navigation, nfcResult, mode]);

  return (
    <>
      <Pressable onPress={onBack} className="mb-4">
        <Text className="text-dracula-purple text-sm font-medium">← Back to MRZ Entry</Text>
      </Pressable>

      <Text className="text-dracula-fg text-2xl font-bold mb-2">NFC Scan</Text>
      <Text className="text-dracula-comment text-sm mb-8">Read passport chip via NFC</Text>

      <View className="flex-1 justify-center items-center gap-y-6">
        {scanState === 'ready' && <ReadyState onBegin={handleBeginScan} />}

        {scanState === 'scanning' && <ScanningState onCancel={handleCancel} />}

        {scanState === 'checking' && <CheckingState />}

        {scanState === 'success' && nfcResult && (
          <SuccessState
            mrz={mrz}
            nfcResult={nfcResult}
            debugExpanded={debugExpanded}
            onToggleDebug={() => setDebugExpanded((p) => !p)}
            onContinue={handleContinueToProof}
            continueLabel={
              mode === 'discover' ? 'Look Up Addresses'
              : mode === 'renew' ? 'Continue to Renewal'
              : 'Continue to Proof Generation'
            }
          />
        )}

        {scanState === 'unsupported' && unsupported && !unsupported.supported && (
          <UnsupportedState compat={unsupported} onBackHome={handleBackHome} />
        )}

        {scanState === 'error' && (
          <ErrorState
            message={errorMessage}
            onRetry={handleRetry}
            onDevSkip={IS_DEV_BUILD ? handleDevSkip : null}
          />
        )}
      </View>

      <View className="mt-auto pt-6">
        <Text className="text-dracula-comment/50 text-xs text-center leading-5">
          Your passport data is processed locally.{'\n'}
          Nothing is sent to any server.
        </Text>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// State views
// ---------------------------------------------------------------------------

function ReadyState({ onBegin }: { onBegin: () => void }): React.JSX.Element {
  return (
    <>
      <View className="w-32 h-32 rounded-full bg-dracula-surface items-center justify-center">
        <Text className="text-6xl">📔</Text>
      </View>
      <Text className="text-dracula-fg/80 text-base text-center leading-6 max-w-xs">
        Hold the back of your phone against the data page of your passport
      </Text>
      <Pressable
        onPress={onBegin}
        className="w-full rounded-2xl py-4 items-center bg-dracula-purple active:bg-dracula-purple/80"
      >
        <Text className="text-dracula-fg text-base font-semibold">Begin NFC Scan</Text>
      </Pressable>
    </>
  );
}

function ScanningState({ onCancel }: { onCancel: () => void }): React.JSX.Element {
  return (
    <>
      <View className="w-32 h-32 rounded-full bg-dracula-purple/20 items-center justify-center">
        <ActivityIndicator size="large" color="#818CF8" />
      </View>
      <Text className="text-dracula-fg text-lg font-semibold">Keep phone steady against passport...</Text>
      <Pressable
        onPress={onCancel}
        className="w-full rounded-2xl py-4 items-center bg-dracula-surface/70 active:bg-dracula-comment/40"
      >
        <Text className="text-dracula-fg text-base font-semibold">Cancel</Text>
      </Pressable>
    </>
  );
}

function CheckingState(): React.JSX.Element {
  return (
    <>
      <View className="w-32 h-32 rounded-full bg-dracula-purple/20 items-center justify-center">
        <ActivityIndicator size="large" color="#818CF8" />
      </View>
      <Text className="text-dracula-fg text-lg font-semibold">Checking compatibility...</Text>
    </>
  );
}

function UnsupportedState({ compat, onBackHome }: { compat: PassportCompatibility & { supported: false }; onBackHome: () => void }): React.JSX.Element {
  return (
    <>
      <View className="w-24 h-24 rounded-full bg-dracula-orange/20 items-center justify-center">
        <Text className="text-5xl">ℹ️</Text>
      </View>
      <Text className="text-dracula-fg text-lg font-semibold">Passport not supported yet</Text>
      <Text className="text-dracula-comment text-sm text-center max-w-xs leading-5">
        Your passport uses {compat.algorithm}, which Sigil will support in the future.
      </Text>
      <Text className="text-dracula-comment/60 text-xs text-center max-w-xs leading-5">
        Sigil currently supports passports signed with RSA-2048 chained to RSA-4096 country signing keys.
      </Text>
      <Pressable
        onPress={onBackHome}
        className="w-full rounded-2xl py-4 items-center bg-dracula-purple active:bg-dracula-purple/80"
      >
        <Text className="text-dracula-fg text-base font-semibold">Back to Home</Text>
      </Pressable>
    </>
  );
}

interface SuccessProps {
  mrz: MRZInput;
  nfcResult: NFCSuccessResult;
  debugExpanded: boolean;
  onToggleDebug: () => void;
  onContinue: () => void;
  continueLabel: string;
}

function SuccessState({ mrz, nfcResult, debugExpanded, onToggleDebug, onContinue, continueLabel }: SuccessProps): React.JSX.Element {
  return (
    <>
      <View className="w-24 h-24 rounded-full bg-dracula-green/20 items-center justify-center">
        <Text className="text-5xl">✓</Text>
      </View>
      <Text className="text-dracula-green text-lg font-semibold">Passport read successfully!</Text>

      {IS_DEV_BUILD && (
        <NFCDebugPanel
          mrz={mrz}
          nfcResult={nfcResult}
          expanded={debugExpanded}
          onToggle={onToggleDebug}
        />
      )}

      <Pressable
        onPress={onContinue}
        className="w-full rounded-2xl py-4 items-center bg-dracula-purple active:bg-dracula-purple/80"
      >
        <Text className="text-dracula-fg text-base font-semibold">{continueLabel}</Text>
      </Pressable>
    </>
  );
}

interface ErrorProps {
  message: string | null;
  onRetry: () => void;
  onDevSkip: (() => void) | null;
}

function ErrorState({ message, onRetry, onDevSkip }: ErrorProps): React.JSX.Element {
  return (
    <>
      <View className="w-32 h-32 rounded-full bg-dracula-red/20 items-center justify-center">
        <Text className="text-5xl">⚠️</Text>
      </View>
      <Text className="text-dracula-red text-lg font-semibold">Scan Failed</Text>
      <Text className="text-dracula-comment text-sm text-center max-w-xs">
        {message ?? 'Could not read passport NFC chip. Please try again.'}
      </Text>
      <Pressable
        onPress={onRetry}
        className="w-full rounded-2xl py-4 items-center bg-dracula-surface/70 active:bg-dracula-comment/40"
      >
        <Text className="text-dracula-fg text-base font-semibold">Try Again</Text>
      </Pressable>
      {onDevSkip && (
        <Pressable
          onPress={onDevSkip}
          className="w-full rounded-2xl py-3 items-center border border-dracula-orange/50 active:bg-dracula-orange/20"
        >
          <Text className="text-dracula-orange text-sm font-medium">[DEV] Skip NFC — use dummy data</Text>
        </Pressable>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Debug panel — collapsible details surfaced after a successful scan
// ---------------------------------------------------------------------------

interface DebugProps {
  mrz: MRZInput;
  nfcResult: NFCSuccessResult;
  expanded: boolean;
  onToggle: () => void;
}

function NFCDebugPanel({ mrz, nfcResult, expanded, onToggle }: DebugProps): React.JSX.Element {
  return (
    <View className="w-full bg-dracula-surface rounded-2xl overflow-hidden">
      <Pressable onPress={onToggle} className="px-4 py-3 flex-row justify-between items-center">
        <Text className="text-dracula-fg/80 text-sm font-semibold">
          🔍 Debug Info — Tap to {expanded ? 'collapse' : 'expand'}
        </Text>
      </Pressable>

      {expanded && (
        <View className="px-4 pb-4 gap-y-4">
          <Section title="MRZ Input (entered by user)" tone="purple">
            <Row label="Document Number" value={mrz.documentNumber} />
            <Row label="Date of Birth" value={mrz.dateOfBirth} />
            <Row label="Expiry Date" value={mrz.dateOfExpiry} />
            <Row label="Nationality" value={mrz.nationality} />
          </Section>
          <Section title="NFC Chip Data (read from passport)" tone="green">
            <Row label="Document Number" value={nfcResult.data.documentNumber} />
            <Row label="Date of Birth" value={nfcResult.data.dateOfBirth} />
            <Row label="Expiry Date" value={nfcResult.data.dateOfExpiry} />
            <Row label="Nationality" value={nfcResult.data.nationality} />
            <Row label="BAC Used" value={nfcResult.bacUsed != null ? String(nfcResult.bacUsed) : 'N/A'} />
          </Section>
          {nfcResult.rawDG1Hex && (
            <Section title="Raw NFC Data" tone="orange">
              <Row label="DG1 Hex" value={truncate(nfcResult.rawDG1Hex, 64)} />
              {nfcResult.rawSODHex && <Row label="SOD Hex" value={truncate(nfcResult.rawSODHex, 64)} />}
              {nfcResult.rawSODHex && (
                <Row label="SOD Size" value={`${nfcResult.rawSODHex.length / 2} bytes`} />
              )}
            </Section>
          )}
        </View>
      )}
    </View>
  );
}

function truncate(hex: string, n: number): string {
  return hex.length > n ? `${hex.slice(0, n)}...` : hex;
}

function Section({ title, tone, children }: { title: string; tone: 'purple' | 'green' | 'orange'; children: React.ReactNode }): React.JSX.Element {
  const color = tone === 'purple' ? 'text-dracula-purple' : tone === 'green' ? 'text-dracula-green' : 'text-dracula-orange';
  return (
    <View>
      <Text className={`${color} text-xs font-bold uppercase tracking-wider mb-2`}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="text-dracula-comment/70 text-xs">{label}</Text>
      <Text className="text-dracula-fg/80 text-xs font-mono flex-shrink ml-4" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
