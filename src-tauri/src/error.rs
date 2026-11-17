use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    BackupInvalid(String),
    #[error("{0}")]
    SignatureInvalid(String),
    #[error("{0}")]
    UpdateInvalid(String),
    #[error("{0}")]
    UpdateUnreachable(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("Database operation failed: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Data serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Backup package failed: {0}")]
    Zip(#[from] zip::result::ZipError),
}

impl AppError {
    /// Whether this error is a genuine fault worth recording in the sanitised
    /// diagnostics log. Expected user-flow outcomes (failed validation, missing
    /// lookups) are not recorded so the capped log stays focused on real
    /// problems.
    fn is_recordable(&self) -> bool {
        // An unreachable update server is usually just an offline computer.
        // The underlying cause is recorded where it is classified.
        !matches!(
            self,
            AppError::Validation(_) | AppError::NotFound(_) | AppError::UpdateUnreachable(_)
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        let detail = error.to_string();
        let recordable = error.is_recordable();
        let (code, message) = match error {
            AppError::Validation(message) => ("VALIDATION_ERROR", message),
            AppError::NotFound(message) => ("NOT_FOUND", message),
            AppError::Conflict(message) => ("CONFLICT", message),
            AppError::BackupInvalid(message) => ("BACKUP_INVALID", message),
            AppError::SignatureInvalid(message) => ("SIGNATURE_INVALID", message),
            AppError::UpdateInvalid(message) => ("UPDATE_INVALID", message),
            AppError::UpdateUnreachable(message) => ("UPDATE_UNREACHABLE", message),
            AppError::Io(_) => (
                "IO_ERROR",
                "The requested file operation could not be completed.".to_owned(),
            ),
            AppError::Database(_) => (
                "DATABASE_ERROR",
                "The local database operation could not be completed.".to_owned(),
            ),
            AppError::Serialization(_) | AppError::Zip(_) => (
                "DATA_ERROR",
                "myLFR couldn't process this information.".to_owned(),
            ),
        };

        // Record genuine faults for the sanitised diagnostics export.
        if recordable {
            crate::diagnostics::record_error(code, &detail);
        }

        Self { code, message }
    }
}

pub type AppResult<T> = Result<T, AppError>;
pub type CommandResult<T> = Result<T, CommandError>;
