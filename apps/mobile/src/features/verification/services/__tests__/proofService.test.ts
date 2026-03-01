import { generateStubProof, type ProofInput } from '../proofService';

const baseInput: ProofInput = {
  rawDG1Hex: 'aabbccdd00112233',
  rawSODHex: 'ff00ee11dd22cc33',
  walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
};

describe('generateStubProof', () => {
  it('returns correct structure with all required fields', () => {
    const result = generateStubProof(baseInput);

    expect(result).toHaveProperty('zkProof');
    expect(result).toHaveProperty('passportNullifierHex');

    expect(result.zkProof).toHaveProperty('proof');
    expect(result.zkProof).toHaveProperty('passportNullifier');
    expect(result.zkProof).toHaveProperty('publicSignals');
  });

  it('passportNullifier is deterministic — same inputs produce same nullifier', () => {
    const result1 = generateStubProof(baseInput);
    const result2 = generateStubProof(baseInput);

    expect(result1.passportNullifierHex).toBe(result2.passportNullifierHex);
  });

  it('different DG1 data produces different nullifiers', () => {
    const input2: ProofInput = { ...baseInput, rawDG1Hex: '1111111111111111' };

    const result1 = generateStubProof(baseInput);
    const result2 = generateStubProof(input2);

    expect(result1.passportNullifierHex).not.toBe(result2.passportNullifierHex);
  });

  it('different SOD data produces different nullifiers', () => {
    const input2: ProofInput = { ...baseInput, rawSODHex: '2222222222222222' };

    const result1 = generateStubProof(baseInput);
    const result2 = generateStubProof(input2);

    expect(result1.passportNullifierHex).not.toBe(result2.passportNullifierHex);
  });

  it('same passport data with different wallet addresses produces same nullifier', () => {
    const input2: ProofInput = {
      ...baseInput,
      walletAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    };

    const result1 = generateStubProof(baseInput);
    const result2 = generateStubProof(input2);

    // Nullifier depends only on DG1+SOD, not wallet
    expect(result1.passportNullifierHex).toBe(result2.passportNullifierHex);
  });

  it('publicSignals contains passportNullifier and walletAddress as bigints', () => {
    const result = generateStubProof(baseInput);

    expect(result.zkProof.publicSignals).toHaveLength(2);
    expect(typeof result.zkProof.publicSignals[0]).toBe('bigint');
    expect(typeof result.zkProof.publicSignals[1]).toBe('bigint');
    expect(result.zkProof.publicSignals[0]).toBe(BigInt(result.passportNullifierHex));
    expect(result.zkProof.publicSignals[1]).toBe(BigInt(baseInput.walletAddress));
  });

  it('proof starts with 0x and is 642 chars long (0x + 640 hex chars)', () => {
    const result = generateStubProof(baseInput);

    expect(result.zkProof.proof.startsWith('0x')).toBe(true);
    expect(result.zkProof.proof.length).toBe(642);
  });

  it('passportNullifier is a valid bytes32 hex string (0x + 64 hex chars)', () => {
    const result = generateStubProof(baseInput);

    expect(result.passportNullifierHex).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('handles hex inputs with 0x prefix', () => {
    const inputWithPrefix: ProofInput = {
      ...baseInput,
      rawDG1Hex: '0xaabbccdd00112233',
      rawSODHex: '0xff00ee11dd22cc33',
    };

    const result1 = generateStubProof(baseInput);
    const result2 = generateStubProof(inputWithPrefix);

    // Should produce identical results regardless of 0x prefix
    expect(result1.passportNullifierHex).toBe(result2.passportNullifierHex);
  });
});
