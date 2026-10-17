//! Software Hub Tauri Preview 1. Privileged IO stays in Rust.
//! Catalog is compile-time embedded; only the known HTTPS URLs may be opened.
use chrono::{DateTime, Local, Utc};
use fancy_regex::Regex as FancyRegex;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::cmp::Ordering;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::time::Duration;
use tauri::WebviewWindow;

const CACHE_SCHEMA: i64 = 22;
const MAX_CACHE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_NETWORK_BYTES: usize = 4 * 1024 * 1024;
// CPU-Z: stop as soon as the official Classic x86/x64 version is visible.
const CPU_Z_PREFIX_LIMIT_BYTES: usize = 512 * 1024;
const MAX_CHECK_LOGS: usize = 40;
const MAX_CHECK_LOG_BYTES: u64 = 128 * 1024;
static CHECK_LOG_SEQ: AtomicU64 = AtomicU64::new(0);
static CHECK_LOG_LOCK: Mutex<()> = Mutex::new(());
const VERSION_TTL_SECONDS: i64 = 6 * 60 * 60;
const CATALOG: &str = include_str!("../../data/programs.json");
const SOURCES: &str = include_str!("../../data/sources.json");

fn catalog() -> Vec<Value> { serde_json::from_str(CATALOG).expect("verified catalog") }
fn sources() -> Value { serde_json::from_str(SOURCES).expect("verified sources") }
fn field<'a>(v: &'a Value, key: &str) -> &'a str { v.get(key).and_then(Value::as_str).unwrap_or("") }
fn normalized_https(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() { return None; }
    Some(url.to_string())
}
fn allowed_external_url(candidate: &str) -> bool {
    let Some(target) = normalized_https(candidate) else { return false; };
    catalog().iter().any(|p| {
        let mut urls: Vec<&str> = Vec::new();
        if let Some(actions) = p.get("actions").and_then(Value::as_array) {
            if !actions.is_empty() { for a in actions { urls.push(field(a, "url")); } }
            else { urls.push(field(p, "website")); }
        } else { urls.push(field(p, "website")); }
        if let Some(actions) = p.get("relatedActions").and_then(Value::as_array) {
            for a in actions { urls.push(field(a, "url")); }
        }
        urls.iter().any(|u| normalized_https(u).as_deref() == Some(target.as_str()))
    })
}
fn allowed_copy_text(candidate: &str) -> bool {
    if candidate.is_empty() || candidate.len() > 2048 || candidate.chars().any(|ch| ch.is_control()) { return false; }
    catalog().iter().any(|p| ["actions", "relatedActions"].iter().any(|key| {
        p.get(*key).and_then(Value::as_array).is_some_and(|actions| actions.iter().any(|a| field(a,"copyText").trim() == candidate))
    }))
}
fn cache_file() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let base = exe.parent().ok_or("Invalid executable directory")?;
    Ok(base.join("portable-data").join("version-cache.json"))
}
// Serializes saves within this process. No extra dependencies or background service.
static CACHE_WRITE_LOCK: Mutex<()> = Mutex::new(());

fn read_cache_file(path: &Path) -> Option<Map<String, Value>> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_CACHE_BYTES { return None; }
    let text = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    if ![21, CACHE_SCHEMA].contains(&value.get("schema")?.as_i64()?) { return None; }
    Some(sanitize_entries(value.get("entries")?.as_object()?))
}

fn read_cache_from(path: &Path) -> Map<String, Value> {
    read_cache_file(path)
        .or_else(|| read_cache_file(&path.with_extension("json.bak")))
        .unwrap_or_default()
}

fn read_cache() -> Map<String, Value> {
    cache_file().map(|path| read_cache_from(&path)).unwrap_or_default()
}

fn sanitize_entries(entries: &Map<String, Value>) -> Map<String, Value> {
    let allowed: std::collections::HashSet<String> = catalog().iter().map(|p| field(p,"id").to_owned()).collect();
    entries.iter().filter(|(key,val)| allowed.contains(*key) && val.is_object())
        .map(|(k,v)| {
            let mut safe = v.as_object().expect("filtered cache object").clone();
            safe.remove("publishedAt");
            safe.remove("publishedAtText");
            (k.clone(), Value::Object(safe))
        }).collect()
}

fn cache_timestamp(value: &Value, name: &str) -> i64 {
    DateTime::parse_from_rfc3339(field(value, name))
        .map(|t| t.timestamp_millis().max(0)).unwrap_or(0)
}

// The original Electron cache chooses the most recently VERIFIED record for each
// program; a newer failed attempt must not erase a verified result.
fn choose_cache_entry<'a>(stored: &'a Value, incoming: &'a Value) -> &'a Value {
    let a = cache_timestamp(stored, "checkedAt");
    let b = cache_timestamp(incoming, "checkedAt");
    if a != b { return if b > a { incoming } else { stored }; }
    let a = cache_timestamp(stored, "lastAttemptAt");
    let b = cache_timestamp(incoming, "lastAttemptAt");
    if b > a { incoming } else { stored }
}

fn merge_cache_entries(stored: &Map<String, Value>, incoming: &Map<String, Value>) -> Map<String, Value> {
    let mut merged = stored.clone();
    for (id, entry) in incoming {
        if let Some(previous) = merged.get(id) {
            let selected = choose_cache_entry(previous, entry).clone();
            merged.insert(id.clone(), selected);
        } else { merged.insert(id.clone(), entry.clone()); }
    }
    merged
}

