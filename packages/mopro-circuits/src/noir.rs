use bn254_blackbox_solver::poseidon2_permutation;
use noir_rs::{
    barretenberg::{
        prove::{prove_ultra_honk_keccak},
        srs::setup_srs,
        utils::get_subgroup_size,
        verify::{
            get_ultra_honk_keccak_verification_key,
            verify_ultra_honk_keccak,
        },
    },
    witness::from_vec_str_to_witness_map,
    AcirField, FieldElement,
};
use num_bigint::BigUint;

use crate::MoproError;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Computed inputs for the base-tier circuit, ready to pass to generate_noir_proof.
#[derive(uniffi::Record)]
pub struct BaseInputs {
    /// Flat ordered string array for generate_noir_proof: private first, then public.
    pub inputs: Vec<String>,
    /// epoch_nullifier as decimal string (= Poseidon2([s, epoch_day])).
    /// Also sent on-chain as the rate-limiting key.
    pub epoch_nullifier: String,
}

/// Computed inputs for the primary-tier circuit.
#[derive(uniffi::Record)]
pub struct PrimaryInputs {
    /// Flat ordered string array for generate_noir_proof.
    pub inputs: Vec<String>,
    /// nullifier as decimal string (= Poseidon2([s, nonce])).
    pub nullifier: String,
    /// next_commitment as decimal string (= Poseidon2([Poseidon2([s, nonce+1])])).
    pub next_commitment: String,
}

// ---------------------------------------------------------------------------
// Public API (exported via uniffi for React Native)
// ---------------------------------------------------------------------------

/// Get the UltraHonk-Keccak verification key for a compiled Noir circuit.
///
/// `circuit_path` — absolute path to the nargo-compiled .json artifact.
/// `srs_path`     — optional path to the SRS file. Pass None to use the
///                  default SRS (downloaded automatically on first call).
#[uniffi::export]
pub fn get_noir_verification_key(
    circuit_path: String,
    srs_path: Option<String>,
    on_chain: bool,
    low_memory_mode: bool,
) -> Result<Vec<u8>, MoproError> {
    if !on_chain {
        return Err(MoproError::NoirError(
            "off-chain (Poseidon) proofs not supported — use on_chain=true for EVM".into(),
        ));
    }
    let bytecode = read_bytecode(&circuit_path)?;
    // Use the dyadic subgroup size directly (matches `srs_downloader -c circuit.json`).
    // setup_srs_from_bytecode applies an 8x multiplier that exceeds what the
    // downloaded SRS file holds, so call setup_srs with the unscaled subgroup size.
    let subgroup = get_subgroup_size(bytecode.as_str(), false);
    setup_srs(subgroup, srs_path.as_deref())
        .map_err(|e| MoproError::NoirError(format!("SRS setup failed: {e}")))?;
    get_ultra_honk_keccak_verification_key(bytecode.as_str(), false, low_memory_mode)
        .map_err(|e| MoproError::NoirError(format!("VK generation failed: {e}")))
}

/// Generate an UltraHonk-Keccak proof for a compiled Noir circuit.
///
/// `inputs` — flat ordered string array matching the circuit's private + public
///            input declaration order (private inputs first, then public).
///            Each value is a decimal field element string.
#[uniffi::export]
pub fn generate_noir_proof(
    circuit_path: String,
    srs_path: Option<String>,
    inputs: Vec<String>,
    on_chain: bool,
    vk: Vec<u8>,
    low_memory_mode: bool,
) -> Result<Vec<u8>, MoproError> {
    if !on_chain {
        return Err(MoproError::NoirError(
            "off-chain (Poseidon) proofs not supported — use on_chain=true for EVM".into(),
        ));
    }
    let bytecode = read_bytecode(&circuit_path)?;
    let subgroup = get_subgroup_size(bytecode.as_str(), false);
    setup_srs(subgroup, srs_path.as_deref())
        .map_err(|e| MoproError::NoirError(format!("SRS setup failed: {e}")))?;
    let witness = from_vec_str_to_witness_map(inputs.iter().map(|s| s.as_str()).collect())
        .map_err(|e| MoproError::NoirError(format!("Witness construction failed: {e:?}")))?;
    prove_ultra_honk_keccak(bytecode.as_str(), witness, vk, false, low_memory_mode)
        .map_err(|e| MoproError::NoirError(format!("Proof generation failed: {e:?}")))
}

