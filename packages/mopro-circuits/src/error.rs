#[derive(Debug, thiserror::Error)]
#[derive(uniffi::Error)]
pub enum MoproError {
    #[error("NoirError: {0}")]
    NoirError(String),
}