fn write_cache_to(path: &Path, entries: &Map<String, Value>) -> Result<bool, String> {
    let parent = path.parent().ok_or("Invalid cache directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Merge with the most recent on-disk snapshot instead of overwriting it.
    // This protects per-program results across repeated saves of stale UI state.
    let safe = merge_cache_entries(&read_cache_from(path), &sanitize_entries(entries));
    let bytes = serde_json::to_vec_pretty(&json!({"schema":CACHE_SCHEMA,"entries":safe})).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_CACHE_BYTES { return Err("Version cache exceeds safety limit".into()); }
    let temporary = parent.join(format!("version-cache.{}.tmp", std::process::id()));
    let backup = path.with_extension("json.bak");
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    // Keep the previous VALID snapshot as a recovery backup. A damaged primary
    // must never overwrite a good backup during the next successful save.
    let primary_is_valid = read_cache_file(&path).is_some();
    if primary_is_valid {
        if backup.exists() { fs::remove_file(&backup).map_err(|e| e.to_string())?; }
        fs::rename(&path, &backup).map_err(|e| e.to_string())?;
    } else if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    if let Err(e) = fs::rename(&temporary, &path) {
        if backup.exists() && !path.exists() { let _ = fs::copy(&backup, &path); }
        return Err(e.to_string());
    }
    Ok(true)
}

fn write_cache(entries: &Map<String, Value>) -> Result<bool, String> {
    let _guard = CACHE_WRITE_LOCK.lock().map_err(|_| "Cache write lock failed")?;
    write_cache_to(&cache_file()?, entries)
}


// A separate UTF-8 report is created when a check starts, before any network IO.
// Progressively appended results survive a crash or a forced application shutdown.
// Only catalog IDs and bounded, line-safe diagnostics are accepted from the UI.
fn check_log_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let base = exe.parent().ok_or("Invalid executable directory")?;
    Ok(base.join("portable-data").join("check-logs"))
}
fn safe_log_name(name: &str) -> bool {
    name.len() <= 80 && name.starts_with("check-") && name.ends_with(".txt")
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}
fn safe_log_text(raw: &str) -> String {
    // Never store raw URLs, query strings, HTTP bodies, arbitrary stack traces,
    // control characters or unbounded error messages in persistent log files.
    let scrubbed = Regex::new(r"(?i)https?://[^\s]+|(?:bearer|token|password|secret)[=:][^\s]+")
        .expect("safe redaction regex").replace_all(raw, "[скрыто]");
    let mut output = String::new();
    for ch in scrubbed.chars().take(280) {
        output.push(if ch.is_control() { ' ' } else { ch });
    }
    output.trim().to_owned()
}
fn event_field(event: &Value, key: &str) -> String {
    safe_log_text(field(event, key))
}
fn show_log_value(value: &str) -> &str { if value.is_empty() { "—" } else { value } }
fn log_time() -> String { Local::now().format("%d.%m.%Y %H:%M:%S %:z").to_string() }
fn prune_check_logs(dir: &Path) {
    let Ok(items) = fs::read_dir(dir) else { return; };
    let mut files: Vec<PathBuf> = items.filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if safe_log_name(&name) && entry.file_type().ok()?.is_file() { Some(entry.path()) } else { None }
        }).collect();
    files.sort();
    let excess = files.len().saturating_sub(MAX_CHECK_LOGS);
    for file in files.into_iter().take(excess) { let _ = fs::remove_file(file); }
}
fn start_check_log_in(dir: &Path, mode: &str, planned: usize) -> Result<String, String> {
    if !["manual", "background"].contains(&mode) || planned == 0 || planned > 120 {
        return Err("Invalid check log metadata".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mode_label = if mode == "manual" { "Ручная" } else { "Фоновая при запуске" };
    for _ in 0..5 {
        let seq = CHECK_LOG_SEQ.fetch_add(1, AtomicOrdering::Relaxed);
        let filename = format!("check-{}-{}-{seq:05}.txt", Utc::now().format("%Y%m%dT%H%M%S%3fZ"), std::process::id());
        let file = fs::OpenOptions::new().write(true).create_new(true).open(dir.join(&filename));
        match file {
            Ok(mut f) => {
                writeln!(f, "Software Hub — журнал проверки версий\nНачало: {}\nРежим: {}\nЗапланировано источников: {}\nСтатус: выполняется (если нет строки «Завершено», запуск был прерван)\n\nРезультаты:", log_time(), mode_label, planned)
                    .map_err(|e|e.to_string())?;
                prune_check_logs(dir);
                return Ok(filename);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Cannot allocate unique check log".into())
}
fn append_line_to_log(dir: &Path, filename: &str, text: &str) -> Result<(), String> {
    if !safe_log_name(filename) { return Err("Invalid check log identifier".into()); }
    let file = dir.join(filename);
    if !fs::metadata(&file).map_err(|e|e.to_string())?.is_file() { return Err("Invalid check log file".into()); }
    if fs::metadata(&file).map_err(|e|e.to_string())?.len() + text.len() as u64 > MAX_CHECK_LOG_BYTES {
        return Err("Check log size limit reached".into());
    }
    let mut f = fs::OpenOptions::new().append(true).open(&file).map_err(|e|e.to_string())?;
    f.write_all(text.as_bytes()).map_err(|e|e.to_string())?;
    f.flush().map_err(|e|e.to_string())
}
fn append_check_log_in(dir: &Path, filename: &str, event: &Value) -> Result<(), String> {
    let id = field(event, "programId");
    let program = catalog().into_iter().find(|p|field(p,"id") == id).ok_or("Unknown log program ID")?;
    let status = field(event, "status");
    let label = match status {
        "changed" => "ИЗМЕНЕНИЕ",
        "unchanged" => "БЕЗ ИЗМЕНЕНИЙ",
        "fallback" => "РЕЗЕРВ",
        "error" => "ОШИБКА",
        "deferred" => "ОТЛОЖЕНО",
        _ => return Err("Invalid check log event status".into())
    };
    let old_version = event_field(event, "oldVersion");
    let new_version = event_field(event, "newVersion");
    let reason = event_field(event, "reason");
    let transport = event_field(event, "transport");
    let text = format!("\n[{}] {} — {} ({})\n  Источник: {}\n  Версия: {} → {}\n  Метод: {}\n  Причина / пояснение: {}\n",
        log_time(), label, safe_log_text(field(&program,"name")), id,
        safe_log_text(field(&program["versionSource"], "sourceId")),
        show_log_value(&old_version), show_log_value(&new_version),
        show_log_value(&transport), show_log_value(&reason));
    append_line_to_log(dir, filename, &text)
}
fn finish_check_log_in(dir: &Path, filename: &str, summary: &Value) -> Result<(), String> {
    let status = match field(summary, "status") {
        "completed" => "Завершено",
        "offline" => "Прервано: нет подключения к интернету",
        "error" => "Прервано из-за ошибки",
        _ => return Err("Invalid check log completion status".into())
    };
    let number = |key: &str| summary.get(key).and_then(Value::as_u64).unwrap_or(0).min(120);
    let text = format!("\n--- ИТОГ ---\nЗавершено: {}\nСтатус: {}\nПроверено без изменений: {}\nИзменена версия или впервые подтверждена: {}\nРезерв: {}\nОшибки: {}\nОтложено: {}\nСохранение кэша: {}\nКомментарий: {}\n",
        log_time(), status, number("unchanged"), number("changed"), number("fallback"), number("errors"), number("deferred"),
        event_field(summary,"cacheStatus"), event_field(summary,"reason"));
    append_line_to_log(dir, filename, &text)
}
#[tauri::command]
fn start_version_check_log(mode: String, planned: usize) -> Result<String, String> {
    let _guard = CHECK_LOG_LOCK.lock().map_err(|_|"Check log lock failure")?;
    start_check_log_in(&check_log_dir()?, &mode, planned)
}
#[tauri::command]
fn append_version_check_log(log_id: String, event: Value) -> Result<bool, String> {
    let _guard = CHECK_LOG_LOCK.lock().map_err(|_|"Check log lock failure")?;
    append_check_log_in(&check_log_dir()?, &log_id, &event).map(|_|true)
}
#[tauri::command]
fn finish_version_check_log(log_id: String, summary: Value) -> Result<bool, String> {
    let _guard = CHECK_LOG_LOCK.lock().map_err(|_|"Check log lock failure")?;
    finish_check_log_in(&check_log_dir()?, &log_id, &summary).map(|_|true)
}

fn source_is_automatic(program: &Value, configs: &Value) -> bool {
    let id = field(&program["versionSource"],"sourceId");
    !id.is_empty() && configs.get(id).and_then(|s|s.get("adapter")).and_then(Value::as_str)
        .is_some_and(|adapter| adapter != "official-page-date")
}
fn was_recently_verified(cache: &Value) -> bool {
    if !cache.get("ok").and_then(Value::as_bool).unwrap_or(false)
        || field(cache, "version").is_empty()
        || cache.get("configuredFallback").and_then(Value::as_bool).unwrap_or(false)
        || field(cache, "verification") == "configured-fallback"
        || field(cache, "transport").contains("configured-fallback") { return false; }
    let Ok(t) = DateTime::parse_from_rfc3339(field(cache,"checkedAt")) else { return false; };
    let age = (Utc::now() - t.with_timezone(&Utc)).num_seconds();
    (0..VERSION_TTL_SECONDS).contains(&age)
}

#[tauri::command]
fn get_catalog() -> Value { json!({"programs":catalog(),"sources":sources()}) }
#[tauri::command]
fn get_version_cache() -> Value { Value::Object(read_cache()) }
#[tauri::command]
fn set_version_cache(cache: Value) -> Result<bool, String> {
    let input = cache.as_object().ok_or("Cache entries must be an object")?;
    write_cache(input)
}
#[tauri::command]
fn get_startup_refresh_ids() -> Vec<String> {
    let configs = sources();
    let cache = read_cache();
    catalog().iter().filter(|p| source_is_automatic(p,&configs))
        .filter(|p| !cache.get(field(p,"id")).is_some_and(was_recently_verified))
        .map(|p|field(p,"id").to_owned()).collect()
}
#[tauri::command]
fn open_external(url: String) -> bool {
    allowed_external_url(&url) && open::that(url).is_ok()
}
#[tauri::command]
fn copy_catalog_text(value: String) -> bool {
    if !allowed_copy_text(value.trim()) { return false; }
    arboard::Clipboard::new().and_then(|mut c| c.set_text(value.trim().to_owned())).is_ok()
}
#[tauri::command]
fn is_internet_available() -> bool {
    #[cfg(windows)] {
        #[link(name = "wininet")]
        extern "system" { fn InternetGetConnectedState(flags: *mut u32, reserved: u32) -> i32; }
        let mut flags: u32 = 0;
        unsafe { return InternetGetConnectedState(&mut flags, 0) != 0; }
    }
    #[cfg(not(windows))] { true }
}
#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> { window.minimize().map_err(|e|e.to_string()) }
#[tauri::command]
fn toggle_maximize_window(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|e|e.to_string())? { window.unmaximize() } else { window.maximize() }.map_err(|e|e.to_string())
}
#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> { window.close().map_err(|e|e.to_string()) }

fn http_client(timeout_ms: u64) -> Result<reqwest::blocking::Client, String> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 6 || attempt.url().scheme() != "https"
            || !attempt.url().username().is_empty() || attempt.url().password().is_some() {
            attempt.stop()
        } else { attempt.follow() }
    });
    reqwest::blocking::Client::builder()
        .user_agent("Software-Hub/0.7-Tauri-Preview1")
        .timeout(Duration::from_millis(timeout_ms.clamp(500, 12000)))
        .redirect(policy)
        .build().map_err(|e| e.to_string())
}
// HEAD returns metadata about a resource, not the representation body.
// In particular, Content-Length on a HEAD response is the size of a potential GET:
// an installer can be hundreds of megabytes without being downloaded here.
fn read_response_body_limited<R: Read>(reader: &mut R, headers: &reqwest::header::HeaderMap, method: &reqwest::Method) -> Result<String, String> {
    if *method == reqwest::Method::HEAD { return Ok(String::new()); }
    if headers.get(reqwest::header::CONTENT_LENGTH).and_then(|n|n.to_str().ok()).and_then(|n|n.parse::<usize>().ok()).is_some_and(|n|n > MAX_NETWORK_BYTES) {
        return Err("Response too large".into());
    }
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let count = reader.read(&mut chunk).map_err(|e|e.to_string())?;
        if count == 0 { break; }
        if bytes.len()+count > MAX_NETWORK_BYTES { return Err("Response too large".into()); }
        bytes.extend_from_slice(&chunk[..count]);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
fn fetch_limited(client: &reqwest::blocking::Client, address: &str, method: reqwest::Method) -> Result<(String, String, reqwest::header::HeaderMap), String> {
    if normalized_https(address).is_none() { return Err("HTTPS required".into()); }
    let mut response = client.request(method.clone(), address).send().map_err(|e|e.to_string())?;
    if response.url().scheme() != "https" { return Err("HTTP downgrade blocked".into()); }
    if !response.status().is_success() { return Err(format!("HTTP {}", response.status().as_u16())); }
    let final_url = response.url().to_string();
    let headers = response.headers().clone();
    let raw = read_response_body_limited(&mut response, &headers, &method)?;
    Ok((raw, final_url, headers))
}
// Ignore incomplete script/style elements at the tail of a streaming prefix.
// A raw JS string containing a version must NEVER count as page-visible text.
fn cpu_z_visible_prefix_end(html: &str) -> usize {
    let lower = html.to_ascii_lowercase();
    let mut end = html.len();
    for tag in ["script", "style"] {
        let open = format!("<{tag}");
        let close = format!("</{tag}>");
        if let Some(position) = lower.rfind(&open) {
            if lower.rfind(&close).is_none_or(|last_close| last_close < position) {
                end = end.min(position);
            }
        }
    }
    end
}

fn cpu_z_classic_version_from_prefix(html: &str, source: &Value) -> Option<String> {
    let safe_end = cpu_z_visible_prefix_end(html);
    let cleaned = strip_html(&html[..safe_end]);
    let lowered = cleaned.to_ascii_lowercase();
    let start = lowered.find("classic versions")? + "classic versions".len();
    // Restrict the evidence to this download section: not vintage/ARM64,
    // custom OEM packages, histories, script data, or an arbitrary page title.
    let remainder = &cleaned[start..];
    let lower_remainder = &lowered[start..];
    let mut end = remainder.len().min(64 * 1024);
    for marker in ["vintage version", "custom versions", "versions history"] {
        if let Some(position) = lower_remainder.find(marker) { end = end.min(position); }
    }
    // A byte budget may stop in the middle of a UTF-8 character.
    while !remainder.is_char_boundary(end) { end -= 1; }
    let matches = match_pattern(&remainder[..end], source, "versionPattern", field(source, "versionPatternFlags"));
    matches.first().map(|found| found.0.to_owned())
}

// Do not wait for a slow/trickling page to reach EOF once CPU-Z is verified.
// Never save a raw HTML body or claim a cached/default version was verified.
fn read_cpu_z_classic_early<R: Read>(reader: &mut R, source: &Value) -> Result<Option<String>, String> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let remaining = CPU_Z_PREFIX_LIMIT_BYTES.saturating_sub(bytes.len());
        if remaining == 0 { return Err("Response too large".into()); }
        let limit = chunk.len().min(remaining);
        let count = reader.read(&mut chunk[..limit]).map_err(|e| e.to_string())?;
        if count == 0 { return Ok(None); }
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(version) = cpu_z_classic_version_from_prefix(&String::from_utf8_lossy(&bytes), source) {
            return Ok(Some(version));
        }
    }
}