/// Verify an UltraHonk-Keccak proof locally (optional — the contract verifies on-chain).
#[uniffi::export]
pub fn verify_noir_proof(
    circuit_path: String,
    proof: Vec<u8>,
    on_chain: bool,
    vk: Vec<u8>,
    _low_memory_mode: bool,
) -> Result<bool, MoproError> {
    if !on_chain {
        return Err(MoproError::NoirError(
            "off-chain (Poseidon) proofs not supported — use on_chain=true for EVM".into(),
        ));
    }
    let _bytecode = read_bytecode(&circuit_path)?;
    verify_ultra_honk_keccak(proof, vk, false)
        .map_err(|e| MoproError::NoirError(format!("Proof verification failed: {e}")))
}

// ---------------------------------------------------------------------------
// Input pre-computation helpers (exported via uniffi)
// ---------------------------------------------------------------------------

/// Compute the flat witness vector for the base-tier circuit.
///
/// Returns `BaseInputs` containing the full ordered flat array (private then public)
/// ready to pass to `generate_noir_proof`, plus the computed `epoch_nullifier`.
///
/// Input order in circuit ABI:
///   private: dg1_hash, sod_hash, epoch_day,
///            signed_attrs[512], signed_attrs_len, signature[256],
///            pubkey[256], redc_param[257], exponent,
///            dsc_tbs[1536], dsc_tbs_len, dsc_pubkey_offset,
///            csca_pubkey[512], csca_redc_param[513], csca_exponent, csca_signature[512],
///            csca_merkle_siblings[9], csca_leaf_index
///   public:  epoch_nullifier, hashed_address, csca_merkle_root
#[uniffi::export]
pub fn compute_base_inputs(
    dg1_hash: String,
    sod_hash: String,
    epoch_day: String,
    signed_attrs: Vec<u8>,
    signed_attrs_len: u32,
    signature: Vec<u8>,
    pubkey: Vec<u8>,
    redc_param: Vec<u8>,
    exponent: u32,
    dsc_tbs: Vec<u8>,
    dsc_tbs_len: u32,
    dsc_pubkey_offset: u32,
    csca_pubkey: Vec<u8>,
    csca_redc_param: Vec<u8>,
    csca_exponent: u32,
    csca_signature: Vec<u8>,
    csca_merkle_siblings: Vec<String>,
    csca_leaf_index: u32,
    hashed_address: String,
    csca_merkle_root: String,
) -> Result<BaseInputs, MoproError> {
    let dg1 = parse_field(&dg1_hash)?;
    let sod = parse_field(&sod_hash)?;
    let day = parse_field(&epoch_day)?;

    let passport_secret = poseidon2([dg1, sod])?;
    let epoch_nullifier = poseidon2([passport_secret, day])?;

    let epoch_nullifier_str = field_to_decimal(epoch_nullifier);

    let mut inputs = Vec::new();

    // Private field elements
    inputs.push(dg1_hash);
    inputs.push(sod_hash);
    inputs.push(epoch_day);

    // SOD RSA-2048 verification inputs
    for &b in &signed_attrs { inputs.push(b.to_string()); }
    inputs.push(signed_attrs_len.to_string());
    for &b in &signature { inputs.push(b.to_string()); }
    for &b in &pubkey { inputs.push(b.to_string()); }
    for &b in &redc_param { inputs.push(b.to_string()); }
    inputs.push(exponent.to_string());

    // CSCA->DSC chain verification inputs (RSA-4096)
    for &b in &dsc_tbs { inputs.push(b.to_string()); }
    inputs.push(dsc_tbs_len.to_string());
    inputs.push(dsc_pubkey_offset.to_string());
    for &b in &csca_pubkey { inputs.push(b.to_string()); }
    for &b in &csca_redc_param { inputs.push(b.to_string()); }
    inputs.push(csca_exponent.to_string());
    for &b in &csca_signature { inputs.push(b.to_string()); }

    // CSCA Merkle proof (9 siblings + leaf index)
    for sibling in &csca_merkle_siblings { inputs.push(sibling.clone()); }
    inputs.push(csca_leaf_index.to_string());

    // Public inputs
    inputs.push(epoch_nullifier_str.clone());
    inputs.push(hashed_address);
    inputs.push(csca_merkle_root);

    Ok(BaseInputs { inputs, epoch_nullifier: epoch_nullifier_str })
}

