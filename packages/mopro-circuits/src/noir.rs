use bn254_blackbox_solver::poseidon_hash;
use noir_rs::{
    barretenberg::{
        prove::{prove_ultra_honk_keccak},
        srs::setup_srs_from_bytecode,
        verify::{
            get_ultra_honk_keccak_verification_key,
            verify_ultra_honk_keccak,
        },
    },
    witness::from_vec_str_to_witness_map,
    AcirField, FieldElement,
};

use crate::MoproError;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Computed inputs for the base-tier circuit, ready to pass to generate_noir_proof.
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct BaseInputs {
    /// Flat ordered string array for generate_noir_proof: private first, then public.
    pub inputs: Vec<String>,
    /// epoch_nullifier as decimal string (= Poseidon2([s, epoch_day])).
    /// Also sent on-chain as the rate-limiting key.
    pub epoch_nullifier: String,
}

/// Computed inputs for the primary-tier circuit.
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
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
#[cfg_attr(feature = "uniffi", uniffi::export)]
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
    setup_srs_from_bytecode(bytecode.as_str(), srs_path.as_deref(), false)
        .map_err(|e| MoproError::NoirError(format!("SRS setup failed: {e}")))?;
    get_ultra_honk_keccak_verification_key(bytecode.as_str(), false, low_memory_mode)
        .map_err(|e| MoproError::NoirError(format!("VK generation failed: {e}")))
}

/// Generate an UltraHonk-Keccak proof for a compiled Noir circuit.
///
/// `inputs` — flat ordered string array matching the circuit's private + public
///            input declaration order (private inputs first, then public).
///            Each value is a decimal field element string.
#[cfg_attr(feature = "uniffi", uniffi::export)]
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
    setup_srs_from_bytecode(bytecode.as_str(), srs_path.as_deref(), false)
        .map_err(|e| MoproError::NoirError(format!("SRS setup failed: {e}")))?;
    let witness = from_vec_str_to_witness_map(inputs.iter().map(|s| s.as_str()).collect())
        .map_err(|e| MoproError::NoirError(format!("Witness construction failed: {e}")))?;
    prove_ultra_honk_keccak(bytecode.as_str(), witness, vk, false, low_memory_mode)
        .map_err(|e| MoproError::NoirError(format!("Proof generation failed: {e}")))
}

/// Verify an UltraHonk-Keccak proof locally (optional — the contract verifies on-chain).
#[cfg_attr(feature = "uniffi", uniffi::export)]
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

/// Compute the flat witness vector for the base-tier circuit from private inputs only.
///
/// Returns `BaseInputs` containing the full ordered flat array (private then public)
/// ready to pass to `generate_noir_proof`, plus the computed `epoch_nullifier` as a
/// decimal string so the caller can store it for the on-chain call.
///
/// Input order in circuit ABI:
///   private: dg1_hash, sod_hash, epoch_day
///   public:  epoch_nullifier, hashed_address, passport_expiry
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn compute_base_inputs(
    dg1_hash: String,
    sod_hash: String,
    epoch_day: String,
    hashed_address: String,
    passport_expiry: String,
) -> Result<BaseInputs, MoproError> {
    let dg1 = parse_field(&dg1_hash)?;
    let sod = parse_field(&sod_hash)?;
    let day = parse_field(&epoch_day)?;

    let passport_secret = poseidon2([dg1, sod])?;
    let epoch_nullifier = poseidon2([passport_secret, day])?;

    let epoch_nullifier_str = field_to_decimal(epoch_nullifier);
    let inputs = vec![
        dg1_hash,
        sod_hash,
        epoch_day,
        epoch_nullifier_str.clone(),
        hashed_address,
        passport_expiry,
    ];
    Ok(BaseInputs { inputs, epoch_nullifier: epoch_nullifier_str })
}

