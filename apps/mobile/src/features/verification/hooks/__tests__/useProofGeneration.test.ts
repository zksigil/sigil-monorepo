import { renderHook, act } from '@testing-library/react-native';
import { useProofGeneration } from '../useProofGeneration';
import type { ProofInput, ProofOutput } from '../../services/proofService';

const mockProofOutput: ProofOutput = {
  zkProof: {
    proof: ('0x' + '00'.repeat(320)) as `0x${string}`,
    passportNullifier: ('0x' + '11'.repeat(32)) as `0x${string}`,
    publicSignals: [12345n, 67890n] as const,
  },
  passportNullifierHex: ('0x' + '11'.repeat(32)) as `0x${string}`,
};

jest.mock('../../services/proofService', () => ({
  generateStubProof: jest.fn().mockImplementation(() => mockProofOutput),
}));

// Silence expected error logs from the hook during error-path tests
beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => (console.error as jest.Mock).mockRestore());

const validInput: ProofInput = {
  rawDG1Hex: 'aabbccdd00112233',
  rawSODHex: 'ff00ee11dd22cc33',
  walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
};

describe('useProofGeneration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('has correct initial state', () => {
    const { result } = renderHook(() => useProofGeneration());

    expect(result.current.isGenerating).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(typeof result.current.generate).toBe('function');
  });

  it('sets isGenerating=true during generation', async () => {
    const { result } = renderHook(() => useProofGeneration());

    // Start generation without advancing timers so it stays pending
    let promise: Promise<ProofOutput>;
    await act(async () => {
      promise = result.current.generate(validInput);
    });

    // Timer hasn't fired yet — should still be generating
    expect(result.current.isGenerating).toBe(true);

    // Advance past the 1s delay and resolve
    await act(async () => {
      await jest.runAllTimersAsync();
      await promise!;
    });

    expect(result.current.isGenerating).toBe(false);
  });

  it('returns proof result after successful generation', async () => {
    const { result } = renderHook(() => useProofGeneration());

    await act(async () => {
      const promise = result.current.generate(validInput);
      await jest.runAllTimersAsync();
      await promise;
    });

    expect(result.current.result).toEqual(mockProofOutput);
    expect(result.current.isGenerating).toBe(false);
  });

  it('throws and sets error for invalid wallet address', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = {
      ...validInput,
      walletAddress: 'not-a-hex-address' as `0x${string}`,
    };

    await act(async () => {
      await result.current.generate(invalidInput).catch(() => undefined);
    });

    expect(result.current.error).toBe('Invalid wallet address');
    expect(result.current.isGenerating).toBe(false);
  });

  it('throws and sets error when rawDG1Hex is empty', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = { ...validInput, rawDG1Hex: '' };

    await act(async () => {
      await result.current.generate(invalidInput).catch(() => undefined);
    });

    expect(result.current.error).toBe('Raw DG1 data is required');
  });

  it('throws and sets error when rawSODHex is empty', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = { ...validInput, rawSODHex: '' };

    await act(async () => {
      await result.current.generate(invalidInput).catch(() => undefined);
    });

    expect(result.current.error).toBe('Raw SOD data is required');
  });
});
