import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

export interface PassportMRZData {
  readonly documentNumber: string;
  readonly dateOfBirth: string;    // YYMMDD
  readonly dateOfExpiry: string;   // YYMMDD
  readonly nationality: string;    // ISO 3166-1 alpha-3
  readonly rawDG1Hex: string;      // hex-encoded DG1 bytes from NFC
  readonly rawSODHex: string;      // hex-encoded SOD bytes from NFC
}

export type RootStackParamList = {
  Home: undefined;
  PassportScan: undefined;
  ProofGeneration: { passportData: PassportMRZData };
  VerificationSuccess: {
    txHash: `0x${string}`;
    verifiedAddress: `0x${string}`;
  };
};

export type RootStackNavigationProp<Screen extends keyof RootStackParamList> =
  NativeStackNavigationProp<RootStackParamList, Screen>;

export type RootStackRouteProp<Screen extends keyof RootStackParamList> =
  RouteProp<RootStackParamList, Screen>;
