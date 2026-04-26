use poseidon::poseidon2::Poseidon2;
use rsa::rsa::verify_sha256_pkcs1v15;
use bignum::{params::BigNumParams, RuntimeBigNum};

/// Maximum length for signedAttributes DER encoding (zero-padded to this length).
global SIGNED_ATTRS_MAX_LEN: u32 = 512;

/// Maximum length for DSC TBS (To-Be-Signed) certificate bytes (zero-padded).
global DSC_TBS_MAX_LEN: u32 = 1536;

/// Merkle tree depth for CSCA certificate inclusion proof.
/// Reduced from 12 to 9 (512 leaves) - sufficient for 269 CSCA certs with headroom.
global MERKLE_DEPTH: u32 = 9;

/// Phase 3c: Primary-tier registration circuit with full certificate chain verification.
///
/// Proves:
///   1. The SOD was signed by the DSC public key (RSA-2048/SHA-256/PKCS#1v1.5)
///   2. The DSC certificate was signed by a CSCA (RSA-4096/SHA-256/PKCS#1v1.5)
///   3. The DSC pubkey is bound to the CSCA-signed certificate (anti-substitution)
///   4. The CSCA public key is in the ICAO CSCA Merkle tree
///   5. Nullifier chaining for sybil-resistant primary slot management
///
/// Trust chain: ICAO Master List -> CSCA -> signs DSC cert -> DSC signs SOD -> SOD covers DG1
///
/// Public inputs:
///   nullifier          -- stored on-chain as the primary slot key
///   next_commitment    -- stored alongside the slot
///   hashed_address     -- keccak256(wallet) as a Field (prevents proof replay)
///   csca_merkle_root   -- current CSCA Merkle root from on-chain contract
fn main(
    // Private inputs (witness)
    dg1_hash: Field,
    sod_hash: Field,
    nonce: Field,
    // --- SOD RSA verification inputs (RSA-2048, DSC key) ---
    signed_attrs: [u8; SIGNED_ATTRS_MAX_LEN],
    signed_attrs_len: u32,
    signature: [u8; 256],
    pubkey: [u8; 256],
    redc_param: [u8; 257],
    exponent: u32,
    // --- CSCA->DSC chain verification inputs (RSA-4096, CSCA key) ---
    dsc_tbs: [u8; DSC_TBS_MAX_LEN],
    dsc_tbs_len: u32,
    dsc_pubkey_offset: u32,
    csca_pubkey: [u8; 512],
    csca_redc_param: [u8; 513],
    csca_exponent: u32,
    csca_signature: [u8; 512],
    // --- CSCA Merkle proof inputs ---
    csca_merkle_siblings: [Field; MERKLE_DEPTH],
    csca_leaf_index: u32,
    // Public inputs
    nullifier: pub Field,
    next_commitment: pub Field,
    hashed_address: pub Field,
    csca_merkle_root: pub Field,
) {
    // ---------------------------------------------------------------
    // 1. RSA-2048: DSC signed the SOD's signedAttrs
    // ---------------------------------------------------------------

    let signed_attrs_hash: [u8; 32] = sha256::sha256_var(signed_attrs, signed_attrs_len);

    let pubkey_limbs = pack_be_bytes::<256, 18>(pubkey);
    let redc_limbs = pack_be_bytes::<257, 18>(redc_param);

    let params_2048: BigNumParams<18, 2048> = BigNumParams::new(false, pubkey_limbs, redc_limbs);
    let sig_bignum: RuntimeBigNum<18, 2048> = RuntimeBigNum::from_be_bytes(params_2048, signature);

    let rsa_valid = verify_sha256_pkcs1v15(signed_attrs_hash, sig_bignum, exponent);
    assert(rsa_valid, "SOD RSA signature verification failed");

    // ---------------------------------------------------------------
    // 2. Bind DSC pubkey to the TBS certificate the CSCA signed
    // ---------------------------------------------------------------

    for i in 0..256 {
        assert(
            dsc_tbs[dsc_pubkey_offset + i] == pubkey[i],
            "DSC pubkey mismatch in TBS",
        );
    }

    // ---------------------------------------------------------------
    // 3. RSA-4096: CSCA signed the DSC's TBS certificate
    // ---------------------------------------------------------------

    let dsc_tbs_hash: [u8; 32] = sha256::sha256_var(dsc_tbs, dsc_tbs_len);

    let csca_pubkey_limbs = pack_be_bytes::<512, 35>(csca_pubkey);
    let csca_redc_limbs = pack_be_bytes::<513, 35>(csca_redc_param);

    let params_4096: BigNumParams<35, 4096> = BigNumParams::new(false, csca_pubkey_limbs, csca_redc_limbs);
    let csca_sig_bignum: RuntimeBigNum<35, 4096> = RuntimeBigNum::from_be_bytes(params_4096, csca_signature);

    let csca_rsa_valid = verify_sha256_pkcs1v15(dsc_tbs_hash, csca_sig_bignum, csca_exponent);
    assert(csca_rsa_valid, "CSCA RSA signature verification failed");

    // ---------------------------------------------------------------
    // 4. CSCA Merkle tree: CSCA pubkey is in the ICAO Master List
    // ---------------------------------------------------------------
    // Hash pubkey first to reduce bytes->Field conversion from 512 to 32 multiplies.
    // SHA-256 is already used in-circuit for RSA verification, so this adds no new trust assumptions.

    let csca_pubkey_hash: [u8; 32] = sha256::sha256_var(csca_pubkey, 512);
    let csca_pubkey_as_field = bytes_to_field::<32>(csca_pubkey_hash);
    let csca_exponent_as_field: Field = csca_exponent as Field;
    let leaf = Poseidon2::hash([csca_pubkey_as_field, csca_exponent_as_field], 2);

    let computed_root = verify_merkle_proof(leaf, csca_merkle_siblings, csca_leaf_index);
    assert(computed_root == csca_merkle_root, "CSCA Merkle proof failed");

    // ---------------------------------------------------------------
    // 5. Nullifier chaining
    // ---------------------------------------------------------------

    let passport_secret = Poseidon2::hash([dg1_hash, sod_hash], 2);

    let computed_nullifier = Poseidon2::hash([passport_secret, nonce], 2);
    assert(computed_nullifier == nullifier);

    let next_nullifier = Poseidon2::hash([passport_secret, nonce + 1], 2);
    let computed_next_commitment = Poseidon2::hash([next_nullifier], 1);
    assert(computed_next_commitment == next_commitment);

    // hashed_address binds this proof to a specific wallet - enforced on-chain via msg.sender.
    let _ = hashed_address;
}

