import { renderHook, act } from '@testing-library/react-native';
import { useProofGeneration } from '../useProofGeneration';
import type { ProofInput, ProofOutput } from '../../services/proofService';

const mockProofOutput: ProofOutput = {
  zkProof: {
    proof: ('0x' + '00'.repeat(320)) as `0x${string}`,
    nullifier: ('0x' + '11'.repeat(32)) as `0x${string}`,
    semaphoreIdentityCommitment: 12345n,
  },
  nullifierHex: ('0x' + '11'.repeat(32)) as `0x${string}`,
  commitmentDecimal: '12345',
};

jest.mock('../../services/proofService', () => ({
  generateStubProof: jest.fn().mockImplementation(() => mockProofOutput),
}));

// Silence expected error logs from the hook during error-path tests
beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => (console.error as jest.Mock).mockRestore());

const validInput: ProofInput = {
  documentNumber: 'AB1234567',
  dateOfBirth: '901231',
  dateOfExpiry: '301231',
  nationality: 'USA',
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

  it('throws and sets error for invalid date of birth format', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = {
      ...validInput,
      dateOfBirth: '1990-12-31',
    };

    await act(async () => {
      await result.current.generate(invalidInput).catch(() => undefined);
    });

    expect(result.current.error).toBe('Date of birth must be YYMMDD format');
  });

  it('throws and sets error for invalid date of expiry format', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = {
      ...validInput,
      dateOfExpiry: 'abcdef',
    };

    await act(async () => {
      await result.current.generate(invalidInput).catch(() => undefined);
    });

    expect(result.current.error).toBe('Date of expiry must be YYMMDD format');
  });

  it('throws and sets error when document number is empty', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = { ...validInput, documentNumber: '' };

    await act(async () => {
      await result.current.generate(invalidInput).catch(() => undefined);
    });

    expect(result.current.error).toBe('Document number is required');
  });
});
