import { useCallback, useRef, useState } from 'react';
import {
  readPassportNFC,
  cancelNFCScan,
  type NFCReadResult,
  type MRZBACInput,
} from '../../../infrastructure/nfc';

interface UseNFCReaderReturn {
  readPassport: (mrzInput: MRZBACInput) => Promise<NFCReadResult>;
  isScanning: boolean;
  cancelScan: () => void;
}

export function useNFCReader(): UseNFCReaderReturn {
  const [isScanning, setIsScanning] = useState(false);
  const scanningRef = useRef(false);

  const readPassport = useCallback(async (mrzInput: MRZBACInput): Promise<NFCReadResult> => {
    if (scanningRef.current) {
      return {
        success: false,
        error: { code: 'read_failed', message: 'A scan is already in progress' },
      };
    }

    scanningRef.current = true;
    setIsScanning(true);

    try {
      const result = await readPassportNFC(mrzInput);
      return result;
    } finally {
      scanningRef.current = false;
      setIsScanning(false);
    }
  }, []);

  const cancelScan = useCallback(() => {
    if (scanningRef.current) {
      void cancelNFCScan();
    }
  }, []);

  return { readPassport, isScanning, cancelScan };
}
