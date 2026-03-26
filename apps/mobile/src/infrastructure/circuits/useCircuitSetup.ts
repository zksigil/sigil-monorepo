import { useEffect } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { setCircuitPaths } from '../../features/verification/services/proofService';

// Metro bundles these as inline JS modules (parsed JSON objects)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BASE_CIRCUIT = require('../../../assets/circuits/passport_base.json') as unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PRIMARY_CIRCUIT = require('../../../assets/circuits/passport_primary.json') as unknown;

const CIRCUITS_DIR = `${FileSystem.documentDirectory ?? ''}circuits/`;

async function setupCircuits(): Promise<void> {
  await FileSystem.makeDirectoryAsync(CIRCUITS_DIR, { intermediates: true });

  const baseDest = `${CIRCUITS_DIR}passport_base.json`;
  const primaryDest = `${CIRCUITS_DIR}passport_primary.json`;

  // Write circuit JSON to writable FS so native Mopro code can read them by path
  const baseInfo = await FileSystem.getInfoAsync(baseDest);
  if (!baseInfo.exists) {
    await FileSystem.writeAsStringAsync(baseDest, JSON.stringify(BASE_CIRCUIT));
    console.log('[CIRCUIT] Wrote passport_base.json to', baseDest);
  }

  const primaryInfo = await FileSystem.getInfoAsync(primaryDest);
  if (!primaryInfo.exists) {
    await FileSystem.writeAsStringAsync(primaryDest, JSON.stringify(PRIMARY_CIRCUIT));
    console.log('[CIRCUIT] Wrote passport_primary.json to', primaryDest);
  }

  // expo-file-system returns file:// URIs; Rust fs::read_to_string needs plain POSIX paths
  const toFsPath = (uri: string) => uri.replace(/^file:\/\//, '');

  setCircuitPaths(toFsPath(baseDest), toFsPath(primaryDest));
  console.log('[CIRCUIT] Circuit paths set:', toFsPath(baseDest));
}

/**
 * Call once at app startup. Copies circuit JSONs from the bundled JS module
 * to the writable filesystem and registers paths with proofService.
 */
export function useCircuitSetup(): void {
  useEffect(() => {
    setupCircuits().catch((err: unknown) => {
      console.warn('[CIRCUIT] Failed to set up circuit files:', err);
    });
  }, []);
}