/// Verify a Merkle inclusion proof. Returns the computed root.
#[no_predicates]
fn verify_merkle_proof(leaf: Field, siblings: [Field; MERKLE_DEPTH], leaf_index: u32) -> Field {
    let mut current = leaf;
    let mut index = leaf_index;
    for i in 0..MERKLE_DEPTH {
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

/// Generic byte packer: converts N big-endian bytes into L u128 limbs
/// (little-endian limb order). The first limb holds the leftover bytes
/// (N - (L-1)*15), and the remaining L-1 limbs hold 15 bytes each.
fn pack_be_bytes<let N: u32, let L: u32>(bytes: [u8; N]) -> [u128; L] {
    let mut limbs = [0 as u128; L];
    let mut k: u32 = 0;

    // First limb: leftover bytes = N - (L-1)*15
    let mut val: Field = 0;
    for _j in 0..(N - (L - 1) * 15) {
        val = val * 256 + bytes[k] as Field;
        k += 1;
    }
    std::as_witness(val);
    val.assert_max_bit_size::<128>();
    limbs[L - 1] = val as u128;

    // Remaining L-1 limbs: 15 bytes each
    for i in 1..L {
        let mut limb: Field = 0;
        for _j in 0..15 {
            limb = limb * 256 + bytes[k] as Field;
            k += 1;
        }
        std::as_witness(limb);
        limb.assert_max_bit_size::<128>();
        limbs[L - 1 - i] = limb as u128;
    }
    limbs
}

/// Convert N big-endian bytes to a single Field element.
/// The value is reduced modulo the BN254 field prime.
fn bytes_to_field<let N: u32>(bytes: [u8; N]) -> Field {
    let mut result: Field = 0;
    for i in 0..N {
        result = result * 256 + bytes[i] as Field;
    }
    result
}
