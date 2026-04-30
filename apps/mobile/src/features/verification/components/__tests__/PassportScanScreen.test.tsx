import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PassportScanScreen } from '../PassportScanScreen';

// ---------------------------------------------------------------------------
// Mocks — must come before component import is resolved
// ---------------------------------------------------------------------------

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockReadPassport = jest.fn();
const mockCancelScan = jest.fn();
jest.mock('../../hooks/useNFCReader', () => ({
  useNFCReader: () => ({
    readPassport: mockReadPassport,
    isScanning: false,
    cancelScan: mockCancelScan,
  }),
}));

const mockRequestCameraPermission = jest.fn();
const mockUseCameraPermissions = jest.fn();
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: (...args: unknown[]) => mockUseCameraPermissions(...args),
}));

jest.mock('@react-native-ml-kit/text-recognition', () => ({
  default: { recognize: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ViewConfigIgnore.js uses Flow `const T` syntax that hermes-parser chokes on
// when jest-expo's ScrollView mock calls requireActual. Mock the native
// component to short-circuit the import chain.
jest.mock('react-native/Libraries/NativeComponent/ViewConfigIgnore', () => ({
  ConditionallyIgnoredEventHandlers: <T,>(value: T) => value,
  DifferentStatesEventHandlers: <T,>(value: T) => value,
  DynamicallyInjectedByGestureHandler: <T,>(value: T) => value,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setPermission(value: null | { granted: boolean; canAskAgain: boolean }) {
  mockUseCameraPermissions.mockReturnValue([value, mockRequestCameraPermission]);
}

function fillMRZAndGoToNFC(
  getByPlaceholderText: ReturnType<typeof render>['getByPlaceholderText'],
  getByText: ReturnType<typeof render>['getByText'],
) {
  fireEvent.changeText(getByPlaceholderText('e.g. AB1234567'), 'AB1234567');
  fireEvent.changeText(getByPlaceholderText('e.g. 901231'), '901231');
  fireEvent.changeText(getByPlaceholderText('e.g. 301231'), '301231');
  fireEvent.changeText(getByPlaceholderText('e.g. USA'), 'USA');
  fireEvent.press(getByText('Continue to NFC Scan'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  setPermission(null);
});

describe('PassportScanScreen', () => {
  it('should export a function', () => {
    expect(typeof PassportScanScreen).toBe('function');
  });

  it('should render MRZ entry step by default', () => {
    const { getByText } = render(<PassportScanScreen />);
    expect(getByText('Scan Passport')).toBeTruthy();
    expect(getByText('Manual Entry')).toBeTruthy();
    expect(getByText('Scan MRZ')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Camera permission states
  // -------------------------------------------------------------------------

  describe('Camera tab — permission not determined', () => {
    it('shows "Allow Camera" button when permission is null', () => {
      setPermission(null);
      const { getByText } = render(<PassportScanScreen />);

      fireEvent.press(getByText('Scan MRZ'));

      expect(getByText('Allow Camera')).toBeTruthy();
      expect(getByText('Camera access is needed to scan your passport MRZ.')).toBeTruthy();
    });

    it('calls requestCameraPermission when "Allow Camera" is pressed', () => {
      setPermission(null);
      const { getByText } = render(<PassportScanScreen />);

      fireEvent.press(getByText('Scan MRZ'));
      fireEvent.press(getByText('Allow Camera'));

      expect(mockRequestCameraPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe('Camera tab — permission granted', () => {
    it('shows CameraView with MRZ guide when permission is granted', () => {
      setPermission({ granted: true, canAskAgain: true });
      const { getByText } = render(<PassportScanScreen />);

      fireEvent.press(getByText('Scan MRZ'));

      expect(getByText('ALIGN MRZ LINES HERE')).toBeTruthy();
    });
  });

  describe('Camera tab — permission permanently denied', () => {
    it('shows "Open Settings" when permission denied and canAskAgain is false', () => {
      setPermission({ granted: false, canAskAgain: false });
      const { getByText } = render(<PassportScanScreen />);

      fireEvent.press(getByText('Scan MRZ'));

      expect(getByText('Open Settings')).toBeTruthy();
      expect(
        getByText('Camera permission was denied. Enable it in Settings to scan MRZ.'),
      ).toBeTruthy();
      expect(getByText('Or use Manual Entry tab to continue')).toBeTruthy();
    });
  });

  describe('Camera tab — permission denied, can ask again', () => {
    it('shows "Grant Camera Access" when denied but canAskAgain is true', () => {
      setPermission({ granted: false, canAskAgain: true });
      const { getByText } = render(<PassportScanScreen />);

      fireEvent.press(getByText('Scan MRZ'));

      expect(getByText('Grant Camera Access')).toBeTruthy();
      expect(
        getByText('Camera access was denied. Grant access to scan MRZ.'),
      ).toBeTruthy();
    });

    it('calls requestCameraPermission when "Grant Camera Access" is pressed', () => {
      setPermission({ granted: false, canAskAgain: true });
      const { getByText } = render(<PassportScanScreen />);

      fireEvent.press(getByText('Scan MRZ'));
      fireEvent.press(getByText('Grant Camera Access'));

      expect(mockRequestCameraPermission).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // handleBeginScan error handling
  // -------------------------------------------------------------------------

  describe('handleBeginScan error handling', () => {
    it('shows error state when readPassport throws', async () => {
      mockReadPassport.mockRejectedValueOnce(new Error('NFC hardware failure'));

      const { getByText, getByPlaceholderText } = render(<PassportScanScreen />);

      fillMRZAndGoToNFC(getByPlaceholderText, getByText);
      fireEvent.press(getByText('Begin NFC Scan'));

      await waitFor(() => {
        expect(getByText('Scan Failed')).toBeTruthy();
        expect(getByText('NFC hardware failure')).toBeTruthy();
      });
    });

    it('shows generic message when readPassport throws non-Error', async () => {
      mockReadPassport.mockRejectedValueOnce('unknown error');

      const { getByText, getByPlaceholderText } = render(<PassportScanScreen />);

      fillMRZAndGoToNFC(getByPlaceholderText, getByText);
      fireEvent.press(getByText('Begin NFC Scan'));

      await waitFor(() => {
        expect(getByText('Scan Failed')).toBeTruthy();
        expect(getByText('NFC scan failed unexpectedly')).toBeTruthy();
      });
    });

    it('allows retry after error', async () => {
      mockReadPassport.mockRejectedValueOnce(new Error('NFC timeout'));

      const { getByText, getByPlaceholderText } = render(<PassportScanScreen />);

      fillMRZAndGoToNFC(getByPlaceholderText, getByText);
      fireEvent.press(getByText('Begin NFC Scan'));

      await waitFor(() => {
        expect(getByText('Scan Failed')).toBeTruthy();
      });

      fireEvent.press(getByText('Try Again'));

      expect(getByText('Begin NFC Scan')).toBeTruthy();
    });
  });
});
