import { generateStubProof, type ProofInput } from '../proofService';

// Use real viem — keccak256 and encodePacked are pure functions that work in Node.

const baseInput: ProofInput = {
  documentNumber: 'AB1234567',
  dateOfBirth: '901231',
  dateOfExpiry: '301231',
  nationality: 'USA',
  walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
};

describe('generateStubProof', () => {
  it('returns correct structure with all required fields', () => {
    const result = generateStubProof(baseInput);

    expect(result).toHaveProperty('zkProof');
    expect(result).toHaveProperty('nullifierHex');
    expect(result).toHaveProperty('commitmentDecimal');

    expect(result.zkProof).toHaveProperty('proof');
    expect(result.zkProof).toHaveProperty('nullifier');
    expect(result.zkProof).toHaveProperty('semaphoreIdentityCommitment');
  });

  it('nullifier is deterministic — same inputs produce same nullifier', () => {
    const result1 = generateStubProof(baseInput);
    const result2 = generateStubProof(baseInput);

    expect(result1.nullifierHex).toBe(result2.nullifierHex);
  });

  it('different document numbers produce different nullifiers', () => {
    const input2: ProofInput = { ...baseInput, documentNumber: 'ZZ9999999' };

    const result1 = generateStubProof(baseInput);
    const result2 = generateStubProof(input2);

    expect(result1.nullifierHex).not.toBe(result2.nullifierHex);
  });

  it('semaphoreIdentityCommitment is a bigint', () => {
    const result = generateStubProof(baseInput);

    expect(typeof result.zkProof.semaphoreIdentityCommitment).toBe('bigint');
  });

  it('proof starts with 0x and is 642 chars long (0x + 640 hex chars)', () => {
    const result = generateStubProof(baseInput);

    expect(result.zkProof.proof.startsWith('0x')).toBe(true);
    expect(result.zkProof.proof.length).toBe(642);
  });

  it('nullifier is a valid bytes32 hex string (0x + 64 hex chars)', () => {
    const result = generateStubProof(baseInput);

    expect(result.nullifierHex).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('different wallet addresses produce different commitments', () => {
    const input2: ProofInput = {
      ...baseInput,
      walletAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    };

    const result1 = generateStubProof(baseInput);
    const result2 = generateStubProof(input2);

    expect(result1.commitmentDecimal).not.toBe(result2.commitmentDecimal);
    // But nullifiers should be the same (same passport data)
    expect(result1.nullifierHex).toBe(result2.nullifierHex);
  });

  it('commitmentDecimal is a valid decimal string representation of bigint', () => {
    const result = generateStubProof(baseInput);

    expect(() => BigInt(result.commitmentDecimal)).not.toThrow();
    expect(BigInt(result.commitmentDecimal)).toBe(
      result.zkProof.semaphoreIdentityCommitment,
    );
  });
});
