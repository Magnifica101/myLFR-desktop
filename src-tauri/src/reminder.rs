//! When the manual update reminder is due.
//!
//! Kept as pure date arithmetic, separate from the command layer, so every
//! calendar edge case can be tested directly. The current date is an argument
//! rather than a call to the clock for the same reason.

use chrono::{DateTime, Datelike, Days, Local, NaiveDate, Weekday};

/// Licensed fish receiver returns are due on the 15th. The reminder must never
/// land on that day, so it starts looking the day after.
const LFR_RETURN_DAY: u32 = 15;

/// The date the manual update reminder falls on in a given month: the first
/// Monday strictly *after* the 15th.
///
/// The 15th is excluded even when it is itself a Monday, because that is
/// licensed fish receiver return submission day and the reminder must not
/// compete with it. A Monday the 15th therefore pushes the reminder to the
/// 22nd rather than firing the same day.
///
/// Returns `None` only if the year and month do not form a valid date, which
/// cannot happen for a date that came from a calendar.
pub fn reminder_date(year: i32, month: u32) -> Option<NaiveDate> {
    let fifteenth = NaiveDate::from_ymd_opt(year, month, LFR_RETURN_DAY)?;
    let days_until_monday = match fifteenth.weekday() {
        // A full week, not zero: the 15th itself is never the reminder day.
        Weekday::Mon => 7,
        other => 7 - other.num_days_from_monday(),
    };
    fifteenth.checked_add_days(Days::new(u64::from(days_until_monday)))
}

/// Whether the manual update reminder is due on `today`.
///
/// The reminder appears from the first Monday after the 15th, and is
/// suppressed by a check that succeeded on or after that date — the current
/// cycle. A check from an earlier cycle does not suppress it, which is the
/// point: the reminder exists to catch someone who has not checked recently.
///
/// Both dates are local calendar dates. The caller converts a stored timestamp
/// to a local date before calling, so a check recorded near midnight is
/// attributed to the day the user experienced, not to a UTC day that may differ.
pub fn is_update_reminder_due(today: NaiveDate, last_successful_check: Option<NaiveDate>) -> bool {
    let Some(cycle_start) = reminder_date(today.year(), today.month()) else {
        return false;
    };
    if today < cycle_start {
        return false;
    }
    match last_successful_check {
        Some(checked) => checked < cycle_start,
        None => true,
    }
}

/// The local calendar date of a stored RFC 3339 timestamp.
///
/// Returns `None` for a missing or unparseable value, which callers treat as
/// "no successful check on record".
pub fn local_date_of(timestamp: Option<&str>) -> Option<NaiveDate> {
    let parsed = DateTime::parse_from_rfc3339(timestamp?).ok()?;
    Some(parsed.with_timezone(&Local).date_naive())
}
