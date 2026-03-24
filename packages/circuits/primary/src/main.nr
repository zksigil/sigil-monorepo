use poseidon::poseidon2::Poseidon2;

/// Phase 3a: Primary-tier registration and change circuit.
///
/// Proves knowledge of (dg1_hash, sod_hash, nonce) such that:
///   passport_secret  = Poseidon2([dg1_hash, sod_hash])
///   nullifier        = Poseidon2([passport_secret, nonce])
///   next_nullifier   = Poseidon2([passport_secret, nonce + 1])
///   next_commitment  = Poseidon2([next_nullifier])   -- hashed one extra time
///
/// The double-hash for next_commitment means the contract can verify a changePrimary
/// call by checking hash(revealed_next_nullifier) == stored next_commitment, without
/// exposing next_nullifier on-chain in advance.
///
/// Nonce starts at 1 and increments on each primary address change. This keeps
/// old and new on-chain nullifiers cryptographically unrelated (no shared prefix).
///
/// Trust model (Phase 3a): the device is trusted to have correctly verified the
/// SOD signature over DG1 before hashing. Phase 3b will move SOD/CSCA
/// verification inside the circuit.
///
/// Public inputs visible to the on-chain verifier:
///   nullifier       -- stored on-chain as the primary slot key
///   next_commitment -- stored alongside the slot; used to verify future changePrimary
///   hashed_address  -- keccak256(wallet) as a Field; contract checks == keccak256(msg.sender)
///   passport_expiry -- expiry timestamp from DG1 (device-attested in Phase 3a)
fn main(
    // Private inputs (witness)
    dg1_hash: Field,
    sod_hash: Field,
    nonce: Field,
    // Public inputs
    nullifier: pub Field,
    next_commitment: pub Field,
    hashed_address: pub Field,
    passport_expiry: pub Field,
) {
    // 1. Derive passport secret
    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);

    // 2. Derive nullifier at current nonce
    let computed_nullifier = Poseidon2::hash([passport_secret, nonce], 2);
    assert(computed_nullifier == nullifier);

    // 3. Derive next nullifier (nonce + 1) and its commitment (double-hash)
    let next_nullifier = Poseidon2::hash([passport_secret, nonce + 1], 2);
    let computed_next_commitment = Poseidon2::hash([next_nullifier], 1);
    assert(computed_next_commitment == next_commitment);

    // hashed_address and passport_expiry bind this proof to a specific wallet
    // and passport. The contract verifies these on-chain.
    let _ = hashed_address;
    let _ = passport_expiry;
}

#[test]
fn test_primary_nullifier_derivation() {
    let dg1_hash: Field = 1;
    let sod_hash: Field = 2;
    let nonce: Field = 1;

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);
    let expected_nullifier = Poseidon2::hash([passport_secret, nonce], 2);
    let next_nullifier = Poseidon2::hash([passport_secret, nonce + 1], 2);
    let expected_next_commitment = Poseidon2::hash([next_nullifier], 1);

    main(
        dg1_hash,
        sod_hash,
        nonce,
        expected_nullifier,
        expected_next_commitment,
        0, // hashed_address (not constrained in circuit)
        0, // passport_expiry (not constrained in circuit)
    );
}

#[test]
fn test_nullifier_changes_with_nonce() {
    let dg1_hash: Field = 1;
    let sod_hash: Field = 2;

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);
    let nullifier_1 = Poseidon2::hash([passport_secret, 1], 2);
    let nullifier_2 = Poseidon2::hash([passport_secret, 2], 2);

    // Nullifiers at different nonces must differ
    assert(nullifier_1 != nullifier_2);
}

#[test]
fn test_next_commitment_matches_hash_of_next_nullifier() {
    let dg1_hash: Field = 3;
    let sod_hash: Field = 7;
    let nonce: Field = 5;

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);
    let nullifier = Poseidon2::hash([passport_secret, nonce], 2);
    let next_nullifier = Poseidon2::hash([passport_secret, nonce + 1], 2);
    let next_commitment = Poseidon2::hash([next_nullifier], 1);

    // Verify the contract's changePrimary check: hash(revealed_next_nullifier) == next_commitment
    let rehashed = Poseidon2::hash([next_nullifier], 1);
    assert(rehashed == next_commitment);

    main(dg1_hash, sod_hash, nonce, nullifier, next_commitment, 0, 0);
}

#[test(should_fail)]
fn test_wrong_nonce_fails() {
    let dg1_hash: Field = 1;
    let sod_hash: Field = 2;
    let nonce: Field = 1;

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);
    let correct_nullifier = Poseidon2::hash([passport_secret, nonce], 2);
    let next_nullifier = Poseidon2::hash([passport_secret, nonce + 1], 2);
    let correct_next_commitment = Poseidon2::hash([next_nullifier], 1);

    // Passing nonce=2 while nullifier was derived from nonce=1 must fail
    main(dg1_hash, sod_hash, 2, correct_nullifier, correct_next_commitment, 0, 0);
}

#[test(should_fail)]
fn test_wrong_next_commitment_fails() {
    let dg1_hash: Field = 1;
    let sod_hash: Field = 2;
    let nonce: Field = 1;

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);
    let correct_nullifier = Poseidon2::hash([passport_secret, nonce], 2);

    // Provide an incorrect next_commitment
    main(dg1_hash, sod_hash, nonce, correct_nullifier, 999, 0, 0);
}