/// Compute the flat witness vector for the primary-tier circuit.
///
/// Returns `PrimaryInputs` with the full ordered flat array plus `nullifier` and
/// `next_commitment` as decimal strings for on-chain use.
///
/// Input order in circuit ABI:
///   private: dg1_hash, sod_hash, nonce,
///            signed_attrs[512], signed_attrs_len, signature[256],
///            pubkey[256], redc_param[257], exponent,
///            dsc_tbs[1536], dsc_tbs_len, dsc_pubkey_offset,
///            csca_pubkey[512], csca_redc_param[513], csca_exponent, csca_signature[512],
///            csca_merkle_siblings[9], csca_leaf_index
///   public:  nullifier, next_commitment, hashed_address, csca_merkle_root
#[uniffi::export]
pub fn compute_primary_inputs(
    dg1_hash: String,
    sod_hash: String,
    nonce: String,
    signed_attrs: Vec<u8>,
    signed_attrs_len: u32,
    signature: Vec<u8>,
    pubkey: Vec<u8>,
    redc_param: Vec<u8>,
    exponent: u32,
    dsc_tbs: Vec<u8>,
    dsc_tbs_len: u32,
    dsc_pubkey_offset: u32,
    csca_pubkey: Vec<u8>,
    csca_redc_param: Vec<u8>,
    csca_exponent: u32,
    csca_signature: Vec<u8>,
    csca_merkle_siblings: Vec<String>,
    csca_leaf_index: u32,
    hashed_address: String,
    csca_merkle_root: String,
) -> Result<PrimaryInputs, MoproError> {
    let dg1 = parse_field(&dg1_hash)?;
    let sod = parse_field(&sod_hash)?;
    let n = parse_field(&nonce)?;

    let passport_secret = poseidon2([dg1, sod])?;
    let nullifier = poseidon2([passport_secret, n])?;

    // next_nullifier = Poseidon2([s, nonce + 1])
    // next_commitment = Poseidon2([next_nullifier]) -- hashed one extra time
    let one = FieldElement::from(1u128);
    let n_plus_1 = n + one;
    let next_nullifier = poseidon2([passport_secret, n_plus_1])?;
    let next_commitment = poseidon2([next_nullifier])?;

    let nullifier_str = field_to_decimal(nullifier);
    let next_commitment_str = field_to_decimal(next_commitment);

    let mut inputs = Vec::new();

    // Private field elements
    inputs.push(dg1_hash);
    inputs.push(sod_hash);
    inputs.push(nonce);

    // SOD RSA-2048 verification inputs
    for &b in &signed_attrs { inputs.push(b.to_string()); }
    inputs.push(signed_attrs_len.to_string());
    for &b in &signature { inputs.push(b.to_string()); }
    for &b in &pubkey { inputs.push(b.to_string()); }
    for &b in &redc_param { inputs.push(b.to_string()); }
    inputs.push(exponent.to_string());

    // CSCA->DSC chain verification inputs (RSA-4096)
    for &b in &dsc_tbs { inputs.push(b.to_string()); }
    inputs.push(dsc_tbs_len.to_string());
    inputs.push(dsc_pubkey_offset.to_string());
    for &b in &csca_pubkey { inputs.push(b.to_string()); }
    for &b in &csca_redc_param { inputs.push(b.to_string()); }
    inputs.push(csca_exponent.to_string());
    for &b in &csca_signature { inputs.push(b.to_string()); }

    // CSCA Merkle proof (9 siblings + leaf index)
    for sibling in &csca_merkle_siblings { inputs.push(sibling.clone()); }
    inputs.push(csca_leaf_index.to_string());

    // Public inputs
    inputs.push(nullifier_str.clone());
    inputs.push(next_commitment_str.clone());
    inputs.push(hashed_address);
    inputs.push(csca_merkle_root);

    Ok(PrimaryInputs {
        inputs,
        nullifier: nullifier_str,
        next_commitment: next_commitment_str,
    })
}

