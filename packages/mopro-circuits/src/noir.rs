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

/// Computed inputs for the unified sigil circuit, ready to pass to generate_noir_proof.
#[derive(uniffi::Record)]
pub struct SigilInputs {
    /// Flat ordered string array for generate_noir_proof: private first, then public.
    pub inputs: Vec<String>,
    /// Stable per-passport nullifier as decimal string (= Poseidon2([s, 1])).
    /// Sent on-chain as the wallet's sigil identity.
    pub nullifier: String,
    /// Daily epoch nullifier as decimal string (= Poseidon2([s, epoch_day])).
    /// Sent on-chain as the rate-limiting key.
    pub epoch_nullifier: String,
}

// ---------------------------------------------------------------------------
// Public API (exported via uniffi for React Native)
// ---------------------------------------------------------------------------

/// Get the UltraHonk-Keccak verification key for a compiled Noir circuit.
///
/// `circuit_path` -- absolute path to the nargo-compiled .json artifact.
/// `srs_path`     -- optional path to the SRS file. Pass None to use the
///                   default SRS (downloaded automatically on first call).
#[uniffi::export]
pub fn get_noir_verification_key(
    circuit_path: String,
    srs_path: Option<String>,
    on_chain: bool,
    low_memory_mode: bool,
) -> Result<Vec<u8>, MoproError> {
    if !on_chain {
        return Err(MoproError::NoirError(
            "off-chain (Poseidon) proofs not supported -- use on_chain=true for EVM".into(),
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
/// `inputs` -- flat ordered string array matching the circuit's private + public
///             input declaration order (private inputs first, then public).
///             Each value is a decimal field element string.
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
            "off-chain (Poseidon) proofs not supported -- use on_chain=true for EVM".into(),
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

/// Verify an UltraHonk-Keccak proof locally (optional -- the contract verifies on-chain).
///
/// `_circuit_path` is kept in the FFI signature for ABI stability (callers in JS
/// pass it for symmetry with `generate_noir_proof`), but verification only needs
/// the proof + VK -- the bytecode is irrelevant. We deliberately do NOT read the
/// circuit JSON here, saving an unnecessary disk read + parse on every verify.
#[uniffi::export]
pub fn verify_noir_proof(
    _circuit_path: String,
    proof: Vec<u8>,
    on_chain: bool,
    vk: Vec<u8>,
    _low_memory_mode: bool,
) -> Result<bool, MoproError> {
    if !on_chain {
        return Err(MoproError::NoirError(
            "off-chain (Poseidon) proofs not supported -- use on_chain=true for EVM".into(),
        ));
    }
    verify_ultra_honk_keccak(proof, vk, false)
        .map_err(|e| MoproError::NoirError(format!("Proof verification failed: {e}")))
}

// ---------------------------------------------------------------------------
// Input pre-computation (exported via uniffi)
// ---------------------------------------------------------------------------

/// Compute the flat witness vector for the unified sigil circuit.
///
/// Returns `SigilInputs` containing the full ordered flat array (private then public)
/// ready to pass to `generate_noir_proof`, plus the computed `nullifier` and
/// `epoch_nullifier` for on-chain use.
///
/// Input order in circuit ABI:
///   private: dg1_hash, sod_hash, epoch_day,
///            signed_attrs[512], signed_attrs_len, signature[256],
///            pubkey[256], redc_param[257], exponent,
///            dsc_tbs[1536], dsc_tbs_len, dsc_pubkey_offset,
///            csca_pubkey[512], csca_redc_param[513], csca_exponent, csca_signature[512],
///            csca_merkle_siblings[9], csca_leaf_index
///   public:  nullifier, epoch_nullifier, hashed_address, csca_merkle_root
#[uniffi::export]
pub fn compute_sigil_inputs(
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
) -> Result<SigilInputs, MoproError> {
    let dg1 = parse_field(&dg1_hash)?;
    let sod = parse_field(&sod_hash)?;
    let day = parse_field(&epoch_day)?;
    let one = FieldElement::from(1u128);

    let passport_secret = poseidon2([dg1, sod])?;
    let nullifier = poseidon2([passport_secret, one])?;
    let epoch_nullifier = poseidon2([passport_secret, day])?;

    let nullifier_str = field_to_decimal(nullifier);
    let epoch_nullifier_str = field_to_decimal(epoch_nullifier);

    // Pre-size capacity to avoid Vec regrowths.
    //   3 field elements (dg1, sod, epoch_day)
    // + 512 signed_attrs + 1 len + 256 signature + 256 pubkey + 257 redc + 1 exp     = 1286
    // + 1536 dsc_tbs + 1 len + 1 offset                                               = 2824
    // + 512 csca_pubkey + 513 csca_redc + 1 csca_exp + 512 csca_signature             = 4362
    // + 9 merkle siblings + 1 leaf_index                                              = 4372
    // + 4 public inputs (nullifier, epoch_nullifier, hashed_address, csca_root)       = 4376
    const INPUT_CAPACITY: usize = 4376;
    let mut inputs: Vec<String> = Vec::with_capacity(INPUT_CAPACITY);

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
    inputs.push(nullifier_str.clone());
    inputs.push(epoch_nullifier_str.clone());
    inputs.push(hashed_address);
    inputs.push(csca_merkle_root);

    Ok(SigilInputs {
        inputs,
        nullifier: nullifier_str,
        epoch_nullifier: epoch_nullifier_str,
    })
}

/// Must match noir-bignum >= v0.9.x BARRETT_REDUCTION_OVERFLOW_BITS.
/// (v0.7.3 used 4 -- bumping noir-bignum changed this constant. Mismatched
/// values produce a redc_param the circuit will reject.)
const BARRETT_REDUCTION_OVERFLOW_BITS: u32 = 6;

/// Compute the Barrett reduction parameter for an RSA modulus.
///
/// Supports both RSA-2048 (256 bytes) and RSA-4096 (512 bytes).
///
/// `redc_param = floor(2^(2*bits + BARRETT_REDUCTION_OVERFLOW_BITS) / modulus)`
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

    let numerator = BigUint::from(1u32) << (2 * bits + BARRETT_REDUCTION_OVERFLOW_BITS);
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
/// hash function -- only the underlying `poseidon2_permutation` primitive.
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
        .ok_or_else(|| MoproError::NoirError(
            format!("No 'bytecode' field in circuit JSON at {circuit_path}"),
        ))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Expected nullifier and epoch_nullifier computed offline.
    // dg1_hash=1, sod_hash=2, epoch_day=20000
    //   nullifier       = Poseidon2([Poseidon2([1,2]), 1])
    //   epoch_nullifier = Poseidon2([Poseidon2([1,2]), 20000])
    const EXPECTED_NULLIFIER: &str =
        "275412644495263924189939344395808058143324727273800689612812660018296150956";
    const EXPECTED_EPOCH_NULLIFIER: &str =
        "10169623654123766754031260866998371876549336851110854689992825661941566564438";

    /// Verify Poseidon2 derivations match the values used in the Solidity tests.
    #[test]
    fn test_poseidon2_derivations() {
        let dg1 = FieldElement::from(1u128);
        let sod = FieldElement::from(2u128);
        let one = FieldElement::from(1u128);
        let day = FieldElement::from(20000u128);

        let s = poseidon2([dg1, sod]).unwrap();
        assert_eq!(field_to_decimal(poseidon2([s, one]).unwrap()), EXPECTED_NULLIFIER);
        assert_eq!(field_to_decimal(poseidon2([s, day]).unwrap()), EXPECTED_EPOCH_NULLIFIER);
    }

    /// Verify compute_redc_param produces 257 bytes and is non-zero.
    #[test]
    fn test_compute_redc_param() {
        let mut modulus = vec![0u8; 256];
        modulus[0] = 0x80;
        modulus[255] = 1;

        let redc = compute_redc_param(modulus).expect("compute_redc_param failed");
        assert_eq!(redc.len(), 257);
        assert!(redc.iter().any(|&b| b != 0));
    }
}
