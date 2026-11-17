use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BusinessProfile {
    pub lfr_name: String,
    pub client_number: String,
    pub street_number: String,
    pub street_name: String,
    pub street_type: String,
    pub suburb: String,
    pub city: String,
    pub postcode: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessProfileInput {
    pub lfr_name: String,
    pub client_number: String,
    #[serde(default)]
    pub street_number: String,
    #[serde(default)]
    pub street_name: String,
    #[serde(default)]
    pub street_type: String,
    #[serde(default)]
    pub suburb: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub postcode: String,
}

/// Report logo carried to the webview as base64 PNG. Deliberately kept out of
/// `BusinessProfile` so the full data export stays free of image payloads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BusinessLogo {
    pub data_base64: String,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Vessel {
    pub id: String,
    pub fisher_id: String,
    pub name: String,
    pub vessel_number: Option<String>,
    pub is_archived: bool,
    pub has_landing_history: bool,
    pub registration_needs_review: bool,
    pub linked_permit_holders: Vec<String>,
    pub other_recorded_names: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredVessel {
    pub id: String,
    pub name: String,
    pub vessel_number: String,
    pub linked_permit_holders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VesselInput {
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub vessel_number: String,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub link_existing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Fisher {
    pub id: String,
    pub name: String,
    pub permit_number: String,
    pub is_archived: bool,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub vessels: Vec<Vessel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FisherInput {
    pub id: Option<String>,
    pub name: String,
    pub permit_number: String,
    #[serde(default)]
    pub vessels: Vec<VesselInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Fishstock {
    pub code: String,
    pub description: String,
    pub reporting_unit: String,
    pub is_active: bool,
    pub is_favorite: bool,
    pub is_user_added: bool,
}

/// The responsibilities notice version a user acknowledged on this computer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoticeAcknowledgement {
    pub version: i64,
    pub acknowledged_at: String,
}

/// A fishstock the receiver added. Only these can be edited or removed; the
/// shipped catalogue is read-only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserFishstock {
    pub code: String,
    pub description: String,
    pub reporting_unit: String,
    pub fishing_year_start_month: i64,
    pub is_favorite: bool,
    /// Current landings that use the stock. Once any do, its code and
    /// reporting unit are locked.
    pub landing_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFishstockInput {
    pub code: String,
    pub description: String,
    pub reporting_unit: String,
    pub fishing_year_start_month: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LandingItem {
    pub id: String,
    pub fishstock_code: String,
    pub description: String,
    pub quantity: i64,
    pub reporting_unit: String,
    pub display_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandingItemInput {
    pub fishstock_code: String,
    pub quantity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Landing {
    pub id: String,
    pub fisher_id: String,
    pub fisher_name: String,
    pub fisher_number: String,
    pub vessel_id: Option<String>,
    pub vessel_name: Option<String>,
    pub vessel_number: Option<String>,
    pub landing_date: String,
    pub invoice_number: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub items: Vec<LandingItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandingInput {
    pub id: Option<String>,
    pub fisher_id: String,
    pub vessel_id: Option<String>,
    pub landing_date: String,
    pub invoice_number: Option<String>,
    pub items: Vec<LandingItemInput>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandingFilters {
    pub fisher_id: Option<String>,
    pub vessel_id: Option<String>,
    /// Only landings with an item for this exact fishstock code.
    pub fishstock_code: Option<String>,
    /// Only landings whose invoice number contains this text, ignoring case.
    pub invoice_number: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LandingRevision {
    pub id: String,
    pub landing_id: String,
    pub version_number: i64,
    pub operation: String,
    pub fisher_id: Option<String>,
    pub fisher_name: String,
    pub fisher_number: String,
    pub vessel_id: Option<String>,
    pub vessel_name: Option<String>,
    pub vessel_number: Option<String>,
    pub landing_date: String,
    pub invoice_number: Option<String>,
    pub created_at: String,
    pub items: Vec<LandingItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMetrics {
    pub active_fishers: i64,
    pub active_vessels: i64,
    pub landing_count: i64,
    pub fishstock_count: i64,
    pub unit_totals: Vec<UnitTotal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnitTotal {
    pub reporting_unit: String,
    pub quantity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReportRow {
    pub fishstock_code: String,
    pub description: String,
    pub quantity: i64,
    pub reporting_unit: String,
    pub landing_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FishTypeReportRow {
    pub fish_type: String,
    pub description: String,
    pub fishstocks: Vec<String>,
    pub quantity: i64,
    pub reporting_unit: String,
    pub landing_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VesselReportRow {
    pub fisher_id: String,
    pub fisher_name: String,
    pub fisher_number: String,
    pub vessel_id: Option<String>,
    pub vessel_name: Option<String>,
    pub vessel_number: Option<String>,
    pub fishstock_code: String,
    pub description: String,
    pub quantity: i64,
    pub reporting_unit: String,
    pub landing_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VesselFishTypeReportRow {
    pub fisher_id: String,
    pub fisher_name: String,
    pub fisher_number: String,
    pub vessel_id: Option<String>,
    pub vessel_name: Option<String>,
    pub vessel_number: Option<String>,
    pub fish_type: String,
    pub description: String,
    pub fishstocks: Vec<String>,
    pub quantity: i64,
    pub reporting_unit: String,
    pub landing_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReportResult {
    pub rows: Vec<ReportRow>,
    pub fish_type_rows: Vec<FishTypeReportRow>,
    pub vessel_rows: Vec<VesselReportRow>,
    pub vessel_fish_type_rows: Vec<VesselFishTypeReportRow>,
    pub landing_count: i64,
    pub item_count: i64,
    pub unit_totals: Vec<UnitTotal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub backup_directory: Option<String>,
    pub last_backup_at: Option<String>,
    pub last_backup_path: Option<String>,
    pub destination_available: bool,
    pub same_device_warning: bool,
    pub is_stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub database_path: String,
    pub schema_version: i64,
    pub catalogue_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueDocument {
    pub schema_version: u32,
    pub catalogue_version: u32,
    pub generated_at: String,
    pub source: String,
    pub records_sha256: String,
    pub records: Vec<CatalogueRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueRecord {
    pub code: String,
    pub description: String,
    pub is_active: bool,
    pub reporting_unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullExport {
    pub business_profile: Option<BusinessProfile>,
    pub fishers: Vec<Fisher>,
    pub favorite_fishstocks: Vec<Fishstock>,
    pub user_fishstocks: Vec<UserFishstock>,
    pub landings: Vec<Landing>,
    pub landing_revisions: Vec<LandingRevision>,
    pub deleted_landings: Vec<LandingRevision>,
    pub schema_version: i64,
    pub catalogue_version: i64,
    pub exported_at: String,
}
