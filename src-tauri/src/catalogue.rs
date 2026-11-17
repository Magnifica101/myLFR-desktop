use crate::error::AppResult;
use crate::models::CatalogueDocument;

/// Parse the fishstock catalogue bundled with the application. It seeds a new
/// database and re-establishes the official stocks on a restored one; it is
/// never used to update an existing installation, because receivers maintain
/// their own additions to the list.
pub fn parse_seed(json: &str) -> AppResult<CatalogueDocument> {
    Ok(serde_json::from_str(json)?)
}
