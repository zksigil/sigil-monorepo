use std::hash::poseidon2::Poseidon2;

/// Phase 3a: Passport nullifier derivation circuit.
///
/// Proves knowledge of (dg1_hash, sod_hash) such that:
///   passport_secret    = Poseidon2(dg1_hash, sod_hash)
///   passport_nullifier = Poseidon2(passport_secret)
///
/// Trust model (Phase 3a): the device is trusted to have correctly
/// verified the SOD signature over DG1. Phase 3b will move SOD/CSCA
/// verification inside the circuit.
fn main(
    // Private inputs (witness)
    dg1_hash: Field,
    sod_hash: Field,
    // Public inputs
    passport_nullifier: pub Field,
    wallet_address: pub Field,
) {
    // 1. Derive passport secret from document data hashes
    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);

    // 2. Derive nullifier from secret
    let computed_nullifier = Poseidon2::hash([passport_secret], 1);

    // 3. Constrain: provided nullifier must match derived nullifier
    assert(computed_nullifier == passport_nullifier);

    // wallet_address is a public input — the contract verifies it equals
    // msg.sender on-chain. No in-circuit constraint needed beyond binding
    // the proof to this address.
    let _ = wallet_address;
}
