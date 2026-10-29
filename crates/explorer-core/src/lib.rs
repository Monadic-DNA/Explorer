//! Portable client domain logic. No HTTP, filesystem, UI, or OS key storage.
//! All platforms use the same versioned JSON protocol over WASM or UniFFI.
mod analysis;
#[cfg(not(target_arch = "wasm32"))]
mod catalog;
#[cfg(not(target_arch = "wasm32"))]
mod store;
#[cfg(not(target_arch = "wasm32"))]
mod sync;
mod sync_auth;
mod crypto;
mod vault;
mod files;
mod genotype;
mod llm;
mod nilai;
mod preview;
mod quality;
mod reports;
mod research;
mod results;
mod risk;
mod session;

use serde_json::{json, Value};

#[cfg(feature = "ffi")]
uniffi::setup_scaffolding!();

pub(crate) fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}
pub(crate) fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}

pub fn dispatch(operation: &str, input: Value) -> Result<Value, String> {
    match operation {
        op if op.starts_with("vault_") => vault::dispatch(op, &input),
        "billing_catalog" => serde_json::from_str(include_str!("../../../shared/billing-catalog.json")).map_err(|e| e.to_string()),
        "version" => Ok(json!({"protocol":1,"core":env!("CARGO_PKG_VERSION")})),
        "parse_genotype" => Ok(genotype::parse(
            text(&input, "content"),
            text(&input, "format"),
        )),
        "decode_file" => Ok(json!(files::decode(&input)?)),
        "parse_variant_ids" => Ok(json!(risk::variants(input.as_str().unwrap_or("")))),
        "valid_genotype" => Ok(json!(risk::valid(input.as_str().unwrap_or("")))),
        "effect" => Ok(risk::effect(text(&input, "value"), text(&input, "ci"))),
        "risk_score" => Ok(risk::score(
            text(&input, "genotype"),
            text(&input, "riskAllele"),
            text(&input, "effectSize"),
            text(&input, "effectType"),
        )),
        "analyze_study" => Ok(risk::analyze(&input)),
        "analyze_studies" => {
            let genotypes=input["genotypes"].as_object().ok_or("Invalid genotype batch")?;
            let studies=input["studies"].as_array().ok_or("Invalid study batch")?;
            if studies.len()>50000{return Err("Study batch exceeds 50,000 rows".into());}
            Ok(json!(analysis::run(studies,analysis::Genotypes::Json(genotypes),input["strict"]==true,text(&input,"now"),input["parallel"]!=false)))
        },
        "parse_sample_size" => Ok(json!(quality::sample_size(input.as_str().unwrap_or("")))),
        "parse_p_value" => Ok(json!(quality::p_value(input.as_str().unwrap_or("")))),
        "quality_flags" => Ok(quality::flags(&input)),
        "evidence" => Ok(quality::evidence(&input)),
        "prime" => Ok(json!(quality::prime(input.as_u64().unwrap_or(0)))),
        "delicate_prime" => Ok(json!(quality::delicate(input.as_u64().unwrap_or(0)))),
        "promo" => Ok(quality::promo(input.as_str().unwrap_or(""))),
        "feature_access" => {
            let promo = quality::promo(text(&input, "promo"));
            let premium = input["activeSubscription"] == true
                || (promo["valid"] == true && promo["discount"] == 0);
            let kind = text(&input, "kind");
            let report_type = match kind {
                "Overview" => Some("overview"),
                "Healthspan" => Some("healthspan"),
                "Top traits" => Some("top_traits"),
                _ => None,
            };
            // Free: the Health report and regular Chat. Premium: Research in Chat and the other reports.
            Ok(json!({"allowed":kind == "Health" || kind == "Chat" || premium,"reportType":report_type}))
        }
        "file_hash" => Ok(json!(crypto::file_hash(input.as_str().unwrap_or("")))),
        "export_results" => Ok(json!(results::export(array(&input)))),
        "import_results" => results::import(&input),
        "overview_statistics" => Ok(reports::statistics(array(&input))),
        "partition_results" => reports::partition(&input),
        "format_results" => Ok(json!(reports::format_results(array(&input)))),
        "report_prompt" => Ok(reports::prompt(&input)),
        "select_report" => Ok(reports::select(&input)),
        "report_rules" => Ok(reports::rules().clone()),
        "user_context" => Ok(json!(reports::context(&input))),
        "research_keywords_prompt" => Ok(research::keywords_prompt(&input)),
        "research_parse_keywords" => Ok(research::parse_keywords(&input)),
        "research_angle_prompt" => Ok(research::angle_prompt(&input)),
        "research_synthesis_prompt" => Ok(research::synthesis_prompt(&input)),
        "research_extract" => Ok(research::extract(&input)),
        "chat_prompt" => Ok(research::chat_prompt(&input)),
        "llm_description" => Ok(research::description(&input)),
        "profile_schema" => Ok(reports::profile_schema()),
        "parse_profile" => reports::parse_profile(&input),
        "preview_category" => Ok(preview::classify(&input)),
        "preview_select" => Ok(preview::select(&input)),
        "preview_insight" => Ok(preview::insight(&input)),
        "render_prompt" => reports::render(&input),
        "extract_report" => Ok(reports::extract(&input)),
        "llm_config" => Ok(llm::config(&input)),
        "nilai_keypair" => nilai::keypair(&input),
        "nilai_info" => nilai::info(&input),
        "nilai_invocation" => nilai::invocation(&input),
        "seal" => crypto::seal(&input),
        "open" => crypto::open(&input),
        "auth_keypair" => crypto::auth_keypair(&input),
        "auth_seal" => crypto::auth_seal(&input),
        "auth_open" => crypto::auth_open(&input),
        #[cfg(not(target_arch = "wasm32"))]
        op if op.starts_with("store_sync_") || op == "store_needs_match" => sync::dispatch(op, &input),
        #[cfg(not(target_arch = "wasm32"))]
        op if op.starts_with("store_") => store::dispatch(op, &input),
        op if op.starts_with("session_") => session::dispatch(op, input),
        _ => Err(format!("Unknown core operation: {operation}")),
    }
}

