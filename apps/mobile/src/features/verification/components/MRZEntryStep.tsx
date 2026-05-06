import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Linking,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { CameraView, useCameraPermissions } from 'expo-camera';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import {
  type MRZInput,
  allChecksPass,
  isMRZComplete,
  parseMRZFromOCRText,
} from '../services/mrzParser';

type Tab = 'manual' | 'camera';

/** Camera-tab state machine. */
type CameraStatus =
  | 'searching'    // loop running, no MRZ-shaped text seen yet
  | 'aligning'     // MRZ-shaped text detected but check digits don't validate — hold still
  | 'locked'       // parse succeeded with valid check digits
  | 'manual-fail'; // manual one-shot capture finished without a parse

interface CaptureOutcome {
  kind: 'locked' | 'partial' | 'no-mrz';
  fields?: Partial<MRZInput>;
}

const AUTO_CAPTURE_INTERVAL_MS = 1000;
const HINT_AFTER_MS = 6000;
const ALIGNING_DECAY_MS = 1500;  // revert from aligning → searching if no fresh detection
const LOCK_HOLD_MS = 600;        // dwell in 'aligning' after a clean parse before locking

interface Props {
  mrz: MRZInput;
  onChange: (mrz: MRZInput) => void;
  onContinue: () => void;
}

