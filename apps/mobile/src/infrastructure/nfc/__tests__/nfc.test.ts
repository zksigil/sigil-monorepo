import NfcManager from 'react-native-nfc-manager';
import { getNFCStatus, readPassportNFC } from '../index';

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    start: jest.fn().mockResolvedValue(undefined),
    isSupported: jest.fn().mockResolvedValue(false),
    isEnabled: jest.fn().mockResolvedValue(true),
    requestTechnology: jest.fn().mockResolvedValue(undefined),
    cancelTechnologyRequest: jest.fn().mockResolvedValue(undefined),
    isoDepHandler: {
      transceive: jest.fn(),
    },
  },
  NfcTech: { IsoDep: 'IsoDep' },
  Ndef: {},
}));

// sha1 mock not needed for these status-level tests; the real module
// is only invoked during BAC key derivation which we don't reach here.

const mockNfcManager = NfcManager as jest.Mocked<typeof NfcManager>;

// Reset the internal _managerStarted flag between tests by re-requiring
// We can't easily reset module-level state, so we isolate via ordering.

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getNFCStatus
// ---------------------------------------------------------------------------

describe('getNFCStatus', () => {
  it('returns "unavailable" when isSupported() resolves false', async () => {
    (mockNfcManager.isSupported as jest.Mock).mockResolvedValue(false);

    const status = await getNFCStatus();
    expect(status).toBe('unavailable');
  });

  it('returns "disabled" when isSupported=true but isEnabled=false', async () => {
    (mockNfcManager.isSupported as jest.Mock).mockResolvedValue(true);
    (mockNfcManager.isEnabled as jest.Mock).mockResolvedValue(false);

    const status = await getNFCStatus();
    expect(status).toBe('disabled');
  });

  it('returns "ready" when isSupported=true and isEnabled=true', async () => {
    (mockNfcManager.isSupported as jest.Mock).mockResolvedValue(true);
    (mockNfcManager.isEnabled as jest.Mock).mockResolvedValue(true);

    const status = await getNFCStatus();
    expect(status).toBe('ready');
  });

  it('returns "unavailable" when isSupported throws', async () => {
    (mockNfcManager.isSupported as jest.Mock).mockRejectedValue(
      new Error('NFC hardware error'),
    );

    const status = await getNFCStatus();
    expect(status).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// readPassportNFC — early-exit paths
// ---------------------------------------------------------------------------

describe('readPassportNFC', () => {
  const mrzInput = {
    documentNumber: 'AB1234567',
    dateOfBirth: '901231',
    dateOfExpiry: '301231',
  };

  it('returns unsupported error when NFC is unavailable', async () => {
    (mockNfcManager.isSupported as jest.Mock).mockResolvedValue(false);

    const result = await readPassportNFC(mrzInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('unsupported');
    }
  });

  it('returns disabled error when NFC is disabled', async () => {
    (mockNfcManager.isSupported as jest.Mock).mockResolvedValue(true);
    (mockNfcManager.isEnabled as jest.Mock).mockResolvedValue(false);

    const result = await readPassportNFC(mrzInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('disabled');
    }
  });

  it('returns cancelled error when user cancels the NFC session', async () => {
    (mockNfcManager.isSupported as jest.Mock).mockResolvedValue(true);
    (mockNfcManager.isEnabled as jest.Mock).mockResolvedValue(true);
    (mockNfcManager.requestTechnology as jest.Mock).mockRejectedValue(
      new Error('User cancelled NFC session'),
    );

    const result = await readPassportNFC(mrzInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('cancelled');
    }
  });
});
