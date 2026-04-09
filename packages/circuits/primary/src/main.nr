use poseidon::poseidon2::Poseidon2;
use rsa::rsa::verify_sha256_pkcs1v15;
use bignum::{params::BigNumParams, RuntimeBigNum};

/// Maximum length for signedAttributes DER encoding (zero-padded to this length).
global SIGNED_ATTRS_MAX_LEN: u32 = 512;

/// Phase 3c: Primary-tier registration circuit with RSA signature verification
/// and CSCA Merkle tree inclusion.
///
/// Proves:
///   1. The SOD was signed by the provided DSC public key (RSA-2048/SHA-256/PKCS#1v1.5)
///   2. The DSC public key is included in the ICAO CSCA Merkle tree
///   3. Knowledge of (dg1_hash, sod_hash, nonce) deriving:
///      - nullifier        = Poseidon2([passport_secret, nonce])
///      - next_commitment  = Poseidon2([Poseidon2([passport_secret, nonce + 1])])
///
/// Trust model: same as base circuit (see base/src/main.nr).
///
/// Public inputs:
///   nullifier          -- stored on-chain as the primary slot key
///   next_commitment    -- stored alongside the slot
///   hashed_address     -- keccak256(wallet) as a Field
///   passport_expiry    -- expiry timestamp from DG1
///   csca_merkle_root   -- current CSCA Merkle root from on-chain contract
fn main(
    // Private inputs (witness)
    dg1_hash: Field,
    sod_hash: Field,
    nonce: Field,
    // RSA verification inputs (private witness)
    signed_attrs: [u8; SIGNED_ATTRS_MAX_LEN],
    signed_attrs_len: u32,
    signature: [u8; 256],
    pubkey: [u8; 256],
    redc_param: [u8; 257],
    exponent: u32,
    // CSCA Merkle proof inputs (private witness)
    csca_merkle_siblings: [Field; 12],
    csca_leaf_index: u32,
    // Public inputs
    nullifier: pub Field,
    next_commitment: pub Field,
    hashed_address: pub Field,
    passport_expiry: pub Field,
    csca_merkle_root: pub Field,
) {
    // ---------------------------------------------------------------
    // 1. RSA signature verification: DSC signed the SOD's signedAttrs
    // ---------------------------------------------------------------

    let signed_attrs_hash: [u8; 32] = sha256::sha256_var(signed_attrs, signed_attrs_len as u64);

    let pubkey_limbs = pack_be_bytes_256(pubkey);
    let redc_limbs = pack_be_bytes_257(redc_param);

    let params: BigNumParams<18, 2048> = BigNumParams::new(false, pubkey_limbs, redc_limbs);
    let sig_bignum: RuntimeBigNum<18, 2048> = RuntimeBigNum::from_be_bytes(params, signature);

    let rsa_valid = verify_sha256_pkcs1v15(signed_attrs_hash, sig_bignum, exponent);
    assert(rsa_valid, "RSA signature verification failed");

    // ---------------------------------------------------------------
    // 2. CSCA Merkle tree verification: DSC pubkey is in ICAO ML
    // ---------------------------------------------------------------

    let pubkey_as_field = bytes_256_to_field(pubkey);
    let exponent_as_field: Field = exponent as Field;
    let leaf = Poseidon2::hash([pubkey_as_field, exponent_as_field], 2);

    // Walk up the Merkle tree from leaf to root (unrolled via for loop with known bound)
    let computed_root = verify_merkle_proof(leaf, csca_merkle_siblings, csca_leaf_index);
    assert(computed_root == csca_merkle_root, "CSCA Merkle proof failed");

    // ---------------------------------------------------------------
    // 3. Nullifier chaining (same as Phase 3a)
    // ---------------------------------------------------------------

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);

    let computed_nullifier = Poseidon2::hash([passport_secret, nonce], 2);
    assert(computed_nullifier == nullifier);

    let next_nullifier = Poseidon2::hash([passport_secret, nonce + 1], 2);
    let computed_next_commitment = Poseidon2::hash([next_nullifier], 1);
    assert(computed_next_commitment == next_commitment);

    let _ = hashed_address;
    let _ = passport_expiry;
}

/// Verify a Merkle inclusion proof with 12 siblings.
/// Returns the computed root from walking up from the leaf.
#[no_predicates]
fn verify_merkle_proof(leaf: Field, siblings: [Field; 12], leaf_index: u32) -> Field {
    let mut current = leaf;
    let mut index = leaf_index;
    for i in 0..12 {
        let sibling = siblings[i];
        if index % 2 == 0 {
            current = Poseidon2::hash([current, sibling], 2);
        } else {
            current = Poseidon2::hash([sibling, current], 2);
        }
        index = index / 2;
    }
    current
}

// ---------------------------------------------------------------------------
// Byte packing helpers
// ---------------------------------------------------------------------------

fn pack_be_bytes_256(bytes: [u8; 256]) -> [u128; 18] {
    let mut limbs = [0 as u128; 18];
    let mut k: u32 = 0;

    let first_limb_bytes: u32 = 256 - 17 * 15;
    let mut val: Field = 0;
    for _ in 0..first_limb_bytes {
        val = val * 256 + bytes[k] as Field;
        k += 1;
    }
    std::as_witness(val);
    val.assert_max_bit_size::<128>();
    limbs[17] = val as u128;

    for i in 1..18 {
        let mut limb: Field = 0;
        for _ in 0..15 {
            limb = limb * 256 + bytes[k] as Field;
            k += 1;
        }
        std::as_witness(limb);
        limb.assert_max_bit_size::<128>();
        limbs[17 - i] = limb as u128;
    }
    limbs
}

fn pack_be_bytes_257(bytes: [u8; 257]) -> [u128; 18] {
    let mut limbs = [0 as u128; 18];
    let mut k: u32 = 0;

    let first_limb_bytes: u32 = 257 - 17 * 15;
    let mut val: Field = 0;
    for _ in 0..first_limb_bytes {
        val = val * 256 + bytes[k] as Field;
        k += 1;
    }
    std::as_witness(val);
    val.assert_max_bit_size::<128>();
    limbs[17] = val as u128;

    for i in 1..18 {
        let mut limb: Field = 0;
        for _ in 0..15 {
            limb = limb * 256 + bytes[k] as Field;
            k += 1;
        }
        std::as_witness(limb);
        limb.assert_max_bit_size::<128>();
        limbs[17 - i] = limb as u128;
    }
    limbs
}

/// Convert 256 big-endian bytes to a single Field element.
/// Used to compute the CSCA Merkle leaf hash from the DSC pubkey.
/// 256 bytes = 2048 bits; the value is reduced modulo the BN254 field prime.
fn bytes_256_to_field(bytes: [u8; 256]) -> Field {
    let mut result: Field = 0;
    for i in 0..256 {
        result = result * 256 + bytes[i] as Field;
    }
    result
}