fn check_cpu_z_early(p: &Value, source: &Value, client: &reqwest::blocking::Client) -> Value {
    const CPUID_PAGE: &str = "https://www.cpuid.com/softwares/cpu-z.html";
    let address = field(source, "url");
    // This special short-circuit must never be usable on another origin.
    if address != CPUID_PAGE { return default_failure("cpu-z-source-mismatch"); }
    let mut response = match client.get(address).send() {
        Ok(response) => response,
        Err(error) => return configured_fallback(p, source, &public_network_error(&error.to_string())),
    };
    if !response.status().is_success() {
        return configured_fallback(p, source, &format!("HTTP {}", response.status().as_u16()));
    }
    if !same_official_page(CPUID_PAGE, response.url().as_str()) {
        return configured_fallback(p, source, "cpu-z-official-url-mismatch");
    }
    match read_cpu_z_classic_early(&mut response, source) {
        Ok(Some(version)) => json!({"ok":true,"sourceId":field(source,"sourceId"),
            "version":version,"rawVersion":version,"htmlUrl":CPUID_PAGE,
            "transport":"official-cpuid-early-html","rule":{"type":"official-page","section":"classic-x86-x64"}}),
        Ok(None) => configured_fallback(p, source, "cpu-z-classic-version-not-found"),
        Err(error) => configured_fallback(p, source, &public_network_error(&error)),
    }
}

fn version_cmp(a: &str,b: &str) -> Ordering {
    let numbers = Regex::new(r"\d+").expect("safe regex");
    let aa: Vec<u64> = numbers.find_iter(a).filter_map(|m|m.as_str().parse().ok()).collect();
    let bb: Vec<u64> = numbers.find_iter(b).filter_map(|m|m.as_str().parse().ok()).collect();
    for i in 0..aa.len().max(bb.len()) {
        match aa.get(i).copied().unwrap_or(0).cmp(&bb.get(i).copied().unwrap_or(0)) {
            Ordering::Equal => {}, other => return other
        }
    }
    Ordering::Equal
}
fn compiled_pattern(pattern: &str, flags: &str) -> Result<FancyRegex, String> {
    if pattern.len() > 4000 { return Err("Invalid source pattern length".into()); }
    let mut opts = String::new();
    if flags.contains('i') { opts.push('i'); }
    if flags.contains('m') { opts.push('m'); }
    let formatted = if opts.is_empty() { pattern.to_owned() } else { format!("(?{opts}){pattern}") };
    FancyRegex::new(&formatted).map_err(|e|e.to_string())
}
fn default_failure(reason: &str) -> Value { json!({"ok":false,"reason":reason,"message":reason}) }
fn configured_fallback(p: &Value, source: &Value, why: &str) -> Value {
    let version=field(source,"fallbackVersion");
    if version.is_empty() { return default_failure(why); }
    json!({"ok":true,"sourceId":field(source,"sourceId"),"version":version,"rawVersion":version,
        "htmlUrl":p.get("website"),"fallback":true,"configuredFallback":true,
        "verification":"configured-fallback","transport":"configured-fallback",
        "reason":why,"message":why,"rule":{"type":"configured-fallback"}})
}
fn pick_releases<'a>(list: &'a [Value], policy: &Value) -> Option<(String, &'a Value)> {
    let include_pre = policy.get("includePrerelease").and_then(Value::as_bool).unwrap_or(false);
    let field_name = policy.get("versionField").and_then(Value::as_str).unwrap_or("tag_name");
    let pattern = policy.get("versionPattern").and_then(Value::as_str).unwrap_or("");
    let regex = if !pattern.is_empty() { compiled_pattern(pattern,"i").ok() } else { None };
    let exclude = policy.get("excludePattern").and_then(Value::as_str).and_then(|p|compiled_pattern(p,"i").ok());
    let selection = field(policy,"selection");
    let mut chosen: Option<(String,&Value)> = None;
    for release in list {
        if release.get("draft").and_then(Value::as_bool).unwrap_or(false) { continue; }
        let raw = field(release,field_name);
        if raw.is_empty() { continue; }
        if !include_pre && (release.get("prerelease").and_then(Value::as_bool).unwrap_or(false) || raw.contains("-rc") || raw.contains("-beta") || raw.contains("-alpha")) {continue;}
        if exclude.as_ref().is_some_and(|re| re.is_match(raw).unwrap_or(false)) { continue; }
        let version = if let Some(re) = regex.as_ref() {
            match re.captures(raw).ok().flatten() { Some(caps) => caps.get(1).or_else(||caps.get(0)).map(|m|m.as_str().to_string()).unwrap_or_default(), None => continue }
        } else { raw.to_string() };
        if version.is_empty() {continue;}
        let better = match &chosen {
            None => true,
            Some((current,old)) => {
                if selection == "latest-published" {field(release,"published_at") > field(old,"published_at")}
                else {version_cmp(&version,current) == Ordering::Greater}
            }
        };
        if better {chosen = Some((version,release));}
    }
    chosen
}
// Only concise, non-sensitive network failure categories go into persistent logs.
fn public_network_error(error: &str) -> String {
    if let Some(status) = error.strip_prefix("HTTP ") {
        let digits: String = status.chars().take_while(|c|c.is_ascii_digit()).collect();
        if digits.len() == 3 { return format!("HTTP {digits}"); }
    }
    let lower=error.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") { "network-timeout".into() }
    else if lower.contains("certificate") || lower.contains("tls") { "tls-error".into() }
    else if lower.contains("dns") || lower.contains("lookup") { "dns-error".into() }
    else if lower.contains("response too large") { "response-too-large".into() }
    else { "network-error".into() }
}
fn check_github(p: &Value, source: &Value, configs: &Value, client: &reqwest::blocking::Client) -> Value {
    let repo = field(source,"repo");
    if repo.split('/').count()!=2 || repo.contains(' ') || repo.contains('?') || repo.contains('#') { return default_failure("invalid-repo"); }
    let policy = &source["releasePolicy"];
    let default_policy = &configs["github-releases"]["defaultPolicy"];
    let mut merged = default_policy.as_object().cloned().unwrap_or_default();
    if let Some(extra) = policy.as_object() { merged.extend(extra.clone()); }
    let policy = Value::Object(merged);
    let atom = format!("https://github.com/{repo}/releases.atom");
    let mut releases = Vec::new();
    let mut transport = "github-atom";
    // simplewall tags its public Beta releases without "-beta" in the tag
    // itself (e.g. v.3.9.1). Atom cannot reliably indicate prerelease
    // status, so use GitHub API metadata for this repository.
    if field(p, "id") != "simplewall" {
      if let Ok((xml,_,_))=fetch_limited(client,&atom,reqwest::Method::GET) {
        let entry_regex = Regex::new(r"(?s)<entry\b[^>]*>(.*?)</entry>").expect("safe regex");
        let link_regex = Regex::new(r#"<link\b[^>]*href=["']([^"']+)["']"#).expect("safe regex");
        let title_re = Regex::new(r"(?s)<title[^>]*>(.*?)</title>").expect("safe regex");
        let published_re = Regex::new(r"(?s)<published[^>]*>(.*?)</published>").expect("safe regex");
        for c in entry_regex.captures_iter(&xml).take(100) {
            let block=&c[1];
            let link = link_regex.captures(block).map(|c|c[1].to_string()).unwrap_or_default();
            let title = title_re.captures(block).map(|c|c[1].to_string()).unwrap_or_default();
            let published = published_re.captures(block).map(|c|c[1].to_string()).unwrap_or_default();
            let tag = link.split("/releases/tag/").nth(1).unwrap_or("").split('?').next().unwrap_or("");
            if tag.is_empty() {continue;}
            releases.push(json!({"tag_name":tag,"name":title,"published_at":published,"html_url":link,"draft":false,"prerelease":tag.contains("-rc") || tag.contains("-beta") || tag.contains("-alpha")}));
        }
      }
    }
    if pick_releases(&releases,&policy).is_none() {
        transport = "github-api";
        let api=format!("https://api.github.com/repos/{repo}/releases?per_page=30");
        let result=fetch_limited(client,&api,reqwest::Method::GET)
            .and_then(|(raw,_,_)| serde_json::from_str::<Vec<Value>>(&raw).map_err(|e|e.to_string()));
        releases=match result { Ok(rs)=>rs, Err(msg)=>return configured_fallback(p,source,&format!("github-network: {}", public_network_error(&msg))) };
    }
    if let Some((version,release))=pick_releases(&releases,&policy) {
        json!({"ok":true,"sourceId":"github-releases","version":version,"rawVersion":release.get("tag_name"),
            "htmlUrl":release.get("html_url").or_else(||p.get("website")),
            "prerelease":release.get("prerelease"),"transport":transport,
            "rule":{"selection":field(&policy,"selection"),"versionField":field(&policy,"versionField")}})
    } else { configured_fallback(p,source,"no-release") }
}
fn strip_html(value: &str) -> String {
    let block=Regex::new(r"(?is)<(script|style)\b[^>]*>.*?</(script|style)>").expect("safe regex");
    let tags=Regex::new(r"(?s)<[^>]+>").expect("safe regex");
    let spaces=Regex::new(r"\s+").expect("safe regex");
    let text=block.replace_all(value," ");
    let text=tags.replace_all(&text," ");
    let text=text.replace("&nbsp;"," ").replace("&amp;","&").replace("&quot;","\"").replace("&#39;","'");
    spaces.replace_all(&text," ").to_string()
}
// Use captured groups from the SELECTED version match, not the first date on
// an unrelated entry on the same page (K-Lite, qBittorrent, Snipaste).
fn match_pattern(text: &str, source: &Value, key: &str, flags: &str) -> Vec<(String, String, Vec<String>)> {
    let Ok(rx) = compiled_pattern(field(source, key), flags) else { return Vec::new(); };
    rx.captures_iter(text).take(500).filter_map(|result| result.ok()).map(|cap| {
        let full = cap.get(0).map(|m| m.as_str()).unwrap_or("").to_owned();
        let groups = (0..cap.len()).map(|i| cap.get(i).map(|m| m.as_str()).unwrap_or("").to_owned()).collect::<Vec<_>>();
        (cap.get(1).or_else(||cap.get(0)).map(|m| m.as_str()).unwrap_or("").to_owned(), full, groups)
    }).collect()
}

// Python.org occasionally serves HTML that differs from our known public layout.
// These small, fixed diagnostic codes reveal which stage failed, not the response
// body, URL, tokens or HTML snippets. No backup version is promoted to verified.
fn python_windows_page_diagnostic(raw: &str, cleaned: &str) -> &'static str {
    if raw.trim().is_empty() { return "python-empty-response"; }
    let text = cleaned.to_ascii_lowercase();
    if ["just a moment", "checking your browser", "enable javascript and cookies", "captcha", "access denied"]
        .iter().any(|marker| text.contains(marker)) {
        return "python-page-access-challenge";
    }
    if text.contains("latest python 3 release") {
        return "python-header-present-pattern-miss";
    }
    if text.contains("stable releases") {
        return "python-stable-section-without-header";
    }
    if text.contains("python releases for windows") {
        return "python-windows-page-unexpected-layout";
    }
    "python-unexpected-response"
}