/// Compute the flat witness vector for the primary-tier circuit from private inputs only.
///
/// Returns `PrimaryInputs` with the full ordered flat array plus `nullifier` and
/// `next_commitment` as decimal strings for on-chain use.
///
/// Input order in circuit ABI:
///   private: dg1_hash, sod_hash, nonce
///   public:  nullifier, next_commitment, hashed_address, passport_expiry
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn compute_primary_inputs(
    dg1_hash: String,
    sod_hash: String,
    nonce: String,
    hashed_address: String,
    passport_expiry: String,
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
    let inputs = vec![
        dg1_hash,
        sod_hash,
        nonce,
        nullifier_str.clone(),
        next_commitment_str.clone(),
        hashed_address,
        passport_expiry,
    ];
    Ok(PrimaryInputs {
        inputs,
        nullifier: nullifier_str,
        next_commitment: next_commitment_str,
    })
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

/// Thin wrapper around `poseidon_hash` -- fixed-length (is_variable_length = false).
fn poseidon2(inputs: impl IntoIterator<Item = FieldElement>) -> Result<FieldElement, MoproError> {
    let v: Vec<FieldElement> = inputs.into_iter().collect();
    poseidon_hash(&v, false)
        .map_err(|e| MoproError::NoirError(format!("Poseidon2 failed: {e}")))
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

    /// Base tier: generate VK, prove, verify — full round-trip with on_chain=true (Keccak).
    /// Input order matches circuit ABI: private inputs first, then public inputs.
    #[test]
    #[serial]
    fn test_base_proof_roundtrip() {
        // dg1_hash, sod_hash, epoch_day (private), epoch_nullifier, hashed_address, passport_expiry (public)
        let inputs = vec![
            "1".to_string(),
            "2".to_string(),
            "20000".to_string(),
            BASE_EPOCH_NULLIFIER.to_string(),
            "0".to_string(), // hashed_address (any value — not constrained in circuit)
            "0".to_string(), // passport_expiry (any value — not constrained in circuit)
        ];

        let vk = get_noir_verification_key(BASE_CIRCUIT.to_string(), None, true, false)
            .expect("VK generation failed");
        assert!(!vk.is_empty(), "VK should not be empty");

        let proof = generate_noir_proof(
            BASE_CIRCUIT.to_string(),
            None,
            inputs,
            true,
            vk.clone(),
            false,
        )
        .expect("Proof generation failed");
        assert!(!proof.is_empty(), "Proof should not be empty");

        let valid = verify_noir_proof(BASE_CIRCUIT.to_string(), proof, true, vk, false)
            .expect("Verification call failed");
        assert!(valid, "Base proof should be valid");
    }

    /// Primary tier: generate VK, prove, verify — full round-trip.
    /// Input order: dg1_hash, sod_hash, nonce (private), nullifier, next_commitment, hashed_address, passport_expiry (public).
    #[test]
    #[serial]
    fn test_primary_proof_roundtrip() {
        let inputs = vec![
            "1".to_string(),
            "2".to_string(),
            "1".to_string(), // nonce
            PRIMARY_NULLIFIER.to_string(),
            PRIMARY_NEXT_COMMITMENT.to_string(),
            "0".to_string(), // hashed_address
            "0".to_string(), // passport_expiry
        ];

        let vk = get_noir_verification_key(PRIMARY_CIRCUIT.to_string(), None, true, false)
            .expect("Primary VK generation failed");
        assert!(!vk.is_empty());

        let proof = generate_noir_proof(
            PRIMARY_CIRCUIT.to_string(),
            None,
            inputs,
            true,
            vk.clone(),
            false,
        )
        .expect("Primary proof generation failed");
        assert!(!proof.is_empty());

        let valid = verify_noir_proof(PRIMARY_CIRCUIT.to_string(), proof, true, vk, false)
            .expect("Primary verification failed");
        assert!(valid, "Primary proof should be valid");
    }

    /// Verify compute_base_inputs derives the correct epoch_nullifier without a proof.
    #[test]
    fn test_compute_base_inputs_values() {
        let result = compute_base_inputs(
            "1".to_string(),
            "2".to_string(),
            "20000".to_string(),
            "0".to_string(),
            "0".to_string(),
        )
        .expect("compute_base_inputs failed");

        assert_eq!(result.epoch_nullifier, BASE_EPOCH_NULLIFIER);
        assert_eq!(result.inputs[3], BASE_EPOCH_NULLIFIER); // epoch_nullifier in flat array
    }

    /// Verify compute_primary_inputs derives correct nullifier and next_commitment.
    #[test]
    fn test_compute_primary_inputs_values() {
        let result = compute_primary_inputs(
            "1".to_string(),
            "2".to_string(),
            "1".to_string(), // nonce
            "0".to_string(),
            "0".to_string(),
        )
        .expect("compute_primary_inputs failed");

        assert_eq!(result.nullifier, PRIMARY_NULLIFIER);
        assert_eq!(result.next_commitment, PRIMARY_NEXT_COMMITMENT);
        assert_eq!(result.inputs[3], PRIMARY_NULLIFIER);
        assert_eq!(result.inputs[4], PRIMARY_NEXT_COMMITMENT);
    }

    /// End-to-end: compute inputs natively then prove/verify (no hardcoded public inputs).
    #[test]
    #[serial]
    fn test_base_proof_from_computed_inputs() {
        let base = compute_base_inputs(
            "1".to_string(),
            "2".to_string(),
            "20000".to_string(),
            "0".to_string(),
            "0".to_string(),
        )
        .expect("compute_base_inputs failed");

        let vk = get_noir_verification_key(BASE_CIRCUIT.to_string(), None, true, false)
            .expect("VK generation failed");
        let proof = generate_noir_proof(
            BASE_CIRCUIT.to_string(),
            None,
            base.inputs,
            true,
            vk.clone(),
            false,
        )
        .expect("Proof generation failed");
        let valid = verify_noir_proof(BASE_CIRCUIT.to_string(), proof, true, vk, false)
            .expect("Verification call failed");
        assert!(valid);
    }
}
