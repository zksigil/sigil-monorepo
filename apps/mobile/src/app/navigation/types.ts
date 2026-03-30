import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

export interface PassportMRZData {
  readonly documentNumber: string;
  readonly dateOfBirth: string;    // YYMMDD
  readonly dateOfExpiry: string;   // YYMMDD
  readonly nationality: string;    // ISO 3166-1 alpha-3
  readonly rawDG1Hex: string;      // hex-encoded DG1 bytes from NFC
  readonly rawSODHex: string;      // hex-encoded SOD bytes from NFC (Phase 3)
}

/** User-facing tier names. Maps to contract functions: unique→registerPrimary, verified→registerBase. */
export type VerificationTier = 'unique' | 'verified';

export type RootStackParamList = {
  Home: undefined;
  PassportScan: { tier: VerificationTier };
  ProofGeneration: { passportData: PassportMRZData; tier: VerificationTier };
  VerificationSuccess: {
    txHash: `0x${string}`;
    groupSize: number;
    verifiedAddress: `0x${string}`;
    tier: VerificationTier;
  };
};

export type RootStackNavigationProp<Screen extends keyof RootStackParamList> =
  NativeStackNavigationProp<RootStackParamList, Screen>;

export type RootStackRouteProp<Screen extends keyof RootStackParamList> =
  RouteProp<RootStackParamList, Screen>;