export function MRZEntryStep({ mrz, onChange, onContinue }: Props): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('manual');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const mrzComplete = isMRZComplete(mrz);

  const updateField = useCallback(
    (field: keyof MRZInput, maxLength: number, uppercase: boolean) =>
      (value: string) => {
        const processed = uppercase ? value.toUpperCase() : value;
        onChange({ ...mrz, [field]: processed.slice(0, maxLength) });
      },
    [mrz, onChange],
  );

  return (
    <>
      <Text className="text-dracula-fg text-2xl font-bold mb-2">Scan Passport</Text>
      <Text className="text-dracula-comment text-sm mb-6">
        Enter your passport MRZ details to enable NFC reading
      </Text>

      <View className="flex-row mb-6 rounded-xl overflow-hidden bg-dracula-surface">
        <Tab label="Manual Entry" active={activeTab === 'manual'} onPress={() => setActiveTab('manual')} />
        <Tab label="Scan MRZ" active={activeTab === 'camera'} onPress={() => setActiveTab('camera')} />
      </View>

      {activeTab === 'camera' && (
        <View className="mb-6">
          <CameraTab
            cameraRef={cameraRef}
            permission={cameraPermission}
            requestPermission={requestCameraPermission}
            active={activeTab === 'camera'}
            onParsed={(parsed) => {
              onChange({ ...mrz, ...parsed });
              setActiveTab('manual');
            }}
          />
        </View>
      )}

      <View className="gap-y-4 mb-8">
        <Field
          label="Document Number"
          value={mrz.documentNumber}
          onChangeText={updateField('documentNumber', 9, true)}
          placeholder="e.g. AB1234567"
          autoCapitalize="characters"
          maxLength={9}
        />
        <Field
          label="Date of Birth (YYMMDD)"
          value={mrz.dateOfBirth}
          onChangeText={updateField('dateOfBirth', 6, false)}
          placeholder="e.g. 901231"
          keyboardType="number-pad"
          maxLength={6}
        />
        <Field
          label="Expiry Date (YYMMDD)"
          value={mrz.dateOfExpiry}
          onChangeText={updateField('dateOfExpiry', 6, false)}
          placeholder="e.g. 301231"
          keyboardType="number-pad"
          maxLength={6}
        />
        <Field
          label="Nationality (3-letter code)"
          value={mrz.nationality}
          onChangeText={updateField('nationality', 3, true)}
          placeholder="e.g. USA"
          autoCapitalize="characters"
          maxLength={3}
        />
      </View>

      <Pressable
        onPress={onContinue}
        disabled={!mrzComplete}
        className={`w-full rounded-2xl py-4 items-center ${
          mrzComplete ? 'bg-dracula-purple active:bg-dracula-purple/80' : 'bg-dracula-surface/70 opacity-50'
        }`}
      >
        <Text className="text-dracula-fg text-base font-semibold">Continue to NFC Scan</Text>
      </Pressable>

      <View className="mt-6 mb-4">
        <Text className="text-dracula-comment/50 text-xs text-center leading-5">
          Your passport data is processed locally.{'\n'}
          Nothing is sent to any server.
        </Text>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera tab — handles permissions and the auto-capture loop
// ---------------------------------------------------------------------------

interface CameraTabProps {
  cameraRef: React.RefObject<CameraView | null>;
  permission: ReturnType<typeof useCameraPermissions>[0];
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  active: boolean;
  onParsed: (mrz: Partial<MRZInput>) => void;
}

function CameraTab({ cameraRef, permission, requestPermission, active, onParsed }: CameraTabProps): React.JSX.Element {
  if (!permission) {
    return (
      <PermissionCard
        text="Camera access is needed to scan your passport MRZ."
        cta="Allow Camera"
        onPress={requestPermission}
      />
    );
  }
  if (!permission.granted && !permission.canAskAgain) {
    return (
      <PermissionCard
        text="Camera permission was denied. Enable it in Settings to scan MRZ."
        cta="Open Settings"
        onPress={() => void Linking.openSettings()}
        variant="muted"
        footnote="Or use Manual Entry tab to continue"
      />
    );
  }
  if (!permission.granted) {
    return (
      <PermissionCard
        text="Camera access was denied. Grant access to scan MRZ."
        cta="Grant Camera Access"
        onPress={requestPermission}
      />
    );
  }
  return <CameraLiveView cameraRef={cameraRef} active={active} onParsed={onParsed} />;
}

function CameraLiveView({ cameraRef, active, onParsed }: Omit<CameraTabProps, 'permission' | 'requestPermission'>): React.JSX.Element {
  const [status, setStatus] = useState<CameraStatus>('searching');
  const [hintVisible, setHintVisible] = useState(false);
  const inFlight = useRef(false);
  const cancelled = useRef(false);
  const startedAt = useRef<number>(0);
  const lastDetectionAt = useRef<number>(0);

  // Animation values for capture-flash overlay (fired on lock).
  const flashOpacity = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  // Animation values for the bracket pulse on detection.
  const bracketScale = useSharedValue(1);
  const bracketStyle = useAnimatedStyle(() => ({ transform: [{ scale: bracketScale.value }] }));

  const captureOnce = useCallback(async (): Promise<CaptureOutcome> => {
    if (!cameraRef.current || inFlight.current) return { kind: 'no-mrz' };
    inFlight.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.6,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!photo) return { kind: 'no-mrz' };
      const result = await TextRecognition.recognize(photo.uri);
      const lines: string[] = [];
      for (const block of result.blocks) {
        for (const line of block.lines) lines.push(line.text);
        lines.push(block.text);
      }
      const parsed = parseMRZFromOCRText(lines);
      if (!parsed) return { kind: 'no-mrz' };
      if (allChecksPass(parsed.checks)) return { kind: 'locked', fields: parsed.fields };
      return { kind: 'partial' };
    } catch (err) {
      console.error('[SCAN-OCR] capture error:', err instanceof Error ? err.message : err);
      return { kind: 'no-mrz' };
    } finally {
      inFlight.current = false;
    }
  }, [cameraRef]);

  // Reset on tab re-entry. After a successful scan or a manual-fail the
  // camera stays mounted but `active` flips false. When the user comes back
  // to the Scan MRZ tab we want a fresh searching session that will overwrite
  // any previously captured fields.
  useEffect(() => {
    if (active && (status === 'locked' || status === 'manual-fail')) {
      setStatus('searching');
      setHintVisible(false);
    }
  }, [active, status]);

  // Auto-capture loop: capture every AUTO_CAPTURE_INTERVAL_MS until locked.
  // Status transitions:
  //   no-mrz  → 'searching'
  //   partial → 'aligning'  (decays back to 'searching' after ALIGNING_DECAY_MS)
  //   locked  → 'locked'    (loop stops, flash + bracket pulse animations fire)
  useEffect(() => {
    if (!active || status === 'locked') return;
    cancelled.current = false;
    startedAt.current = Date.now();
    lastDetectionAt.current = 0;
    setHintVisible(false);

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (cancelled.current) return;
      const outcome = await captureOnce();
      if (cancelled.current) return;

      if (outcome.kind === 'locked' && outcome.fields) {
        // Hold in 'aligning' for LOCK_HOLD_MS so the user sees the border
        // change colour and reads "Hold still…" before we transition to the
        // captured state. Without this dwell the flow goes straight from
        // 'searching' to 'locked' on a clean first frame and the visual
        // confirmation never lands.
        const fields = outcome.fields;
        setStatus('aligning');
        timeout = setTimeout(() => {
          if (cancelled.current) return;
          setStatus('locked');
          onParsed(fields);
          // Capture flash: brief white overlay that fades out.
          flashOpacity.value = withSequence(
            withTiming(0.7, { duration: 80, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 240, easing: Easing.in(Easing.quad) }),
          );
          // Bracket pulse: scale up then settle.
          bracketScale.value = withSequence(
            withTiming(1.05, { duration: 120, easing: Easing.out(Easing.quad) }),
            withTiming(1, { duration: 180, easing: Easing.inOut(Easing.quad) }),
          );
        }, LOCK_HOLD_MS);
        return;
      }

      if (outcome.kind === 'partial') {
        lastDetectionAt.current = Date.now();
        setStatus('aligning');
      } else if (Date.now() - lastDetectionAt.current >= ALIGNING_DECAY_MS) {
        setStatus('searching');
      }

      if (Date.now() - startedAt.current >= HINT_AFTER_MS) setHintVisible(true);
      timeout = setTimeout(tick, AUTO_CAPTURE_INTERVAL_MS);
    };

    timeout = setTimeout(tick, 400); // small initial delay so the camera is warm
    return () => {
      cancelled.current = true;
      if (timeout) clearTimeout(timeout);
      cancelAnimation(flashOpacity);
      cancelAnimation(bracketScale);
    };
  }, [active, status, captureOnce, flashOpacity, bracketScale]);

  const handleManualCapture = useCallback(async () => {
    setStatus('searching');
    const outcome = await captureOnce();
    if (outcome.kind === 'locked' && outcome.fields) {
      setStatus('locked');
      onParsed(outcome.fields);
    } else {
      setStatus('manual-fail');
    }
  }, [captureOnce, onParsed]);

  const overlayLabel =
    status === 'locked' ? 'MRZ Detected ✓'
    : status === 'aligning' ? 'Hold still…'
    : 'Align MRZ lines here';

  const tone = STATUS_TONES[status];

  return (
    <View>
      <View className="rounded-2xl overflow-hidden" style={{ aspectRatio: 4 / 3, position: 'relative' }}>
        <CameraView ref={cameraRef} facing="back" style={{ flex: 1 }}>
          <View className="flex-1 justify-end pb-4 px-4">
            <Animated.View style={bracketStyle}>
              <View
                style={{
                  borderWidth: 2,
                  borderColor: tone.border,
                  borderRadius: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  alignItems: 'center',
                  backgroundColor: tone.bg,
                }}
              >
                <Text
                  style={{
                    color: tone.text,
                    fontSize: 14,
                    fontWeight: '700',
                    letterSpacing: 1,
                  }}
                >
                  {overlayLabel.toUpperCase()}
                </Text>
              </View>
            </Animated.View>
            <Text
              style={{
                color: 'rgba(248,248,242,0.55)',
                fontSize: 11,
                textAlign: 'center',
                marginTop: 6,
              }}
            >
              The bottom two lines of your passport data page
            </Text>
          </View>
        </CameraView>

        {/* Capture flash — full-frame white overlay that fades. */}
        <Animated.View
          pointerEvents="none"
          style={[
            flashStyle,
            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#ffffff' },
          ]}
        />
      </View>

      <View className="mt-3">
        {status === 'locked' && (
          <View className="w-full rounded-2xl py-4 items-center bg-dracula-green/20">
            <Text className="text-dracula-green text-base font-semibold">
              MRZ Scanned — review fields below
            </Text>
          </View>
        )}

        {status === 'manual-fail' && (
          <View className="gap-y-2">
            <View className="w-full rounded-2xl py-3 items-center bg-dracula-red/20">
              <Text className="text-dracula-red text-sm font-semibold">
                Couldn't read MRZ — try better lighting
              </Text>
            </View>
            <Pressable
              onPress={handleManualCapture}
              className="w-full rounded-2xl py-4 items-center bg-dracula-purple active:bg-dracula-purple/80"
            >
              <Text className="text-dracula-fg text-base font-semibold">Capture Now</Text>
            </Pressable>
          </View>
        )}

        {hintVisible && (status === 'searching' || status === 'aligning') && (
          <Text className="text-dracula-comment/70 text-xs text-center mt-2">
            Hold steady. Make sure both MRZ lines are visible and well-lit.
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Camera viewfinder palette
// ---------------------------------------------------------------------------

// Border color carries the state signal; text stays white/green for legibility
// against the live camera background.
const STATUS_TONES: Record<CameraStatus, { border: string; text: string; bg: string }> = {
  searching:    { border: 'rgba(248,248,242,0.85)', text: '#f8f8f2', bg: 'rgba(40,42,54,0.65)' },
  aligning:     { border: '#bd93f9',                 text: '#f8f8f2', bg: 'rgba(40,42,54,0.78)' },
  locked:       { border: '#50fa7b',                 text: '#50fa7b', bg: 'rgba(40,42,54,0.78)' },
  'manual-fail':{ border: 'rgba(248,248,242,0.85)', text: '#f8f8f2', bg: 'rgba(40,42,54,0.65)' },
};

// ---------------------------------------------------------------------------
// Tiny presentational helpers
// ---------------------------------------------------------------------------

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 py-3 items-center ${active ? 'bg-dracula-comment/40' : ''}`}
    >
      <Text className={`text-sm font-semibold ${active ? 'text-dracula-fg' : 'text-dracula-comment/70'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

interface PermissionCardProps {
  text: string;
  cta: string;
  onPress: () => void;
  variant?: 'primary' | 'muted';
  footnote?: string;
}

function PermissionCard({ text, cta, onPress, variant = 'primary', footnote }: PermissionCardProps): React.JSX.Element {
  return (
    <View className="bg-dracula-surface rounded-2xl p-6 items-center gap-y-3">
      <Text className="text-dracula-fg/80 text-sm text-center">{text}</Text>
      <Pressable
        onPress={onPress}
        className={`rounded-xl px-6 py-3 ${
          variant === 'primary'
            ? 'bg-dracula-purple active:bg-dracula-purple/80'
            : 'bg-dracula-comment/40 active:bg-dracula-comment/60'
        }`}
      >
        <Text className="text-dracula-fg text-sm font-semibold">{cta}</Text>
      </Pressable>
      {footnote && (
        <Text className="text-dracula-comment/70 text-xs text-center">{footnote}</Text>
      )}
    </View>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoCapitalize?: 'characters' | 'none';
  keyboardType?: 'default' | 'number-pad';
  maxLength: number;
}

function Field({ label, value, onChangeText, placeholder, autoCapitalize, keyboardType, maxLength }: FieldProps): React.JSX.Element {
  return (
    <View>
      <Text className="text-dracula-comment text-xs font-medium mb-1.5 uppercase tracking-wider">
        {label}
      </Text>
      <TextInput
        className="bg-dracula-surface text-dracula-fg rounded-xl px-4 py-3.5 text-base"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#6272a4"
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        maxLength={maxLength}
      />
    </View>
  );
}