#[cfg_attr(feature = "ffi", uniffi::export)]
pub fn core_call(request: String) -> String {
    let result = serde_json::from_str::<Value>(&request)
        .map_err(|e| e.to_string())
        .and_then(|request| {
            if request.get("version").and_then(Value::as_u64) != Some(1) {
                return Err("Unsupported core protocol version".into());
            }
            dispatch(
                text(&request, "operation"),
                request.get("input").cloned().unwrap_or(Value::Null),
            )
        });
    envelope(result)
}

fn envelope(result: Result<Value, String>) -> String {
    match result {
        Ok(value) => json!({"ok":true,"value":value}).to_string(),
        Err(error) => json!({"ok":false,"error":error}).to_string(),
    }
}

/// Transfer large native files as bytes instead of building a base64 JSON string.
/// Parsing, gzip bounds, hashing and session state remain shared with WASM.
#[cfg_attr(feature = "ffi", uniffi::export)]
pub fn import_genotype(session: u64, bytes: Vec<u8>, file_name: String) -> String {
    envelope(files::decode_bytes(bytes).and_then(|content| {
        session::dispatch(
            "session_import",
            json!({"session":session,"content":content,"fileName":file_name}),
        )
    }))
}

/// Bundled catalog snapshots for native Run all. Hosts open the snapshot file once and
/// then match it in chunks so they can show progress and cancel between chunks.
#[cfg(not(target_arch = "wasm32"))]
#[cfg_attr(feature = "ffi", uniffi::export)]
pub fn catalog_open(path: String) -> String { envelope(catalog::open(&path)) }
#[cfg(not(target_arch = "wasm32"))]
#[cfg_attr(feature = "ffi", uniffi::export)]
pub fn catalog_analyze_next(handle: u64, store: u64, max_rows: u32, now: String) -> String {
    envelope(catalog::analyze_next(handle, store, max_rows as usize, &now))
}

/// Opens the device's encrypted store with its 32-byte local key (unwrapped by the platform key store).
#[cfg(not(target_arch = "wasm32"))]
#[cfg_attr(feature = "ffi", uniffi::export)]
pub fn store_open(path: String, key: Vec<u8>) -> String {
    let key = zeroize::Zeroizing::new(key);
    envelope(store::open(&path, &key))
}
#[cfg(not(target_arch = "wasm32"))]
#[cfg_attr(feature = "ffi", uniffi::export)]
pub fn store_close(handle: u64) { store::close(handle) }
/// Large DNA files cross the FFI boundary as bytes, as with `import_genotype`.
#[cfg(not(target_arch = "wasm32"))]
#[cfg_attr(feature = "ffi", uniffi::export)]
pub fn store_import_genotype(handle: u64, bytes: Vec<u8>, file_name: String) -> String {
    envelope(store::import_genotype(handle, bytes, &file_name))
}
#[cfg(not(target_arch = "wasm32"))]
#[cfg_attr(feature = "ffi", uniffi::export)]
pub fn catalog_close(handle: u64) { catalog::close(handle) }


// Import-free WASM ABI: synchronous on browsers, Node SSR and web workers.
// Input/output are UTF-8; callers own input allocations and copy output before
// the next call. Native platforms call core_call through generated UniFFI.
#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::cell::RefCell;
    thread_local! { static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) }; }
    #[no_mangle]
    pub extern "C" fn explorer_alloc(len: usize) -> *mut u8 {
        Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
    }
    #[no_mangle]
    pub unsafe extern "C" fn explorer_free(ptr: *mut u8, len: usize) {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
    #[no_mangle]
    pub unsafe extern "C" fn explorer_call(ptr: *const u8, len: usize) -> *const u8 {
        let input = String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len));
        OUTPUT.with(|out| {
            let mut out = out.borrow_mut();
            *out = super::core_call(input.into_owned()).into_bytes();
            out.as_ptr()
        })
    }
    #[no_mangle]
    pub extern "C" fn explorer_result_len() -> usize {
        OUTPUT.with(|out| out.borrow().len())
    }
}