/// Compute just the nullifier for a given nonce (used for nonce recovery).
///
/// nullifier = Poseidon2([Poseidon2([dg1_hash, sod_hash]), nonce])
///
/// This avoids requiring RSA fields when we only need the nullifier.
#[uniffi::export]
pub fn compute_nullifier(
    dg1_hash: String,
    sod_hash: String,
    nonce: String,
) -> Result<String, MoproError> {
    let dg1 = parse_field(&dg1_hash)?;
    let sod = parse_field(&sod_hash)?;
    let n = parse_field(&nonce)?;

    let passport_secret = poseidon2([dg1, sod])?;
    let nullifier = poseidon2([passport_secret, n])?;
    Ok(field_to_decimal(nullifier))
}

/// Compute the Barrett reduction parameter for an RSA modulus.
///
/// Supports both RSA-2048 (256 bytes) and RSA-4096 (512 bytes).
///
/// `redc_param = floor(2^(2*bits + BARRETT_REDUCTION_OVERFLOW_BITS) / modulus)`
///
/// `BARRETT_REDUCTION_OVERFLOW_BITS = 6` matches noir-bignum >= v0.9.x.
/// (v0.7.3 used 4 — bumping noir-bignum changed this constant.)
///
/// Returns N+1 bytes (big-endian): 257 bytes for 2048-bit, 513 bytes for 4096-bit.
#[uniffi::export]
pub fn compute_redc_param(modulus_bytes: Vec<u8>) -> Result<Vec<u8>, MoproError> {
    let (bits, out_len) = match modulus_bytes.len() {
        256 => (2048u32, 257usize),
        512 => (4096u32, 513usize),
        n => return Err(MoproError::NoirError(format!(
            "Expected 256-byte (RSA-2048) or 512-byte (RSA-4096) modulus, got {n} bytes",
        ))),
    };

    let modulus = BigUint::from_bytes_be(&modulus_bytes);
    if modulus.bits() == 0 {
        return Err(MoproError::NoirError("Modulus is zero".into()));
    }

    let numerator = BigUint::from(1u32) << (2 * bits + 6);
    let redc = &numerator / &modulus;

    let bytes = redc.to_bytes_be();
    if bytes.len() > out_len {
        return Err(MoproError::NoirError(format!(
            "redc_param is {} bytes, expected <= {out_len}",
            bytes.len()
        )));
    }

    let mut result = vec![0u8; out_len];
    let offset = out_len - bytes.len();
    result[offset..].copy_from_slice(&bytes);
    Ok(result)
}

// ---------------------------------------------------------------------------
// Internal Poseidon2 helpers
// ---------------------------------------------------------------------------

fn parse_field(s: &str) -> Result<FieldElement, MoproError> {
    FieldElement::try_from_str(s)
        .ok_or_else(|| MoproError::NoirError(format!("Invalid field element: {s}")))
}

fn field_to_decimal(f: FieldElement) -> String {
    let bytes = f.to_be_bytes(); // big-endian byte representation
    bytes_to_decimal(&bytes)
}

fn bytes_to_decimal(bytes: &[u8]) -> String {
    // Big-endian byte array to decimal string via repeated division.
    // We represent the number as a Vec<u32> (base 10^9 limbs, little-endian).
    let mut limbs: Vec<u64> = vec![0];
    for &byte in bytes {
        // limbs = limbs * 256 + byte
        let mut carry = byte as u64;
        for limb in limbs.iter_mut() {
            let val = *limb * 256 + carry;
            *limb = val % 1_000_000_000;
            carry = val / 1_000_000_000;
        }
        while carry > 0 {
            limbs.push(carry % 1_000_000_000);
            carry /= 1_000_000_000;
        }
    }
    // Build decimal string (most significant limb first)
    let mut result = String::new();
    for (i, &limb) in limbs.iter().rev().enumerate() {
        if i == 0 {
            result.push_str(&limb.to_string());
        } else {
            result.push_str(&format!("{:09}", limb));
        }
    }
    if result.is_empty() { "0".to_string() } else { result }
}

/// Fixed-length Poseidon2 sponge hash matching Noir stdlib's `Poseidon2::hash(inputs, len)`.
/// Reimplemented locally since beta.19's bn254_blackbox_solver no longer exposes a high-level
/// hash function — only the underlying `poseidon2_permutation` primitive.
fn poseidon2(inputs: impl IntoIterator<Item = FieldElement>) -> Result<FieldElement, MoproError> {
    let v: Vec<FieldElement> = inputs.into_iter().collect();
    poseidon2_hash(&v)
}

