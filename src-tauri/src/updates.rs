//! Deciding when an application update check is due, and recording that one
//! happened.
//!
//! Split from the Tauri command layer so the decision can be tested against a
//! database connection rather than through `State`, and so that asking whether
//! a check is due never writes anything. Recording is a separate call the
//! caller makes only once the check has actually returned a result.

use chrono::{DateTime, Datelike, Local, NaiveDate, Utc};
use rusqlite::Connection;
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::reminder::{is_update_reminder_due, local_date_of, reminder_date};

/// How long a completed check suppresses the next one.
pub const CHECK_INTERVAL_HOURS: i64 = 24;

/// Whether an update check is due at `now`. Reads only.
///
/// A missing, unparseable, or future timestamp counts as due: an update check
/// is cheap, and refusing one because stored state cannot be trusted would
/// leave the user with no way to check at all.
pub fn is_app_update_check_due(connection: &Connection, now: DateTime<Utc>) -> AppResult<bool> {
    let last_check: Option<String> = connection.query_row(
        "SELECT last_app_update_check FROM app_settings WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    Ok(check_is_due(last_check.as_deref(), now))
}

fn check_is_due(last_check: Option<&str>, now: DateTime<Utc>) -> bool {
    last_check
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .is_none_or(|value| {
            let checked_at = value.with_timezone(&Utc);
            checked_at > now
                || now.signed_duration_since(checked_at).num_hours() >= CHECK_INTERVAL_HOURS
        })
}

/// Records that a check reached the update server and returned a result.
///
/// Call this only after the check has succeeded. A check that failed to reach
/// the server must leave the stored timestamp untouched, so a user who was
/// offline can retry immediately rather than losing their 24-hour window to an
/// attempt that never happened.
pub fn record_app_update_check(connection: &Connection, at: DateTime<Utc>) -> AppResult<()> {
    connection.execute(
        "UPDATE app_settings SET last_app_update_check = ?1 WHERE id = 1",
        [at.to_rfc3339()],
    )?;
    Ok(())
}

/// How update checks are triggered. Manual is the default: the application
/// contacts the update server only when asked, and reminds the user monthly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateMode {
    Manual,
    Automatic,
}

impl UpdateMode {
    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "manual" => Ok(Self::Manual),
            "automatic" => Ok(Self::Automatic),
            _ => Err(AppError::Validation(
                "Choose manual or automatic update checks.".to_owned(),
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Automatic => "automatic",
        }
    }
}

/// What the interface should offer about updates right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub mode: &'static str,
    /// Show the reminder bar: manual mode, the reminder cycle has started, no
    /// check has succeeded in it, and the user has not set it aside.
    pub reminder_due: bool,
    /// Keep the Settings marker: as `reminder_due`, but still true after the
    /// user set the bar aside, so a reminder answered out of habit can be found.
    pub reminder_pending: bool,
    /// Automatic mode, and no check has succeeded in the last 24 hours.
    pub automatic_check_due: bool,
    pub last_successful_check: Option<String>,
}

/// Decide the update status from stored state. Pure, so every case can be
/// tested without a clock or a database.
pub fn update_status(
    now: DateTime<Utc>,
    today: NaiveDate,
    mode: UpdateMode,
    last_successful_check: Option<&str>,
    reminder_dismissed_at: Option<&str>,
) -> UpdateStatus {
    let manual = mode == UpdateMode::Manual;
    let reminder_pending =
        manual && is_update_reminder_due(today, local_date_of(last_successful_check));
    let dismissed_this_cycle = reminder_date(today.year(), today.month())
        .zip(local_date_of(reminder_dismissed_at))
        .is_some_and(|(cycle_start, dismissed)| dismissed >= cycle_start);
    UpdateStatus {
        mode: mode.as_str(),
        reminder_due: reminder_pending && !dismissed_this_cycle,
        reminder_pending,
        automatic_check_due: mode == UpdateMode::Automatic
            && check_is_due(last_successful_check, now),
        last_successful_check: last_successful_check.map(str::to_owned),
    }
}

