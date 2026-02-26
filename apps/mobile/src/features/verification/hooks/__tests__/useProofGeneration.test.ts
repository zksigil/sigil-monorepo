import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useProofGeneration } from '../useProofGeneration';
import type { ProofInput } from '../../services/proofService';

const mockProofOutput = {
  zkProof: {
    proof: ('0x' + '00'.repeat(320)) as `0x${string}`,
    nullifier: ('0x' + '11'.repeat(32)) as `0x${string}`,
    semaphoreIdentityCommitment: 12345n,
  },
  nullifierHex: ('0x' + '11'.repeat(32)) as `0x${string}`,
  commitmentDecimal: '12345',
};

jest.mock('../../services/proofService', () => ({
  generateStubProof: jest.fn().mockReturnValue(mockProofOutput),
}));

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

    let generatePromise: Promise<unknown>;
    act(() => {
      generatePromise = result.current.generate(validInput);
    });

    // Before the 1s simulated proving delay resolves
    expect(result.current.isGenerating).toBe(true);

    // Advance past the setTimeout(1000)
    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    await act(async () => {
      await generatePromise!;
    });

    expect(result.current.isGenerating).toBe(false);
  });

  it('returns proof result after successful generation', async () => {
    const { result } = renderHook(() => useProofGeneration());

    await act(async () => {
      const promise = result.current.generate(validInput);
      jest.advanceTimersByTime(1100);
      await promise;
    });

    await waitFor(() => {
      expect(result.current.result).toEqual(mockProofOutput);
    });
  });

  it('throws and sets error for invalid wallet address', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = {
      ...validInput,
      walletAddress: 'not-a-hex-address' as `0x${string}`,
    };

    await expect(async () => {
      await act(async () => {
        const promise = result.current.generate(invalidInput);
        jest.advanceTimersByTime(1100);
        await promise;
      });
    }).rejects.toThrow('Invalid wallet address');

    await waitFor(() => {
      expect(result.current.error).toBe("Invalid wallet address");
    });
    expect(result.current.isGenerating).toBe(false);
  });

  it('throws and sets error for invalid date of birth format', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = {
      ...validInput,
      dateOfBirth: '1990-12-31',
    };

    await expect(async () => {
      await act(async () => {
        const promise = result.current.generate(invalidInput);
        jest.advanceTimersByTime(1100);
        await promise;
      });
    }).rejects.toThrow('Date of birth must be YYMMDD format');

    expect(result.current.error).toBe('Date of birth must be YYMMDD format');
  });

  it('throws and sets error for invalid date of expiry format', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = {
      ...validInput,
      dateOfExpiry: 'abcdef',
    };

    await expect(async () => {
      await act(async () => {
        const promise = result.current.generate(invalidInput);
        jest.advanceTimersByTime(1100);
        await promise;
      });
    }).rejects.toThrow('Date of expiry must be YYMMDD format');
  });

  it('throws and sets error when document number is empty', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: ProofInput = { ...validInput, documentNumber: '' };

    await expect(async () => {
      await act(async () => {
        const promise = result.current.generate(invalidInput);
        jest.advanceTimersByTime(1100);
        await promise;
      });
    }).rejects.toThrow('Document number is required');
  });
});
