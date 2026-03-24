mod error;
pub use error::MoproError;

mod noir;
pub use noir::{
    compute_base_inputs, compute_primary_inputs,
    generate_noir_proof, get_noir_verification_key, verify_noir_proof,
    BaseInputs, PrimaryInputs,
};

#[cfg(not(target_arch = "wasm32"))]
mopro_ffi::app!();
