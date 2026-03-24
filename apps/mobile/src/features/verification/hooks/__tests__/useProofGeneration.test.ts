import { renderHook, act } from '@testing-library/react-native';
import { useProofGeneration } from '../useProofGeneration';
import type { StubProofInput, StubProofOutput, BaseProofOutput } from '../../services/proofService';

const mockStubOutput: StubProofOutput = {
  zkProof: {
    proof: ('0x' + '00'.repeat(320)) as `0x${string}`,
    passportNullifier: ('0x' + '11'.repeat(32)) as `0x${string}`,
    publicSignals: [12345n, 67890n] as const,
  },
  passportNullifierHex: ('0x' + '11'.repeat(32)) as `0x${string}`,
};

// Expected BaseProofOutput produced by the stub fallback path in useProofGeneration
const expectedBaseOutput: BaseProofOutput = {
  type: 'base',
  zkProof: {
    proof: mockStubOutput.zkProof.proof,
    vk: ('0x' + '00'.repeat(32)) as `0x${string}`,
    epochNullifier: mockStubOutput.passportNullifierHex,
    hashedAddress: mockStubOutput.zkProof.publicSignals[1].toString(),
    passportExpiry: '0',
  },
  epochNullifier: mockStubOutput.passportNullifierHex,
};

jest.mock('../../services/proofService', () => ({
  // Simulate Mopro native module not being available (expected in dev/CI)
  generateBaseProof: jest.fn().mockRejectedValue(new Error('Mopro native module not available')),
  generateStubProof: jest.fn().mockImplementation(() => mockStubOutput),
}));

// Silence expected error logs from the hook during error-path tests
beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => (console.error as jest.Mock).mockRestore());

const validInput: StubProofInput = {
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
    // Use a never-resolving promise so we can observe isGenerating=true
    const { generateBaseProof } = jest.requireMock('../../services/proofService') as {
      generateBaseProof: jest.Mock;
    };
    generateBaseProof.mockImplementationOnce(() => new Promise(() => {}));

    const { result, unmount } = renderHook(() => useProofGeneration());

    act(() => {
      void result.current.generate(validInput);
    });

    expect(result.current.isGenerating).toBe(true);

    // Unmount to avoid act() warning from the dangling promise
    unmount();
  });

  it('returns proof result after successful generation', async () => {
    const { result } = renderHook(() => useProofGeneration());

    await act(async () => {
      const promise = result.current.generate(validInput);
      await jest.runAllTimersAsync();
      await promise;
    });

    expect(result.current.result).toEqual(expectedBaseOutput);
    expect(result.current.isGenerating).toBe(false);
  });

  it('throws and sets error for invalid wallet address', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: StubProofInput = {
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

    const invalidInput: StubProofInput = { ...validInput, rawDG1Hex: '' };

    await act(async () => {
      await result.current.generate(invalidInput).catch(() => undefined);
    });

    expect(result.current.error).toBe('Raw DG1 data is required');
  });

  it('throws and sets error when rawSODHex is empty', async () => {
    const { result } = renderHook(() => useProofGeneration());

    const invalidInput: StubProofInput = { ...validInput, rawSODHex: '' };

    await act(async () => {
      await result.current.generate(invalidInput).catch(() => undefined);
    });

    expect(result.current.error).toBe('Raw SOD data is required');
  });
});
