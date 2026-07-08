#[derive(Debug, thiserror::Error)]
pub enum CapabilityError {
    #[error("capability not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("handler error: {0}")]
    Handler(String),
}
