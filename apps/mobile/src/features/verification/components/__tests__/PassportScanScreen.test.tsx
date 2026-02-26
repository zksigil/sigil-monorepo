import React from 'react';
import { PassportScanScreen } from '../PassportScanScreen';

// Minimal mocks to avoid native module rendering issues
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../hooks/useNFCReader', () => ({
  useNFCReader: () => ({
    readPassport: jest.fn(),
    isScanning: false,
    cancelScan: jest.fn(),
  }),
}));

describe('PassportScanScreen', () => {
  it('should export a function', () => {
    expect(typeof PassportScanScreen).toBe('function');
  });

  it('should create element without error', () => {
    expect(() => {
      React.createElement(PassportScanScreen);
    }).not.toThrow();
  });
});
