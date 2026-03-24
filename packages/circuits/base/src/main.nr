use poseidon::poseidon2::Poseidon2;

/// Phase 3a: Base-tier registration circuit.
///
/// Proves knowledge of (dg1_hash, sod_hash) such that:
///   passport_secret = Poseidon2([dg1_hash, sod_hash])
///   epoch_nullifier = Poseidon2([passport_secret, epoch_day])
///
/// The epoch_nullifier is used for rate-limiting: at most maxDailyRegistrations
/// base registrations per passport per day. Different epoch_day values produce
/// different epoch_nullifiers, so the on-chain count resets each day naturally.
///
/// The epoch_day input is kept private here. The calling contract enforces that
/// the epoch_day encoded in the epoch_nullifier matches the current UTC day by
/// computing floor(block.timestamp / 86400) and passing it to the verifier as
/// an additional public input (Phase 3b concern; stub verifier skips this check).
///
/// Trust model (Phase 3a): the device is trusted to have correctly verified the
/// SOD signature over DG1 before hashing. Phase 3b will move SOD/CSCA
/// verification inside the circuit.
///
/// Public inputs visible to the on-chain verifier:
///   epoch_nullifier -- rate-limiting key (hash of secret + day)
///   hashed_address  -- keccak256(wallet) as a Field; contract checks == keccak256(msg.sender)
///   passport_expiry -- expiry timestamp from DG1 (device-attested in Phase 3a)
fn main(
    // Private inputs (witness)
    dg1_hash: Field,
    sod_hash: Field,
    epoch_day: Field,
    // Public inputs
    epoch_nullifier: pub Field,
    hashed_address: pub Field,
    passport_expiry: pub Field,
) {
    // 1. Derive passport secret
    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);

    // 2. Derive epoch nullifier: unique per (passport, day)
    let computed_epoch_nullifier = Poseidon2::hash([passport_secret, epoch_day], 2);

    // 3. Constrain: provided epoch_nullifier must match
    assert(computed_epoch_nullifier == epoch_nullifier);

    // hashed_address and passport_expiry are public inputs that bind this proof
    // to a specific wallet and passport expiry. The contract verifies these on-chain.
    let _ = hashed_address;
    let _ = passport_expiry;
}

#[test]
fn test_base_nullifier_derivation() {
    let dg1_hash: Field = 1;
    let sod_hash: Field = 2;
    let epoch_day: Field = 20000;

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);
    let expected_nullifier = Poseidon2::hash([passport_secret, epoch_day], 2);

    main(
        dg1_hash,
        sod_hash,
        epoch_day,
        expected_nullifier,
        0, // hashed_address (not constrained in circuit)
        0, // passport_expiry (not constrained in circuit)
    );
}

#[test(should_fail)]
fn test_wrong_epoch_day_fails() {
    let dg1_hash: Field = 1;
    let sod_hash: Field = 2;
    let epoch_day: Field = 20000;
    let wrong_epoch_day: Field = 20001;

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);
    // Derive nullifier for the correct day but pass the wrong day as witness
    let correct_nullifier = Poseidon2::hash([passport_secret, epoch_day], 2);

    // Passing wrong_epoch_day should fail the assert
    main(dg1_hash, sod_hash, wrong_epoch_day, correct_nullifier, 0, 0);
}

#[test(should_fail)]
fn test_wrong_secret_fails() {
    let dg1_hash: Field = 1;
    let sod_hash: Field = 2;
    let epoch_day: Field = 20000;

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);
    let correct_nullifier = Poseidon2::hash([passport_secret, epoch_day], 2);

    // Different dg1_hash produces different secret, so nullifier won't match
    main(42, sod_hash, epoch_day, correct_nullifier, 0, 0);
}