// When python.org's large Windows HTML page cannot be recognized, try the
// site's small official RSS. Only a release ITEM with a stable-version title
// AND the matching python.org release permalink can confirm a version.
// Content from descriptions, pre-release titles and unrelated RSS are ignored.
fn python_rss_stable_version(xml: &str) -> Option<String> {
    if !xml.contains("<rss") { return None; }
    let items = Regex::new(r"(?is)<item\b[^>]*>(.*?)</item>").expect("valid RSS item expression");
    let titles = Regex::new(r"(?is)<title\b[^>]*>(.*?)</title>").expect("valid RSS title expression");
    let links = Regex::new(r"(?is)<link\b[^>]*>(.*?)</link>").expect("valid RSS link expression");
    let stable = Regex::new(r"(?i)^Python\s+(3\.\d+\.\d+)(?:\s+(?:release|final))?$").expect("valid stable version expression");
    let mut best: Option<String> = None;
    for item in items.captures_iter(xml).take(100) {
        let body = item.get(1)?.as_str();
        let Some(title) = titles.captures(body) else { continue; };
        let title = strip_html(title.get(1)?.as_str());
        let Some(candidate) = stable.captures(title.trim()) else { continue; };
        let version = candidate.get(1)?.as_str();
        let Some(link) = links.captures(body) else { continue; };
        let Some(link_text) = link.get(1) else { continue; };
        let Ok(link_url) = url::Url::parse(link_text.as_str().trim()) else { continue; };
        if link_url.scheme() != "https" || !matches!(link_url.host_str(), Some("www.python.org" | "python.org"))
            || link_url.query().is_some() || link_url.fragment().is_some() { continue; }
        let release_path = format!("/downloads/release/python-{}", version.replace('.', ""));
        if link_url.path().trim_end_matches('/') != release_path { continue; }
        if best.as_ref().is_none_or(|current| version_cmp(version, current) == Ordering::Greater) {
            best = Some(version.to_owned());
        }
    }
    best
}

fn check_python_official_rss(client: &reqwest::blocking::Client) -> Option<String> {
    const FEED: &str = "https://www.python.org/downloads/feed.rss";
    let (xml, final_url, _) = fetch_limited(client, FEED, reqwest::Method::GET).ok()?;
    // The existing network layer permits HTTPS redirects; require the final
    // feed URL to remain the official feed before accepting its data.
    let final_url = url::Url::parse(&final_url).ok()?;
    if final_url.scheme() != "https" || !matches!(final_url.host_str(), Some("www.python.org" | "python.org"))
        || final_url.path() != "/downloads/feed.rss" { return None; }
    python_rss_stable_version(&xml)
}

// A few legacy Electron sources requested a JS-rendered document. Probe their
// exact official HTML endpoint first: if it contains the existing strict
// catalog pattern in VISIBLE text, no embedded browser is necessary.
// Other future rendered sources must still opt in deliberately.
fn same_official_page(expected: &str, actual: &str) -> bool {
    let (Ok(want), Ok(got)) = (url::Url::parse(expected), url::Url::parse(actual)) else { return false; };
    if want.scheme() != "https" || got.scheme() != "https" || want.username() != "" || got.username() != ""
        || want.password().is_some() || got.password().is_some() || got.query().is_some() || got.fragment().is_some()
        || got.port().is_some() { return false; }
    let (Some(want_host), Some(got_host)) = (want.host_str(), got.host_str()) else { return false; };
    want_host.strip_prefix("www.").unwrap_or(want_host)
        == got_host.strip_prefix("www.").unwrap_or(got_host)
        && want.path().trim_end_matches('/') == got.path().trim_end_matches('/')
}

// Only these five programs may use the community-maintained Microsoft WinGet
// manifests after their vendor site explicitly refuses automated requests.
// WinGet is not a vendor release date authority: intentionally version ONLY.
fn winget_package_for(id: &str) -> Option<(&'static str, &'static str)> {
    match id {
        "adwcleaner" => Some(("manifests/m/Malwarebytes/AdwCleaner", "Malwarebytes.AdwCleaner")),
        "afterburner" => Some(("manifests/g/Guru3D/Afterburner", "Guru3D.Afterburner")),
        "gpu-z" => Some(("manifests/t/TechPowerUp/GPU-Z", "TechPowerUp.GPU-Z")),
        "nvcleanstall" => Some(("manifests/t/TechPowerUp/NVCleanstall", "TechPowerUp.NVCleanstall")),
        "rtss" => Some(("manifests/g/Guru3D/RTSS", "Guru3D.RTSS")),
        _ => None,
    }
}

fn winget_choose_manifest_directory(items: &Value) -> Option<String> {
    let mut newest: Option<String> = None;
    let dir_re = Regex::new(r"^\d+(?:\.\d+){2,3}$").expect("safe regex");
    // Invalid JSON, out-of-scope directories and prerelease labels aren't version evidence.
    let dirs = items.as_array()?;
    if dirs.len() > 256 { return None; }
    for entry in dirs {
        if field(entry, "type") != "dir" { continue; }
        let value = field(entry, "name");
        if !dir_re.is_match(value) { continue; }
        if newest.as_ref().is_none_or(|current| version_cmp(value, current) == Ordering::Greater) {
            newest = Some(value.to_owned());
        }
    }
    newest
}

fn winget_confirm_version_manifest(text: &str, package: &str, selected_version: &str) -> Option<String> {
    // Read a tiny *version* manifest, not the installer manifest, release notes
    // or an unrelated repository search hit. Exactly one identifier/version/type.
    if text.len() > 8192 || text.contains('\0') { return None; }
    let mut ids = Vec::new();
    let mut versions = Vec::new();
    let mut types = Vec::new();
    for line in text.lines() {
        let trimmed=line.trim();
        if let Some(value)=trimmed.strip_prefix("PackageIdentifier:") { ids.push(value.trim()); }
        if let Some(value)=trimmed.strip_prefix("PackageVersion:") { versions.push(value.trim()); }
        if let Some(value)=trimmed.strip_prefix("ManifestType:") { types.push(value.trim()); }
    }
    if ids != [package] || versions != [selected_version] || types != ["version"] {return None;}
    Some(selected_version.to_owned())
}

fn winget_display_version(program_id: &str, manifest_version: &str) -> Option<String> {
    let segments: Vec<&str> = manifest_version.split('.').collect();
    if segments.len() < 3 || segments.len() > 4 || segments.iter().any(|n|n.is_empty() || n.len()>9 || !n.chars().all(|ch|ch.is_ascii_digit())) {
        return None;
    }
    // Malwarebytes officially publishes 8.8.1, while WinGet's file build is 8.8.1.639.
    if program_id == "adwcleaner" { Some(segments[..3].join(".")) }
    else if matches!(program_id, "afterburner" | "gpu-z" | "nvcleanstall" | "rtss") && segments.len()==3 { Some(manifest_version.to_owned()) }
    else { None }
}

// A stale community manifest must not downgrade GPU-Z, NVCleanstall or RTSS
// below the configured stable version. If GitHub is behind, keep fallback.
fn winget_meets_configured_version_floor(program_id: &str, version: &str, source: &Value) -> bool {
    if !matches!(program_id, "gpu-z" | "nvcleanstall" | "rtss") { return true; }
    let baseline = field(source, "fallbackVersion");
    baseline.is_empty() || version_cmp(version, baseline) != Ordering::Less
}

