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

/**
 * Distinguishes between a fresh registration and extending an existing one.
 * Both paths take the same passport scan + proof; only the contract function
 * (register vs renew) and some labelling differ.
 */
export type RegistrationMode = 'register' | 'renew';

/**
 * The full set of scan-flow entry points. `discover` is a passport tap that
 * does NOT submit a transaction — it derives the nullifier locally and queries
 * `getWallets(nullifier)` on-chain to enumerate sigilized addresses. (The
 * registry's getter is `getWallets` for compatibility — the name predates the
 * wallet/address terminology cleanup.)
 */
export type ScanMode = RegistrationMode | 'discover';

export type RootStackParamList = {
  Home: undefined;
  PassportScan: { mode?: ScanMode } | undefined;
  ProofGeneration: { passportData: PassportMRZData; mode: RegistrationMode };
  VerificationSuccess: {
    txHash: `0x${string}`;
    verifiedAddress: `0x${string}`;
    mode: RegistrationMode;
  };
  AddressDiscovery: { passportData: PassportMRZData };
};

export type RootStackNavigationProp<Screen extends keyof RootStackParamList> =
  NativeStackNavigationProp<RootStackParamList, Screen>;

export type RootStackRouteProp<Screen extends keyof RootStackParamList> =
  RouteProp<RootStackParamList, Screen>;
