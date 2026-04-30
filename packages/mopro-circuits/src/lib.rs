mod error;
pub use error::MoproError;

mod noir;
pub use noir::{
    compute_sigil_inputs,
    generate_noir_proof, get_noir_verification_key, verify_noir_proof,
    SigilInputs,
};

#[cfg(not(target_arch = "wasm32"))]
mopro_ffi::app!();