fn check_winget_community_version(p: &Value, source: &Value, client: &reqwest::blocking::Client) -> Option<Value> {
    let id = field(p, "id");
    let (relative_dir, package) = winget_package_for(id)?;
    let api_url = format!("https://api.github.com/repos/microsoft/winget-pkgs/contents/{relative_dir}");
    let (raw_dir, final_dir, _) = fetch_limited(client, &api_url, reqwest::Method::GET).ok()?;
    if !same_official_page(&api_url, &final_dir) { return None; }
    let contents: Value = serde_json::from_str(&raw_dir).ok()?;
    let directory = winget_choose_manifest_directory(&contents)?;
    let manifest_url = format!("https://raw.githubusercontent.com/microsoft/winget-pkgs/master/{relative_dir}/{directory}/{package}.yaml");
    let (raw_manifest, final_manifest, _) = fetch_limited(client, &manifest_url, reqwest::Method::GET).ok()?;
    if !same_official_page(&manifest_url, &final_manifest) { return None; }
    let exact_version=winget_confirm_version_manifest(&raw_manifest, package, &directory)?;
    let version=winget_display_version(id, &exact_version)?;
    if !winget_meets_configured_version_floor(id, &version, source) { return None; }
    Some(json!({"ok":true,"sourceId":field(source,"sourceId"),
        "version":version,"rawVersion":exact_version,"publishedAt":null,"publishedAtText":null,
        "htmlUrl":p.get("website"),"transport":"winget-community-manifest",
        "rule":{"type":"community-package-manifest","package":package,"releaseDateVerified":false}}))
}

