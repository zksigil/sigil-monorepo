use poseidon::poseidon2::Poseidon2;
use rsa::rsa::verify_sha256_pkcs1v15;
use bignum::{params::BigNumParams, RuntimeBigNum};

/// Maximum length for signedAttributes DER encoding (zero-padded to this length).
global SIGNED_ATTRS_MAX_LEN: u32 = 512;

/// Phase 3b: Primary-tier registration circuit with RSA signature verification.
///
/// Proves:
///   1. The SOD was signed by the provided DSC public key (RSA-2048/SHA-256/PKCS#1v1.5)
///   2. Knowledge of (dg1_hash, sod_hash, nonce) deriving:
///      - nullifier        = Poseidon2([passport_secret, nonce])
///      - next_commitment  = Poseidon2([Poseidon2([passport_secret, nonce + 1])])
///
/// Trust model: same as base circuit (see base/src/main.nr).
///
/// Public inputs:
///   nullifier       -- stored on-chain as the primary slot key
///   next_commitment -- stored alongside the slot
///   hashed_address  -- keccak256(wallet) as a Field
///   passport_expiry -- expiry timestamp from DG1
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
    // Public inputs
    nullifier: pub Field,
    next_commitment: pub Field,
    hashed_address: pub Field,
    passport_expiry: pub Field,
) {
    // ---------------------------------------------------------------
    // 1. RSA signature verification: DSC signed the SOD's signedAttrs
    // ---------------------------------------------------------------

    let signed_attrs_hash: [u8; 32] = sha256::sha256_var(signed_attrs, signed_attrs_len);

    let pubkey_limbs = pack_be_bytes_256(pubkey);
    let redc_limbs = pack_be_bytes_257(redc_param);

    let params: BigNumParams<18, 2048> = BigNumParams::new(false, pubkey_limbs, redc_limbs);
    let sig_bignum: RuntimeBigNum<18, 2048> = RuntimeBigNum::from_be_bytes(params, signature);

    let rsa_valid = verify_sha256_pkcs1v15(signed_attrs_hash, sig_bignum, exponent);
    assert(rsa_valid, "RSA signature verification failed");

    // ---------------------------------------------------------------
    // 2. Nullifier chaining (same as Phase 3a)
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
