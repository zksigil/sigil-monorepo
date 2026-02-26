/**
 * Environment variable validation and typed access.
 *
 * All EXPO_PUBLIC_* vars are inlined at build time by Expo's bundler.
 * Call validateEnv() once at app startup (dev only) to catch missing vars early.
 */

export interface Env {
  walletConnectProjectId: string;
  verificationRegistryAddress: `0x${string}` | null;
}

export const ENV: Env = {
  walletConnectProjectId: process.env['EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? '',
  verificationRegistryAddress:
    (process.env['EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS'] as `0x${string}` | undefined) ??
    null,
};

/**
 * Throws in development if required environment variables are missing.
 * Should be called once at app startup, guarded by __DEV__.
 */
export function validateEnv(): void {
  const missing: string[] = [];

  if (!ENV.walletConnectProjectId) {
    missing.push('EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID');
  }

  if (missing.length > 0) {
    throw new Error(
      `[env] Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join('\n')}\n\nCopy .env.example to .env and fill in the values.`,
    );
  }
}