// An official Guru3D index is an alternative only when it links to the exact
// RTSS download page. Never accept an arbitrary 'RTSS' mention or a version
// belonging to another program, and never change the download destination.
fn rtss_version_from_official_index(raw: &str, index_url: &str, source: &Value) -> Option<String> {
    const RTSS_URL: &str = "https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/";
    const MAX_ANCHORS: usize = 3000;
    let base = url::Url::parse(index_url).ok()?;
    let anchor_re = Regex::new(r"(?is)<a\b([^>]*)>(.*?)</a>").ok()?;
    let href_re = Regex::new(r#"(?i)\bhref\s*=\s*["']([^"']+)["']"#).ok()?;
    let mut versions = Vec::new();
    for caps in anchor_re.captures_iter(raw).take(MAX_ANCHORS) {
        let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let Some(href) = href_re.captures(attrs).and_then(|c| c.get(1)).map(|m| m.as_str()) else { continue; };
        let Ok(resolved) = base.join(href) else { continue; };
        if !same_official_page(RTSS_URL, resolved.as_str()) { continue; }
        let title = strip_html(caps.get(2).map(|m| m.as_str()).unwrap_or(""));
        for (version, _, _) in match_pattern(&title, source, "versionPattern", field(source, "versionPatternFlags")) {
            versions.push(version);
        }
    }
    versions.into_iter().max_by(|a, b| version_cmp(a, b))
}

fn check_official(p: &Value, source: &Value, adapter: &str, client: &reqwest::blocking::Client) -> Value {
    if field(p, "id") == "cpu-z" && adapter == "official-page" {
        return check_cpu_z_early(p, source, client);
    }
    let rendered_url = field(source, "renderedPageUrl");
    let probe_official_html = !rendered_url.is_empty() && field(p, "id") == "rtss";
    if !rendered_url.is_empty() && !probe_official_html {
        return configured_fallback(p, source, "rendered-page-pending-port");
    }
    // Never scan the general Guru3D download index for an RTSS version: its
    // unrelated download cards can be newer than the actual RTSS release.
    let urls: Vec<&str> = if let Some(a) = source.get("urls").and_then(Value::as_array) {
        a.iter().filter_map(Value::as_str).collect()
    } else { vec![field(source, "url")] };
    if urls.is_empty() || urls.iter().any(|u| normalized_https(u).is_none()) { return default_failure("https-required"); }
    // The index may be used only for RTSS and only from the exact Guru3D URL.
    // Reject unexpected catalog edits rather than silently trusting a third party.
    if probe_official_html && (rendered_url != "https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/"
        || urls.iter().any(|u| !matches!(*u,
            "https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/" |
            "https://www.guru3d.com/pages/"))) {
        return default_failure("rtss-source-mismatch");
    }
    let mut last_fetch_error: Option<String> = None;
    let mut python_diagnostic: Option<&'static str> = None;
    let mut any_content = false;
    for &url in &urls {
        let method = if adapter == "official-download" { reqwest::Method::HEAD } else { reqwest::Method::GET };
        let (raw, final_url, headers) = match fetch_limited(client, url, method) {
            Ok(response) => response,
            Err(error) => { last_fetch_error=Some(public_network_error(&error)); continue; }
        };
        if probe_official_html && !same_official_page(url, &final_url) {
            last_fetch_error=Some("official-page-redirect-mismatch".into());
            continue;
        }
        any_content = true;
        if probe_official_html && url != rendered_url {
            if let Some(version) = rtss_version_from_official_index(&raw, &final_url, source) {
                return json!({"ok":true,"sourceId":field(source,"sourceId"),"version":version,"rawVersion":version,
                    "htmlUrl":rendered_url,"transport":"official-guru3d-index",
                    "rule":{"type":"official-linked-index","product":"rtss"}});
            }
            continue;
        }
        if adapter == "official-download" {
            let filename_info = format!("{} {}", final_url, headers.get("content-disposition").and_then(|n|n.to_str().ok()).unwrap_or(""));
            let matches = match_pattern(&filename_info, &json!({"filenamePattern":field(source,"filenamePattern")}), "filenamePattern", "i");
            let version = field(source, "versionOverride").to_owned();
            let version = if version.is_empty() { matches.first().map(|(v,_,_)| v.clone()).unwrap_or_default() } else { version };
            if !version.is_empty() {
                return json!({"ok":true,"sourceId":field(source,"sourceId"),"version":version,"rawVersion":version,
                    "htmlUrl":p.get("website"),"transport":"head","rule":{"type":"official-download"}});
            }
            continue;
        }
        let cleaned = strip_html(&raw);
        let current_release_text = &cleaned;
        if field(source, "versionPattern").is_empty() { return default_failure("missing-version-pattern"); }
        let mut matches = match_pattern(current_release_text, source, "versionPattern", field(source, "versionPatternFlags"));
        let from_cleaned = !matches.is_empty();
        // Rendered-page replacements may only trust user-visible page text.
        // JavaScript blobs, metadata and hidden history are not release proof.
        if !from_cleaned && !probe_official_html {
            matches = match_pattern(&raw, source, "versionPattern", field(source, "versionPatternFlags"));
        }
        if matches.is_empty() {
            if field(p, "id") == "python-windows" {
                python_diagnostic = Some(python_windows_page_diagnostic(&raw, &cleaned));
            }
            continue;
        }
        // Only the selected version match is relevant; release dates are not tracked.
        if field(source,"versionPick") == "highest" { matches.sort_by(|a,b| version_cmp(&b.0,&a.0)); }
        let (raw_version, full_match, groups) = matches.remove(0);
        let format = field(source, "versionFormat");
        let version = if format.is_empty() { raw_version.clone() } else {
            Regex::new(r"\{(\d+)\}").expect("safe regex").replace_all(format, |caps: &regex::Captures| {
                caps.get(1).and_then(|n|n.as_str().parse::<usize>().ok()).and_then(|i|groups.get(i)).map(String::as_str).unwrap_or("").to_owned()
            }).to_string()
        };
        if version.trim().is_empty() { continue; }
        return json!({"ok":true,"sourceId":field(source,"sourceId"),"version":version,"rawVersion":full_match,
            "htmlUrl":source.get("resultUrl").and_then(Value::as_str).unwrap_or(&final_url),
            "transport":if probe_official_html { "official-html" } else { "fetch" },
            "rule":{"type":"official-page"}});
    }
    // For Python only: an unrecognizable HTML response can be served by an
    // intermediary even when a browser retrieves the normal page. The small
    // official RSS contains stable release titles and matching permalinks.
    // Do not promote an unvalidated entry or the configured fallback to online.
    if field(p, "id") == "python-windows" {
        if let Some(version) = check_python_official_rss(client) {
            return json!({"ok":true,"sourceId":field(source,"sourceId"),"version":version,"rawVersion":version,
                "publishedAt":null,"publishedAtText":null,"htmlUrl":p.get("website"),
                "transport":"python-rss","rule":{"type":"python-official-rss-stable"}});
        }
    }
    // Try community WinGet metadata only on an explicit vendor HTTP 403. No
    // browser spoofing, no automatic downloads and no assumed release dates.
    if !any_content && last_fetch_error.as_deref() == Some("HTTP 403") && !probe_official_html {
        if let Some(verified) = check_winget_community_version(p, source, client) {
            return verified;
        }
    }
    // RTSS is often blocked by Guru3D bot protection or receives HTML without
    // a parseable release heading. Unlike other vendors, permit its exact
    // community WinGet version manifest in either case, never a cached constant.
    // Tight per-request budgets keep the entire fallback within the UI's 11s.
    if probe_official_html {
        if let Ok(community_client) = http_client(3000) {
            if let Some(verified) = check_winget_community_version(p, source, &community_client) {
                return verified;
            }
        }
    }
    let reason = if !any_content {
        last_fetch_error.unwrap_or_else(|| "network-error".into())
    } else if field(p, "id") == "python-windows" {
        python_diagnostic.unwrap_or("python-version-not-found").to_owned()
    } else if probe_official_html {
        "official-html-version-not-found".into()
    } else {
        "version-not-found".into()
    };
    configured_fallback(p,source,&reason)
}
#[tauri::command]
async fn check_version(program_id:String,max_timeout_ms:Option<u64>) -> Value {
    let Some(program)=catalog().into_iter().find(|p|field(p,"id")==program_id) else {return default_failure("unknown-program")};
    let sid=field(&program["versionSource"],"sourceId").to_owned();
    let configs=sources();
    let adapter=field(&configs[&sid],"adapter").to_owned();
    if adapter.is_empty() || adapter == "official-page-date" {return default_failure("manual-source")};
    let timeout=max_timeout_ms.unwrap_or(10000).clamp(500,12000);
    tauri::async_runtime::spawn_blocking(move || {
        let source=&program["versionSource"];
        // Guru3D and its index may block automated traffic; reserve enough of
        // the UI's 11-second budget for RTSS's verified WinGet fallback.
        let vendor_timeout = if field(&program,"id") == "rtss" { timeout.min(1800) } else { timeout };
        let Ok(client)=http_client(vendor_timeout) else {return default_failure("network-client")};
        match adapter.as_str() {
            "github-releases"=>check_github(&program,source,&configs,&client),
            "official-page"|"dotnet-official"|"official-download"=>check_official(&program,source,&adapter,&client),
            _=>default_failure("unsupported-adapter")
        }
    }).await.unwrap_or_else(|_|default_failure("worker-error"))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_catalog,get_version_cache,set_version_cache,get_startup_refresh_ids,
            start_version_check_log,append_version_check_log,finish_version_check_log,
            open_external,copy_catalog_text,is_internet_available,check_version,
            minimize_window,toggle_maximize_window,close_window
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start Software Hub Tauri");
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    #[test]
    fn legacy_release_dates_are_dropped_without_losing_cached_versions() {
        let mut entries = Map::new();
        entries.insert("7zip".into(), json!({
            "ok":true, "version":"26.04",
            "publishedAt":"2026-10-01T00:00:00Z", "publishedAtText":"01.10.2026",
            "checkedAt":"2026-10-08T20:00:00Z"
        }));
        let sanitized = sanitize_entries(&entries);
        let saved = sanitized.get("7zip").expect("cached program");
        assert_eq!(field(saved, "version"), "26.04");
        assert_eq!(field(saved, "checkedAt"), "2026-10-08T20:00:00Z");
        assert!(saved.get("publishedAt").is_none());
        assert!(saved.get("publishedAtText").is_none());
    }

    #[test]
    fn winget_fallback_is_only_available_for_allowlisted_vendor_blocked_programs() {
        assert_eq!(winget_package_for("adwcleaner"), Some(("manifests/m/Malwarebytes/AdwCleaner", "Malwarebytes.AdwCleaner")));
        assert_eq!(winget_package_for("afterburner"), Some(("manifests/g/Guru3D/Afterburner", "Guru3D.Afterburner")));
        assert_eq!(winget_package_for("gpu-z"), Some(("manifests/t/TechPowerUp/GPU-Z", "TechPowerUp.GPU-Z")));
        assert_eq!(winget_package_for("nvcleanstall"), Some(("manifests/t/TechPowerUp/NVCleanstall", "TechPowerUp.NVCleanstall")));
        assert_eq!(winget_package_for("cpu-z"), None);
        assert_eq!(winget_package_for("visualcpp"), None);
        assert_eq!(winget_package_for("rtss"), Some(("manifests/g/Guru3D/RTSS", "Guru3D.RTSS")));
        assert_eq!(winget_package_for("java8"), None);
    }

    #[test]
    fn winget_manifest_requires_exact_identity_type_and_directory_version() {
        let valid = "# WinGet manifest\nPackageIdentifier: Malwarebytes.AdwCleaner\nPackageVersion: 8.8.1.639\nManifestType: version\n";
        assert_eq!(winget_confirm_version_manifest(valid, "Malwarebytes.AdwCleaner", "8.8.1.639").as_deref(), Some("8.8.1.639"));
        assert!(winget_confirm_version_manifest(valid, "Guru3D.Afterburner", "8.8.1.639").is_none());
        assert!(winget_confirm_version_manifest(valid, "Malwarebytes.AdwCleaner", "8.8.2.640").is_none());
        assert!(winget_confirm_version_manifest(&valid.replace("ManifestType: version", "ManifestType: installer"), "Malwarebytes.AdwCleaner", "8.8.1.639").is_none());
        assert!(winget_confirm_version_manifest(&format!("{valid}PackageVersion: 999.9.9\n"), "Malwarebytes.AdwCleaner", "8.8.1.639").is_none());
    }

    #[test]
    fn winget_community_version_cannot_invent_vendor_dates_or_accept_beta() {
        let index = json!([
            {"name":"4.6.6", "type":"dir"},
            {"name":"4.6.7-beta", "type":"dir"},
            {"name":"4.6.5", "type":"dir"},
            {"name":"4.6.9", "type":"file"}
        ]);
        assert_eq!(winget_choose_manifest_directory(&index).as_deref(),Some("4.6.6"));
        assert!(winget_choose_manifest_directory(&json!({"message":"Not Found"})).is_none());
        assert_eq!(winget_display_version("adwcleaner", "8.8.1.639").as_deref(),Some("8.8.1"));
        assert_eq!(winget_display_version("afterburner", "4.6.6").as_deref(),Some("4.6.6"));
        assert!(winget_display_version("afterburner", "4.6.7.17352").is_none());
        assert!(winget_display_version("adwcleaner", "8.9.0-beta").is_none());
    }

    #[test]
    fn rtss_winget_fallback_rejects_stale_or_spoofed_manifests() {
        let manifest = "PackageIdentifier: Guru3D.RTSS\nPackageVersion: 7.3.7\nManifestType: version\n";
        assert_eq!(winget_confirm_version_manifest(manifest, "Guru3D.RTSS", "7.3.7").as_deref(), Some("7.3.7"));
        assert!(winget_confirm_version_manifest(manifest, "Guru3D.Afterburner", "7.3.7").is_none());
        assert!(winget_confirm_version_manifest(manifest, "Guru3D.RTSS", "7.3.8").is_none());
        assert_eq!(winget_display_version("rtss", "7.3.7").as_deref(), Some("7.3.7"));
        assert!(winget_display_version("rtss", "7.3.7-beta").is_none());
        assert!(winget_display_version("rtss", "7.3.7.28314").is_none());
        let source=json!({"fallbackVersion":"7.3.7"});
        assert!(!winget_meets_configured_version_floor("rtss", "7.3.6", &source));
        assert!(winget_meets_configured_version_floor("rtss", "7.3.7", &source));
        assert!(winget_meets_configured_version_floor("rtss", "7.3.8", &source));
    }

    #[test]
    fn winget_gpu_z_manifest_version_and_stale_fallback_guard() {
        let manifest = "# WinGet manifest\nPackageIdentifier: TechPowerUp.GPU-Z\nPackageVersion: 2.71.0\nDefaultLocale: en-US\nManifestType: version\nManifestVersion: 1.12.0\n";
        assert_eq!(winget_confirm_version_manifest(manifest, "TechPowerUp.GPU-Z", "2.71.0").as_deref(), Some("2.71.0"));
        assert!(winget_confirm_version_manifest(manifest, "TechPowerUp.GPU-Z", "2.70.0").is_none());
        assert!(winget_confirm_version_manifest(manifest, "TechPowerUp.GPU_Z", "2.71.0").is_none());
        assert_eq!(winget_display_version("gpu-z", "2.71.0").as_deref(), Some("2.71.0"));
        assert!(winget_display_version("gpu-z", "2.71.0.1").is_none());
        assert!(winget_display_version("gpu-z", "2.72.0-beta").is_none());
        let source = json!({"fallbackVersion":"2.71.0"});
        assert!(!winget_meets_configured_version_floor("gpu-z", "2.70.0", &source));
        assert!(winget_meets_configured_version_floor("gpu-z", "2.71.0", &source));
        assert!(winget_meets_configured_version_floor("gpu-z", "2.72.0", &source));
    }

    #[test]
    fn winget_nvcleanstall_exact_manifest_and_stale_community_guard() {
        let manifest = "# WinGet version manifest\nPackageIdentifier: TechPowerUp.NVCleanstall\nPackageVersion: 1.19.0\nDefaultLocale: en-US\nManifestType: version\nManifestVersion: 1.10.0\n";
        assert_eq!(winget_confirm_version_manifest(manifest, "TechPowerUp.NVCleanstall", "1.19.0").as_deref(), Some("1.19.0"));
        assert!(winget_confirm_version_manifest(manifest, "TechPowerUp.NVCleanstall", "1.20.0").is_none());
        assert!(winget_confirm_version_manifest(manifest, "TechPowerUp.GPU-Z", "1.19.0").is_none());
        assert_eq!(winget_display_version("nvcleanstall", "1.19.0").as_deref(), Some("1.19.0"));
        assert!(winget_display_version("nvcleanstall", "1.19.0.1").is_none());
        assert!(winget_display_version("nvcleanstall", "1.20.0-beta").is_none());
        let source = json!({"fallbackVersion":"1.19.0"});
        assert!(!winget_meets_configured_version_floor("nvcleanstall", "1.18.0", &source));
        assert!(winget_meets_configured_version_floor("nvcleanstall", "1.19.0", &source));
        assert!(winget_meets_configured_version_floor("nvcleanstall", "1.20.0", &source));
        assert!(winget_meets_configured_version_floor("adwcleaner", "1.18.0", &source));
    }

    #[test]
    fn cpu_z_streaming_extracts_only_official_classic_x86_x64() {
        let p = catalog().into_iter().find(|p| field(p,"id") == "cpu-z").unwrap();
        let source = &p["versionSource"];
        let html = "<div>Version 99.99 for windows® ARM64</div>\n\
            <script>let title = 'CLASSIC VERSIONS Version 88.88 for windows® x86/x64';</script>\n\
            <h3>CLASSIC VERSIONS</h3><div>Version 3.01 for windows® x86/x64</div>\n\
            <h3>VINTAGE VERSION</h3><div>Version 9.00 for windows® x86/x64</div>";
        assert_eq!(cpu_z_classic_version_from_prefix(html,source).as_deref(),Some("3.01"));
        assert_eq!(cpu_z_classic_version_from_prefix("<h3>CLASSIC VERSIONS</h3>Version 3.01 for Android",source),None);
        assert_eq!(cpu_z_classic_version_from_prefix("Version 3.01 for windows® x86/x64",source),None);
        assert_eq!(cpu_z_classic_version_from_prefix("<h3>VINTAGE VERSION</h3>Version 1.04 for windows® x86/x64",source),None);
        assert_eq!(cpu_z_classic_version_from_prefix("<script>CLASSIC VERSIONS Version 9.99 for windows® x86/x64",source),None);
        assert_eq!(cpu_z_classic_version_from_prefix("<h3>CLASSIC VERSIONS</h3><p>Version 4.04 for windows® ARM64</p>",source),None);
        assert_eq!(cpu_z_classic_version_from_prefix("<h3>CLASSIC VERSIONS</h3>Version 3.02 for windows&reg; x86/x64",source).as_deref(),Some("3.02"));
        assert!(!same_official_page("https://www.cpuid.com/softwares/cpu-z.html","https://evil.example/softwares/cpu-z.html"));
    }

    #[test]
    fn cpu_z_stream_reads_chunks_then_stops_before_trailing_body() {
        struct SlowTail { bytes: Vec<u8>, index: usize, calls: usize }
        impl Read for SlowTail {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                self.calls += 1;
                if self.index >= self.bytes.len() { panic!("must not read slow trailing body"); }
                let count = buffer.len().min(5).min(self.bytes.len()-self.index);
                buffer[..count].copy_from_slice(&self.bytes[self.index..self.index+count]);
                self.index += count;
                Ok(count)
            }
        }
        let source = json!({"versionPattern": r"Version\s+(\d+(?:\.\d+){1,3})\s+for\s+windows(?:®|&reg;|&#174;)?\s*x86\s*/\s*x64\b", "versionPatternFlags":"i"});
        let mut reader = SlowTail { bytes: b"<h3>CLASSIC VERSIONS</h3><p>Version 3.02 for windows&reg; x86/x64</p>".to_vec(), index:0, calls:0 };
        assert_eq!(read_cpu_z_classic_early(&mut reader,&source).unwrap().as_deref(),Some("3.02"));
        assert!(reader.calls > 2);
    }

    #[test]
    fn cpu_z_stream_never_promotes_truncated_unrelated_page() {
        let p = catalog().into_iter().find(|p| field(p,"id") == "cpu-z").unwrap();
        let source = &p["versionSource"];
        let mut reader = std::io::Cursor::new(b"<h3>CUSTOM VERSIONS</h3> Version 4.00 for windows x86/x64");
        assert_eq!(read_cpu_z_classic_early(&mut reader,source).unwrap(), None);
        let mut too_large = std::io::Cursor::new(vec![b'x'; CPU_Z_PREFIX_LIMIT_BYTES + 200]);
        assert_eq!(read_cpu_z_classic_early(&mut too_large,source).unwrap_err(),"Response too large");
    }

    #[test]
    fn head_download_metadata_does_not_trigger_html_size_limit_or_read_body() {
        struct NoRead;
        impl Read for NoRead {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                panic!("HEAD must not read an installer body");
            }
        }
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::CONTENT_LENGTH, reqwest::header::HeaderValue::from_static("150000000"));
        headers.insert(reqwest::header::CONTENT_DISPOSITION, reqwest::header::HeaderValue::from_static("attachment; filename=Radmin_VPN_2.1.4951.1.exe"));
        assert_eq!(read_response_body_limited(&mut NoRead, &headers, &reqwest::Method::HEAD).unwrap(), "");
        assert!(headers.get(reqwest::header::CONTENT_DISPOSITION).is_some());
    }

    #[test]
    fn rendered_html_probe_only_accepts_exact_official_document() {
        assert!(same_official_page("https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/",
            "https://guru3d.com/download/rtss-rivatuner-statistics-server-download/"));
        assert!(same_official_page("https://www.techpowerup.com/download/visual-c-redistributable-runtime-package-all-in-one/",
            "https://www.techpowerup.com/download/visual-c-redistributable-runtime-package-all-in-one/"));
        for candidate in [
            "http://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/",
            "https://guru3d.com/files/detonator/",
            "https://evil.example/download/rtss-rivatuner-statistics-server-download/",
            "https://guru3d.com/download/rtss-rivatuner-statistics-server-download/?other=1",
        ] {
            assert!(!same_official_page("https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/", candidate), "{candidate}");
        }
    }

    #[test]
    fn rtss_official_index_requires_exact_link_and_matching_release_title() {
        let p = catalog().into_iter().find(|p| field(p,"id") == "rtss").unwrap();
        let source=&p["versionSource"];
        let base="https://www.guru3d.com/pages/";
        let good=r#"<a href='/download/rtss-rivatuner-statistics-server-download/'>Guru3D RTSS Rivatuner Statistics Server Download 7.3.7</a>"#;
        assert_eq!(rtss_version_from_official_index(good,base,source).as_deref(),Some("7.3.7"));
        for unsafe_html in [
            r#"<a href='/downloads/other/'>Guru3D RTSS Rivatuner Statistics Server Download 8.8.8</a>"#,
            r#"<a href='https://attacker.example/download/rtss-rivatuner-statistics-server-download/'>Guru3D RTSS Rivatuner Statistics Server Download 8.8.8</a>"#,
            r#"<a href='/download/rtss-rivatuner-statistics-server-download/'>MSI Afterburner 7.3.8</a>"#,
            r#"<p>RTSS Rivatuner Statistics Server Download 7.3.8</p>"#
        ] {
            assert_eq!(rtss_version_from_official_index(unsafe_html,base,source),None,"{unsafe_html}");
        }
    }

    #[test]
    fn rtss_html_probe_finds_only_official_release_title_not_other_downloads() {
        let p = catalog().into_iter().find(|p| field(p, "id") == "rtss").unwrap();
        let source = &p["versionSource"];
        let page = "<h1>Guru3D RTSS Rivatuner Statistics Server Download 7.3.7</h1>\n<p>MSI Afterburner 4.6.8 / NVIDIA driver 999.99</p>";
        let matches = match_pattern(&strip_html(page), source, "versionPattern", field(source, "versionPatternFlags"));
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].0, "7.3.7");
        let unrelated = "<h1>MSI Afterburner 7.3.8</h1><p>Rivatuner is a different product</p>";
        assert!(match_pattern(&strip_html(unrelated), source, "versionPattern", field(source, "versionPatternFlags")).is_empty());
    }







    #[test]
    fn visualcpp_stays_manual_without_version_metadata() {
        let p = catalog().into_iter().find(|p| field(p, "id") == "visualcpp").unwrap();
        let s = &p["versionSource"];
        assert!(field(s, "sourceId").is_empty());
        assert!(s.get("url").is_none());
        assert!(s.get("fallbackVersion").is_none());
        assert_eq!(s.get("showLatestVersion").and_then(Value::as_bool), Some(false));
        assert_eq!(s.get("showSource").and_then(Value::as_bool), Some(false));
        assert!(!source_is_automatic(&p, &sources()));
        assert_eq!(field(&p, "website"), "https://www.techpowerup.com/download/visual-c-redistributable-runtime-package-all-in-one/");
    }

    #[test]
    fn get_responses_remain_strictly_size_bounded() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::CONTENT_LENGTH, reqwest::header::HeaderValue::from_static("150000000"));
        let message = read_response_body_limited(&mut std::io::Cursor::new(b"small"), &headers, &reqwest::Method::GET).unwrap_err();
        assert_eq!(message, "Response too large");

        let mut stream = std::io::Cursor::new(vec![b'x'; MAX_NETWORK_BYTES + 1]);
        let message = read_response_body_limited(&mut stream, &reqwest::header::HeaderMap::new(), &reqwest::Method::GET).unwrap_err();
        assert_eq!(message, "Response too large");
    }


    #[test]
    fn newest_verified_timestamp_wins_over_later_failed_attempt() {
        let verified = json!({"checkedAt":"2026-10-08T09:00:00Z","lastAttemptAt":"2026-10-08T09:00:00Z","ok":true});
        let failed = json!({"checkedAt":null,"lastAttemptAt":"2026-10-08T11:00:00Z","ok":false});
        assert_eq!(choose_cache_entry(&verified, &failed), &verified);
    }

    #[test]
    fn most_recent_attempt_breaks_equal_verification_timestamps() {
        let first = json!({"checkedAt":"2026-10-08T09:00:00Z","lastAttemptAt":"2026-10-08T09:01:00Z"});
        let second = json!({"checkedAt":"2026-10-08T09:00:00Z","lastAttemptAt":"2026-10-08T09:02:00Z"});
        assert_eq!(choose_cache_entry(&first, &second), &second);
    }

    #[test]
    fn partial_ui_snapshot_does_not_delete_other_cached_programs() {
        let stored = serde_json::from_value::<Map<String, Value>>(json!({
            "alpha":{"checkedAt":"2026-10-08T09:00:00Z","ok":true},
            "beta":{"checkedAt":"2026-10-08T08:00:00Z","ok":true}
        })).unwrap();
        let incoming = serde_json::from_value::<Map<String, Value>>(json!({
            "alpha":{"checkedAt":"2026-10-08T10:00:00Z","ok":true}
        })).unwrap();
        let merged = merge_cache_entries(&stored, &incoming);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged["beta"], stored["beta"]);
        assert_eq!(merged["alpha"], incoming["alpha"]);
    }
    #[test]
    fn legacy_configured_fallback_never_counts_as_fresh() {
        let now = Utc::now().to_rfc3339();
        // An otherwise valid cache entry must include a confirmed program version.
        let without_version = json!({"ok":true,"checkedAt":now});
        assert!(!was_recently_verified(&without_version));
        let verified = json!({"ok":true,"checkedAt":now,"version":"1.2.3"});
        assert!(was_recently_verified(&verified));
        let legacy = json!({"ok":true,"checkedAt":now,"version":"1.2.3","transport":"configured-fallback-timeout"});
        assert!(!was_recently_verified(&legacy));
        let tagged = json!({"ok":true,"checkedAt":now,"version":"1.2.3","verification":"configured-fallback"});
        assert!(!was_recently_verified(&tagged));
    }

    #[test]
    fn on_disk_save_merges_entries_and_recovers_from_backup() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let folder = std::env::temp_dir().join(format!("shub-cache-test-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let path = folder.join("version-cache.json");
        // These IDs exist in the real embedded catalog and survive sanitation.
        let first = serde_json::from_value::<Map<String, Value>>(json!({
            "7zip":{"ok":true,"checkedAt":"2026-10-08T09:00:00Z"},
            "cpu-z":{"ok":true,"checkedAt":"2026-10-08T09:00:00Z"}
        })).unwrap();
        let second = serde_json::from_value::<Map<String, Value>>(json!({
            "7zip":{"ok":true,"checkedAt":"2026-10-08T10:00:00Z"}
        })).unwrap();
        write_cache_to(&path, &first).unwrap();
        write_cache_to(&path, &second).unwrap();
        let current = read_cache_from(&path);
        assert_eq!(current.len(), 2);
        assert_eq!(current["7zip"], second["7zip"]);
        assert_eq!(current["cpu-z"], first["cpu-z"]);
        assert!(path.with_extension("json.bak").is_file());
        // Simulate bit corruption after a successful save; valid previous data
        // must still be recoverable without touching the user's real cache.
        std::fs::write(&path, b"{ broken JSON").unwrap();
        let recovered = read_cache_from(&path);
        assert_eq!(recovered.len(), 2);
        assert_eq!(recovered["7zip"], first["7zip"]);
        std::fs::remove_dir_all(&folder).unwrap();
    }


    #[test]
    fn configured_fallback_does_not_promote_legacy_dates_to_verified_results() {
        let p = json!({"website":"https://example.test/"});
        let source = json!({"sourceId":"official-page","fallbackVersion":"14.51.36247.0",
            "fallbackPublishedAt":"2025-01-01T00:00:00.000Z","fallbackPublishedAtText":"01.01.2025"});
        let result = configured_fallback(&p, &source, "version-not-found");
        assert_eq!(field(&result, "version"), "14.51.36247.0");
        assert_eq!(field(&result, "verification"), "configured-fallback");
        assert_eq!(result["fallback"], true);
        assert!(result.get("publishedAt").is_none());
        assert!(result.get("publishedAtText").is_none());
    }

    #[test]
    fn date_text_does_not_count_as_an_explicit_version_match() {
        let source = json!({"versionPattern":r"version\s+(\d+\.\d+\.\d+)"});
        assert!(match_pattern("Release date: 2026-10-07", &source, "versionPattern", "i").is_empty());
        let versions = match_pattern("Release date: 2026-10-07; version 2.71.0", &source, "versionPattern", "i");
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].0, "2.71.0");
    }

    #[test]
    fn official_page_selects_highest_version_without_parsing_date_labels() {
        let source = json!({"versionPattern":r"K-Lite\s+(\d+\.\d+\.\d+)\s+[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s+\d{4}",
            "versionPick":"highest"});
        let page = "K-Lite 19.9.0 September 12th 2026 K-Lite 20.0.0 October 7th 2026";
        let mut versions = match_pattern(page, &source, "versionPattern", "i");
        versions.sort_by(|a, b| version_cmp(&b.0, &a.0));
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].0, "20.0.0");
        assert_eq!(versions[1].0, "19.9.0");
    }

    #[test]
    fn numeric_build_versions_are_not_required_to_be_calendar_dates() {
        let source = json!({"versionPattern":r"build\s+(\d{6})", "versionPick":"highest"});
        let mut versions = match_pattern("build 260230 and build 261007", &source, "versionPattern", "i");
        versions.sort_by(|a, b| version_cmp(&b.0, &a.0));
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].0, "261007");
        assert_eq!(versions[1].0, "260230");
    }

    #[test]
    fn check_log_tracks_progress_and_preserves_completion_after_reopen() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("shub-checklog-test-{}-{unique}",std::process::id()));
        let id = start_check_log_in(&dir,"manual",2).unwrap();
        assert!(safe_log_name(&id));
        let mut text = fs::read_to_string(dir.join(&id)).unwrap();
        assert!(text.contains("Статус: выполняется"));
        let event=json!({"programId":"7zip","status":"error","oldVersion":"1.0", "newVersion":"1.0", "reason":"HTTP 403\nhttps://example.test/?token=private", "transport":"GET"});
        append_check_log_in(&dir,&id,&event).unwrap();
        text=fs::read_to_string(dir.join(&id)).unwrap();
        assert!(text.contains("HTTP 403"));
        assert!(!text.contains("example.test"));
        assert!(!text.contains("private"));
        assert!(!text.contains("HTTP 403\n"));
        finish_check_log_in(&dir,&id,&json!({"status":"completed","unchanged":1,"errors":1,"cacheStatus":"OK"})).unwrap();
        assert!(fs::read_to_string(dir.join(&id)).unwrap().contains("--- ИТОГ ---"));
        assert!(append_check_log_in(&dir,"../escape.txt",&event).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
    #[test]
    fn check_log_rotation_keeps_latest_forty_and_ignores_foreign_files() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("shub-checklog-rotation-{}-{unique}",std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("notes.txt"),"keep").unwrap();
        for _ in 0..(MAX_CHECK_LOGS+5) { start_check_log_in(&dir,"background",1).unwrap(); }
        assert_eq!(fs::read_dir(&dir).unwrap().count(),MAX_CHECK_LOGS+1);
        assert!(dir.join("notes.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
    #[test]
    fn python_windows_latest_stable_release_handles_encoded_separators() {
        let program = catalog().into_iter().find(|p| field(p, "id") == "python-windows").unwrap();
        let source = &program["versionSource"];
        assert_eq!(field(source, "fallbackVersion"), "3.14.7");
        let examples = [
            "<li>Latest Python install manager - Python install manager 26.3</li><li>Latest Python 3 Release - Python 3.14.8</li><h2>Pre-releases</h2><li>Python 3.15.0rc3</li>",
            "<p>Latest Python 3 Release &ndash; Python 3.14.8</p><p>Python 3.15.0rc3</p>",
            "<p>Latest Python 3 Release &#8211; Python 3.14.8</p>",
            "<p>Latest Python 3 Release — Python 3.14.8</p>",
            "<p>Latest Python 3 Release Python 3.14.8</p>",
        ];
        for html in examples {
            let cleaned = strip_html(html);
            let matched = match_pattern(&cleaned, source, "versionPattern", "i");
            assert_eq!(matched.first().map(|m| m.0.as_str()), Some("3.14.8"), "{html}");
        }
        for html in [
            "Latest Python install manager - Python install manager 26.3 Stable Releases Python 3.13.16",
            "Latest Python 3 Release - Python 3.15.0rc3",
            "Pre-releases Python 3.15.0rc3",
        ] {
            let matched = match_pattern(&strip_html(html), source, "versionPattern", "i");
            assert!(matched.is_empty(), "must not confirm unrelated or prerelease Python: {html}");
        }
    }

    #[test]
    fn python_official_rss_selects_highest_proven_stable_release_only() {
        let rss = r#"<?xml version="1.0"?><rss version="2.0"><channel>
          <title>Python Releases</title>
          <item><title>Python 3.13.16</title><link>https://www.python.org/downloads/release/python-31316/</link></item>
          <item><title>Python 3.15.0rc3</title><link>https://www.python.org/downloads/release/python-3150rc3/</link></item>
          <item><title>Python 3.14.8</title><link>https://www.python.org/downloads/release/python-3148/</link></item>
          <item><title>Python 3.14.7</title><link>https://www.python.org/downloads/release/python-3147/</link></item>
        </channel></rss>"#;
        assert_eq!(python_rss_stable_version(rss).as_deref(), Some("3.14.8"));
    }
    #[test]
    fn python_official_rss_rejects_unrelated_or_unverifiable_versions() {
        let invalid = r#"<rss><channel>
          <item><title>Python 3.99.0</title><link>https://evil.example/downloads/release/python-3990/</link></item>
          <item><title>Python 3.98.0</title><link>https://www.python.org/downloads/release/python-3970/</link></item>
          <item><title>Python 3.15.0b1</title><link>https://www.python.org/downloads/release/python-3150b1/</link></item>
          <item><title>Python 3.96.0</title><description>https://www.python.org/downloads/release/python-3960/</description></item>
          <item><title>Python 3.95.0</title><link>http://www.python.org/downloads/release/python-3950/</link></item>
        </channel></rss>"#;
        assert_eq!(python_rss_stable_version(invalid), None);
        assert_eq!(python_rss_stable_version("<html>Python 3.14.8</html>"), None);
    }

    #[test]
    fn python_page_diagnostics_reveal_safe_failure_category_without_response_body() {
        assert_eq!(python_windows_page_diagnostic("  ", ""), "python-empty-response");
        assert_eq!(python_windows_page_diagnostic("<html>Just a moment...</html>", "Just a moment..."), "python-page-access-challenge");
        assert_eq!(python_windows_page_diagnostic("<html>Latest Python 3 Release - unavailable</html>", "Latest Python 3 Release - unavailable"), "python-header-present-pattern-miss");
        assert_eq!(python_windows_page_diagnostic("<h2>Stable Releases</h2>", "Stable Releases"), "python-stable-section-without-header");
        assert_eq!(python_windows_page_diagnostic("<title>Python Releases for Windows</title>", "Python Releases for Windows"), "python-windows-page-unexpected-layout");
        assert_eq!(python_windows_page_diagnostic("<html>unknown</html>", "unknown"), "python-unexpected-response");
        let source = "<html>access_token=private-value</html>";
        assert!(!python_windows_page_diagnostic(source, "access_token=private-value").contains("private-value"));
    }

    #[test]
    fn network_report_reasons_are_safe_and_still_useful() {
        assert_eq!(public_network_error("HTTP 403"),"HTTP 403");
        assert_eq!(public_network_error("error sending request for url (https://secret.test/token=abc): timed out"),"network-timeout");
        assert_eq!(public_network_error("error sending request for url (https://secret.test)"),"network-error");
    }

}
