use chrono::NaiveDate;

use crate::error::{AppError, AppResult};

pub fn required_text(value: &str, label: &str, max: usize) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} is required.")));
    }
    if trimmed.chars().count() > max {
        return Err(AppError::Validation(format!(
            "{label} must be {max} characters or fewer."
        )));
    }
    Ok(trimmed.to_owned())
}

pub fn optional_text(value: Option<&str>, label: &str, max: usize) -> AppResult<Option<String>> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.chars().count() > max => Err(AppError::Validation(format!(
            "{label} must be {max} characters or fewer."
        ))),
        Some(value) => Ok(Some(value.to_owned())),
        None => Ok(None),
    }
}

pub fn normalize_permit_number(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .flat_map(char::to_uppercase)
        .collect()
}

pub fn vessel_registration(value: &str) -> AppResult<String> {
    let value = required_text(value, "Vessel registration number", 60)?;
    if value.starts_with('0') || !value.bytes().all(|digit| digit.is_ascii_digit()) {
        return Err(AppError::Validation(
            "Vessel registration number must contain digits only, starting with 1–9. Spaces inside the number and leading zeros are not allowed.".to_owned(),
        ));
    }
    Ok(value)
}

pub fn fishstock_code(value: &str) -> AppResult<String> {
    let code = value.trim().to_uppercase();
    if code.is_empty() || code.len() > 20 {
        return Err(AppError::Validation(
            "Fishstock code must contain between 1 and 20 characters.".to_owned(),
        ));
    }
    if !code
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '/'))
    {
        return Err(AppError::Validation(format!(
            "Fishstock code {code} contains unsupported characters."
        )));
    }
    Ok(code)
}

pub fn landing_date(value: &str) -> AppResult<String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|_| value.to_owned())
        .map_err(|_| AppError::Validation("Landing date must be a valid date.".to_owned()))
}

/// Largest logo the app will store, in bytes. The frontend downscales before
/// uploading; this is the backstop at the trust boundary.
pub const MAX_LOGO_BYTES: usize = 512 * 1024;
/// Largest logo edge in pixels. Wide enough for a crisp report header at print
/// resolution, small enough to keep every exported PDF light.
pub const MAX_LOGO_EDGE: i64 = 1200;

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/// Check that `bytes` really are a PNG of the declared size. The webview is not
/// trusted, so the dimensions it reports must agree with the image's own IHDR
/// header rather than being taken at face value.
pub fn logo_png(bytes: &[u8], width: i64, height: i64) -> AppResult<()> {
    if bytes.len() > MAX_LOGO_BYTES {
        return Err(AppError::Validation(
            "Logo image is larger than 512 KB.".to_owned(),
        ));
    }
    // Signature (8) + length (4) + "IHDR" (4) + width (4) + height (4).
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return Err(AppError::Validation(
            "Logo image must be a PNG file.".to_owned(),
        ));
    }
    if !(1..=MAX_LOGO_EDGE).contains(&width) || !(1..=MAX_LOGO_EDGE).contains(&height) {
        return Err(AppError::Validation(format!(
            "Logo image must be between 1 and {MAX_LOGO_EDGE} pixels on each edge."
        )));
    }
    let read = |offset: usize| -> i64 {
        i64::from(u32::from_be_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]))
    };
    if read(16) != width || read(20) != height {
        return Err(AppError::Validation(
            "Logo image dimensions do not match the image data.".to_owned(),
        ));
    }
    Ok(())
}
