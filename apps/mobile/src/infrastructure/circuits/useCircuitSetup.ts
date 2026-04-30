import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { setCircuitPaths } from '../../features/verification/services/proofService';

// Metro bundles this as an inline JS module (parsed JSON object)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SIGIL_CIRCUIT = require('../../../assets/circuits/passport_sigil.json') as unknown;

const CIRCUITS_DIR = `${FileSystem.documentDirectory ?? ''}circuits/`;
const SRS_DIR = `${FileSystem.documentDirectory ?? ''}srs/`;
const SRS_DEST = `${SRS_DIR}g1.dat`;

// SRS size: 2^19 + 1 points * 64 bytes/point = 33,554,496 bytes.
// Covers circuits up to ~500K gates (more than enough for RSA-2048).
const SRS_NUM_POINTS = (1 << 19) + 1;
const SRS_BYTE_SIZE = SRS_NUM_POINTS * 64;
const SRS_URL = 'https://crs.aztec.network/g1.dat';

/**
 * Compare the bundled circuit's hash against what's on disk.
 * Returns true if the file needs to be (re-)written.
 */
async function needsWrite(dest: string, bundled: unknown): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(dest);
  if (!info.exists) return true;
  const existing = await FileSystem.readAsStringAsync(dest);
  try {
    const existingHash = (JSON.parse(existing) as { hash?: string }).hash;
    const bundledHash = (bundled as { hash?: string }).hash;
    if (existingHash && bundledHash && existingHash !== bundledHash) {
      console.log(`[CIRCUIT] Hash mismatch for ${dest} (${existingHash} -> ${bundledHash}), overwriting`);
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

/**
 * Download the Aztec SRS g1.dat to the local filesystem if not already cached.
 * Returns the POSIX path to the file, or null if the download fails.
 */
async function ensureSrs(): Promise<string | null> {
  await FileSystem.makeDirectoryAsync(SRS_DIR, { intermediates: true });

  const info = await FileSystem.getInfoAsync(SRS_DEST);
  if (info.exists && 'size' in info && info.size === SRS_BYTE_SIZE) {
    console.log('[SRS] Cached g1.dat found, size OK');
    return SRS_DEST.replace(/^file:\/\//, '');
  }

  if (info.exists) {
    await FileSystem.deleteAsync(SRS_DEST, { idempotent: true });
  }

  console.log(`[SRS] Downloading g1.dat (${(SRS_BYTE_SIZE / 1024 / 1024).toFixed(0)} MB)...`);

  try {
    const download = FileSystem.createDownloadResumable(
      SRS_URL,
      SRS_DEST,
      {
        headers: {
          Range: `bytes=0-${SRS_BYTE_SIZE - 1}`,
        },
      },
      (progress) => {
        const pct = ((progress.totalBytesWritten / SRS_BYTE_SIZE) * 100).toFixed(0);
        console.log(`[SRS] Download progress: ${pct}%`);
      },
    );

    const result = await download.downloadAsync();
    if (!result || result.status !== 206) {
      console.warn('[SRS] Download failed with status:', result?.status);
      await FileSystem.deleteAsync(SRS_DEST, { idempotent: true });
      return null;
    }

    console.log('[SRS] Download complete');
    return SRS_DEST.replace(/^file:\/\//, '');
  } catch (err) {
    console.warn('[SRS] Download error:', err);
    await FileSystem.deleteAsync(SRS_DEST, { idempotent: true });
    return null;
  }
}

async function setupCircuits(): Promise<void> {
  await FileSystem.makeDirectoryAsync(CIRCUITS_DIR, { intermediates: true });

  const sigilDest = `${CIRCUITS_DIR}passport_sigil.json`;

  // Write circuit JSON to writable FS so native Mopro code can read them by path.
  // Always overwrite when the bundled circuit hash differs from what's on disk -
  // a stale bytecode causes Barretenberg to abort with a foreign exception.
  if (await needsWrite(sigilDest, SIGIL_CIRCUIT)) {
    await FileSystem.writeAsStringAsync(sigilDest, JSON.stringify(SIGIL_CIRCUIT));
    console.log('[CIRCUIT] Wrote passport_sigil.json to', sigilDest);
  }

  const srsPath = await ensureSrs();
  if (srsPath) {
    console.log('[SRS] Using local SRS at:', srsPath);
  } else {
    console.warn('[SRS] SRS not available - proof generation will attempt network download');
  }

  // expo-file-system returns file:// URIs; Rust fs::read_to_string needs plain POSIX paths
  const toFsPath = (uri: string) => uri.replace(/^file:\/\//, '');

  setCircuitPaths(toFsPath(sigilDest), srsPath ?? undefined);
  console.log('[CIRCUIT] Circuit path set:', toFsPath(sigilDest));
}

/**
 * Call once at app startup. Copies circuit JSON from the bundled JS module
 * to the writable filesystem, downloads the SRS if needed, and registers
 * the path with proofService.
 */
export function useCircuitSetup(): { srsReady: boolean } {
  const [srsReady, setSrsReady] = useState(false);

  useEffect(() => {
    setupCircuits()
      .then(() => setSrsReady(true))
      .catch((err: unknown) => {
        console.warn('[CIRCUIT] Failed to set up circuit files:', err);
      });
  }, []);

  return { srsReady };
}