fn poseidon2_hash(inputs: &[FieldElement]) -> Result<FieldElement, MoproError> {
    const RATE: usize = 3;
    let two_pow_64 = FieldElement::from(1u128 << 64);
    let iv = FieldElement::from(inputs.len() as u128) * two_pow_64;

    let mut state: Vec<FieldElement> = vec![FieldElement::zero(); RATE + 1];
    state[RATE] = iv;
    let mut cache: Vec<FieldElement> = Vec::with_capacity(RATE);

    let permute = |state: &mut Vec<FieldElement>| -> Result<(), MoproError> {
        let next = poseidon2_permutation(state)
            .map_err(|e| MoproError::NoirError(format!("Poseidon2 failed: {e}")))?;
        *state = next;
        Ok(())
    };

    for &input in inputs {
        if cache.len() == RATE {
            for i in 0..RATE {
                state[i] = state[i] + cache[i];
            }
            permute(&mut state)?;
            cache.clear();
        }
        cache.push(input);
    }

    // squeeze: zero-pad cache, absorb, permute, output state[0]
    while cache.len() < RATE {
        cache.push(FieldElement::zero());
    }
    for i in 0..RATE {
        state[i] = state[i] + cache[i];
    }
    permute(&mut state)?;
    Ok(state[0])
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

fn read_bytecode(circuit_path: &str) -> Result<String, MoproError> {
    let json_str = std::fs::read_to_string(circuit_path)
        .map_err(|e| MoproError::NoirError(format!("Failed to read circuit at {circuit_path}: {e}")))?;
    let circuit: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| MoproError::NoirError(format!("Failed to parse circuit JSON: {e}")))?;
    circuit["bytecode"]
        .as_str()
        .map(|s: &str| s.to_string())
        .ok_or_else(|| MoproError::NoirError("No 'bytecode' field in circuit JSON".into()))
}

// ---------------------------------------------------------------------------
// Tests — run with: cargo test (requires test-vectors/ to be populated)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    const BASE_CIRCUIT: &str = "./test-vectors/noir/passport_base.json";
    const PRIMARY_CIRCUIT: &str = "./test-vectors/noir/passport_primary.json";

    // Expected public input values computed offline via helper Noir circuits.
    // Base: dg1_hash=1, sod_hash=2, epoch_day=20000
    //   epoch_nullifier = Poseidon2([Poseidon2([1,2]), 20000])
    const BASE_EPOCH_NULLIFIER: &str =
        "10169623654123766754031260866998371876549336851110854689992825661941566564438";

    // Primary: dg1_hash=1, sod_hash=2, nonce=1
    //   nullifier        = Poseidon2([Poseidon2([1,2]), 1])
    //   next_commitment  = Poseidon2([Poseidon2([Poseidon2([1,2]), 2])])
    const PRIMARY_NULLIFIER: &str =
        "275412644495263924189939344395808058143324727273800689612812660018296150956";
    const PRIMARY_NEXT_COMMITMENT: &str =
        "19202002815431368995739791825713219422746529042231652773447201800946151423106";

    // NOTE: Proof round-trip tests (test_base_proof_roundtrip, test_primary_proof_roundtrip)
    // are commented out until test-vectors/ are updated with Phase 3b circuit artifacts
    // that include RSA verification inputs. The old 6-7 input format no longer matches
    // the circuit ABI.

    /// Verify compute_nullifier derives the correct value.
    #[test]
    fn test_compute_nullifier_values() {
        let nullifier = compute_nullifier(
            "1".to_string(),
            "2".to_string(),
            "1".to_string(),
        )
        .expect("compute_nullifier failed");

        assert_eq!(nullifier, PRIMARY_NULLIFIER);
    }

    /// Verify compute_redc_param produces 257 bytes and is non-zero.
    #[test]
    fn test_compute_redc_param() {
        // A simple 256-byte modulus (just a big number with high bit set)
        let mut modulus = vec![0u8; 256];
        modulus[0] = 0x80; // Set high bit
        modulus[255] = 1;  // Make it odd

        let redc = compute_redc_param(modulus).expect("compute_redc_param failed");
        assert_eq!(redc.len(), 257);
        // The result should be non-zero
        assert!(redc.iter().any(|&b| b != 0));
    }

    // NOTE: test_base_proof_from_computed_inputs removed — needs Phase 3b circuit artifacts.
}