pub fn read_update_status(connection: &Connection, now: DateTime<Utc>) -> AppResult<UpdateStatus> {
    let (mode, last_check, dismissed): (String, Option<String>, Option<String>) = connection
        .query_row(
            "SELECT app_update_mode, last_app_update_check, update_reminder_dismissed_at
             FROM app_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    Ok(update_status(
        now,
        now.with_timezone(&Local).date_naive(),
        UpdateMode::parse(&mode)?,
        last_check.as_deref(),
        dismissed.as_deref(),
    ))
}

pub fn set_update_mode(connection: &Connection, mode: UpdateMode) -> AppResult<()> {
    connection.execute(
        "UPDATE app_settings SET app_update_mode = ?1 WHERE id = 1",
        [mode.as_str()],
    )?;
    Ok(())
}

/// Set the reminder aside for the current cycle. It returns next month.
pub fn dismiss_update_reminder(connection: &Connection, at: DateTime<Utc>) -> AppResult<()> {
    connection.execute(
        "UPDATE app_settings SET update_reminder_dismissed_at = ?1 WHERE id = 1",
        [at.to_rfc3339()],
    )?;
    Ok(())
}

/// What a build requires of a downloaded Windows update beyond its Tauri
/// updater signature, which the updater verifies before installing anything.
#[derive(Debug, PartialEq, Eq)]
pub enum WindowsUpdatePublisher {
    /// Signed builds accept only installers Authenticode-signed by this
    /// certificate thumbprint.
    Pinned(String),
    /// Unsigned public releases opt out explicitly at build time.
    NotRequired,
}

/// Decide the Windows publisher rule from the build-time settings. A valid
/// pinned thumbprint always wins. A build with neither a thumbprint nor the
/// explicit unsigned-release opt-out (`"1"`), such as a local development
/// build, refuses updates rather than silently skipping the check.
pub fn windows_update_publisher(
    pinned_thumbprint: Option<&str>,
    unsigned_release: Option<&str>,
) -> AppResult<WindowsUpdatePublisher> {
    let pinned = pinned_thumbprint
        .map(|value| {
            value
                .chars()
                .filter(|character| !character.is_whitespace())
                .collect::<String>()
        })
        .filter(|value| {
            value.len() == 40 && value.chars().all(|character| character.is_ascii_hexdigit())
        });
    match (pinned, unsigned_release) {
        (Some(thumbprint), _) => Ok(WindowsUpdatePublisher::Pinned(thumbprint)),
        (None, Some("1")) => Ok(WindowsUpdatePublisher::NotRequired),
        (None, _) => Err(AppError::UpdateInvalid(
            "This build has no pinned Windows update publisher identity.".to_owned(),
        )),
    }
}

#[cfg(test)]
mod windows_update_publisher_tests {
    use super::{WindowsUpdatePublisher, windows_update_publisher};

    const THUMBPRINT: &str = "4A64D92E4FE40341E60A19720CBFFD1E5DA7ADB4";

    #[test]
    fn a_pinned_thumbprint_is_required_even_when_the_unsigned_flag_is_set() {
        assert_eq!(
            windows_update_publisher(Some(THUMBPRINT), Some("1")).unwrap(),
            WindowsUpdatePublisher::Pinned(THUMBPRINT.to_owned())
        );
        assert_eq!(
            windows_update_publisher(Some(" 4A64D92E4FE40341E60A19720CBFFD1E5DA7ADB4 "), None)
                .unwrap(),
            WindowsUpdatePublisher::Pinned(THUMBPRINT.to_owned())
        );
    }

    #[test]
    fn only_the_explicit_unsigned_release_flag_skips_authenticode() {
        assert_eq!(
            windows_update_publisher(None, Some("1")).unwrap(),
            WindowsUpdatePublisher::NotRequired
        );
        assert_eq!(
            windows_update_publisher(Some(""), Some("1")).unwrap(),
            WindowsUpdatePublisher::NotRequired
        );
    }

    #[test]
    fn builds_without_a_publisher_rule_refuse_updates() {
        for (thumbprint, unsigned) in [
            (None, None),
            (Some(""), None),
            (Some("not-a-thumbprint"), None),
            (None, Some("0")),
            (None, Some("true")),
            (Some("ABC"), Some("")),
        ] {
            assert!(windows_update_publisher(thumbprint, unsigned).is_err());
        }
    }
}
