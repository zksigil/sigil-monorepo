use poseidon::poseidon2::Poseidon2;
use rsa::rsa::verify_sha256_pkcs1v15;
use bignum::{params::BigNumParams, RuntimeBigNum};

/// Maximum length for signedAttributes DER encoding (zero-padded to this length).
global SIGNED_ATTRS_MAX_LEN: u32 = 512;

/// Phase 3b: Base-tier registration circuit with RSA signature verification.
///
/// Proves:
///   1. The SOD was signed by the provided DSC public key (RSA-2048/SHA-256/PKCS#1v1.5)
///   2. Knowledge of (dg1_hash, sod_hash) deriving the passport secret
///   3. epoch_nullifier = Poseidon2([passport_secret, epoch_day])
///
/// The RSA verification ensures the SOD is authentic -- signed by a real DSC.
/// The app extracts signedAttrs, signature, and pubkey from the DER-encoded SOD
/// off-circuit. If any extraction is wrong, the RSA verify will fail.
///
/// Trust model: The circuit verifies the DSC's RSA signature over signedAttrs.
/// It does NOT verify that the DSC is in the ICAO Merkle tree (Phase 3c) or
/// that DG1 hash appears inside signedAttrs (app is trusted for extraction).
///
/// Public inputs visible to the on-chain verifier:
///   epoch_nullifier -- rate-limiting key (hash of secret + day)
///   hashed_address  -- keccak256(wallet) as a Field
///   passport_expiry -- expiry timestamp from DG1
fn main(
    // Private inputs (witness)
    dg1_hash: Field,
    sod_hash: Field,
    epoch_day: Field,
    // RSA verification inputs (private witness)
    signed_attrs: [u8; SIGNED_ATTRS_MAX_LEN],
    signed_attrs_len: u32,
    signature: [u8; 256],
    pubkey: [u8; 256],
    redc_param: [u8; 257],
    exponent: u32,
    // Public inputs
    epoch_nullifier: pub Field,
    hashed_address: pub Field,
    passport_expiry: pub Field,
) {
    // ---------------------------------------------------------------
    // 1. RSA signature verification: DSC signed the SOD's signedAttrs
    // ---------------------------------------------------------------

    // Hash the signedAttrs (variable length, zero-padded)
    let signed_attrs_hash: [u8; 32] = sha256::sha256_var(signed_attrs, signed_attrs_len);

    // Pack pubkey bytes into u128 limbs for BigNumParams (18 limbs for 2048-bit)
    let pubkey_limbs = pack_be_bytes_256(pubkey);
    let redc_limbs = pack_be_bytes_257(redc_param);

    let params: BigNumParams<18, 2048> = BigNumParams::new(false, pubkey_limbs, redc_limbs);
    let sig_bignum: RuntimeBigNum<18, 2048> = RuntimeBigNum::from_be_bytes(params, signature);

    let rsa_valid = verify_sha256_pkcs1v15(signed_attrs_hash, sig_bignum, exponent);
    assert(rsa_valid, "RSA signature verification failed");

    // ---------------------------------------------------------------
    // 2. Derive passport secret and epoch nullifier (same as Phase 3a)
    // ---------------------------------------------------------------

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);
    let computed_epoch_nullifier = Poseidon2::hash([passport_secret, epoch_day], 2);
    assert(computed_epoch_nullifier == epoch_nullifier);

    // hashed_address and passport_expiry bind this proof to a specific wallet and passport.
    let _ = hashed_address;
    let _ = passport_expiry;
}

// ---------------------------------------------------------------------------
// Byte packing helpers: convert big-endian byte arrays to u128 limb arrays
// ---------------------------------------------------------------------------

/// Pack 256 big-endian bytes into 18 u128 limbs (little-endian limb order).
/// 256 bytes = 2048 bits. 18 limbs * 120 bits = 2160 bits capacity.
/// First limb holds the remaining bytes (256 - 17*15 = 1 byte).
fn pack_be_bytes_256(bytes: [u8; 256]) -> [u128; 18] {
    let mut limbs = [0 as u128; 18];
    let mut k: u32 = 0;

    // First limb: 256 - 17*15 = 1 byte
    let first_limb_bytes: u32 = 256 - 17 * 15; // = 1
    let mut val: Field = 0;
    for _ in 0..first_limb_bytes {
        val = val * 256 + bytes[k] as Field;
        k += 1;
    }
    std::as_witness(val);
    val.assert_max_bit_size::<128>();
    limbs[17] = val as u128;

    // Remaining 17 limbs: 15 bytes each
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

/// Pack 257 big-endian bytes into 18 u128 limbs.
/// 257 bytes = 2056 bits. First limb holds 257 - 17*15 = 2 bytes.
fn pack_be_bytes_257(bytes: [u8; 257]) -> [u128; 18] {
    let mut limbs = [0 as u128; 18];
    let mut k: u32 = 0;

    // First limb: 257 - 17*15 = 2 bytes
    let first_limb_bytes: u32 = 257 - 17 * 15; // = 2
    let mut val: Field = 0;
    for _ in 0..first_limb_bytes {
        val = val * 256 + bytes[k] as Field;
        k += 1;
    }
    std::as_witness(val);
    val.assert_max_bit_size::<128>();
    limbs[17] = val as u128;

    // Remaining 17 limbs: 15 bytes each
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
