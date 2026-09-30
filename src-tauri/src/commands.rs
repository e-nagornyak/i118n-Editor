use crate::store::{ConfigStore, Language, Project};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;
use tauri::Manager;

// Global store — created lazily on first access; cheap and thread-safe.
fn store() -> &'static ConfigStore {
    static S: OnceLock<ConfigStore> = OnceLock::new();
    S.get_or_init(ConfigStore::new)
}

// ── JSON format detection / (de)serialization ────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonFormat {
    // `null` → compact single-line. Numeric = spaces. "\t" via string.
    #[serde(default)]
    pub indent: serde_json::Value,
    #[serde(default = "default_eol")]
    pub eol: String,
    #[serde(default = "def_true")]
    pub trailing: bool,
}

fn default_eol() -> String { "\n".into() }
fn def_true() -> bool { true }

impl Default for JsonFormat {
    fn default() -> Self {
        Self { indent: serde_json::json!(2), eol: "\n".into(), trailing: true }
    }
}

fn detect_format(content: &str) -> JsonFormat {
    let eol = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let trailing = content.trim_end_matches(|c: char| c.is_whitespace()).len() < content.len();
    for line in content.split('\n') {
        let bytes = line.as_bytes();
        if bytes.is_empty() { continue; }
        let mut i = 0;
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') { i += 1; }
        if i == 0 || i == bytes.len() { continue; }
        if bytes[0] == b'\t' {
            return JsonFormat { indent: serde_json::json!("\t"), eol: eol.into(), trailing };
        }
        return JsonFormat { indent: serde_json::json!(i as u64), eol: eol.into(), trailing };
    }
    JsonFormat { indent: Value::Null, eol: eol.into(), trailing }
}

fn stringify_with_format(v: &Value, fmt: &JsonFormat) -> String {
    let mut s = match &fmt.indent {
        Value::Null => serde_json::to_string(v).unwrap_or_default(),
        Value::Number(n) => {
            let n = n.as_u64().unwrap_or(2) as usize;
            let indent = " ".repeat(n);
            let formatter = serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes());
            let mut buf = Vec::new();
            let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
            v.serialize(&mut ser).ok();
            String::from_utf8(buf).unwrap_or_default()
        }
        Value::String(s) if s == "\t" => {
            let formatter = serde_json::ser::PrettyFormatter::with_indent(b"\t");
            let mut buf = Vec::new();
            let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
            v.serialize(&mut ser).ok();
            String::from_utf8(buf).unwrap_or_default()
        }
        _ => serde_json::to_string_pretty(v).unwrap_or_default(),
    };
    if fmt.eol == "\r\n" {
        s = s.replace('\n', "\r\n");
    }
    if fmt.trailing {
        s.push_str(&fmt.eol);
    }
    s
}

// ── flatten / unflatten ─────────────────────────────────────────────────────

fn flatten(v: &Value, prefix: &str, out: &mut BTreeMap<String, String>) {
    match v {
        Value::Object(map) => {
            for (k, vv) in map {
                let key = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
                flatten(vv, &key, out);
            }
        }
        Value::Array(arr) => {
            for (i, vv) in arr.iter().enumerate() {
                let key = if prefix.is_empty() { i.to_string() } else { format!("{prefix}.{i}") };
                flatten(vv, &key, out);
            }
        }
        Value::Null => { out.insert(prefix.to_string(), String::new()); }
        Value::Bool(b) => { out.insert(prefix.to_string(), b.to_string()); }
        Value::Number(n) => { out.insert(prefix.to_string(), n.to_string()); }
        Value::String(s) => { out.insert(prefix.to_string(), s.clone()); }
    }
}

fn unflatten(flat: &BTreeMap<String, String>) -> Value {
    let mut root = Value::Object(serde_json::Map::new());
    for (dot_key, val) in flat {
        let parts: Vec<&str> = dot_key.split('.').collect();
        insert_path(&mut root, &parts, val);
    }
    arrayify(root)
}

fn insert_path(cur: &mut Value, parts: &[&str], val: &str) {
    if parts.is_empty() { return; }
    if parts.len() == 1 {
        if let Value::Object(m) = cur {
            m.insert(parts[0].to_string(), Value::String(val.to_string()));
        }
        return;
    }
    if let Value::Object(m) = cur {
        let entry = m.entry(parts[0].to_string()).or_insert_with(|| Value::Object(serde_json::Map::new()));
        if !matches!(entry, Value::Object(_)) {
            *entry = Value::Object(serde_json::Map::new());
        }
        insert_path(entry, &parts[1..], val);
    }
}

fn arrayify(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            let all_num = !map.is_empty() && map.keys().all(|k| k.chars().all(|c| c.is_ascii_digit()));
            if all_num {
                let mut pairs: Vec<(usize, Value)> = map
                    .into_iter()
                    .filter_map(|(k, v)| k.parse::<usize>().ok().map(|n| (n, arrayify(v))))
                    .collect();
                pairs.sort_by_key(|(n, _)| *n);
                Value::Array(pairs.into_iter().map(|(_, v)| v).collect())
            } else {
                Value::Object(map.into_iter().map(|(k, v)| (k, arrayify(v))).collect())
            }
        }
        other => other,
    }
}

// ── Commands: file system ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ScannedFile {
    pub code: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
}

#[derive(Debug, Serialize)]
pub struct ScanResult {
    pub files: Vec<ScannedFile>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn scan_locales(dir_path: String) -> ScanResult {
    let dir = Path::new(&dir_path);
    let read = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(e) => return ScanResult { files: vec![], error: Some(e.to_string()) },
    };
    let mut files = vec![];
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let name = match path.file_name().and_then(|s| s.to_str()) { Some(n) => n, None => continue };
        if !name.to_lowercase().ends_with(".json") { continue; }
        let code = name[..name.len() - 5].to_string();
        files.push(ScannedFile { code, file_path: path.to_string_lossy().into_owned() });
    }
    ScanResult { files, error: None }
}

#[derive(Debug, Serialize)]
pub struct ReadResult {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub content: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn read_files(file_paths: Vec<String>) -> Vec<ReadResult> {
    file_paths
        .par_iter()
        .map(|fp| match std::fs::read_to_string(fp) {
            Ok(c) => ReadResult { file_path: fp.clone(), content: Some(c), error: None },
            Err(e) => ReadResult { file_path: fp.clone(), content: None, error: Some(e.to_string()) },
        })
        .collect()
}

#[derive(Debug, Serialize)]
pub struct WriteResult {
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn write_file(file_path: String, content: String) -> WriteResult {
    if let Some(parent) = Path::new(&file_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&file_path, content) {
        Ok(_) => WriteResult { success: true, error: None },
        Err(e) => WriteResult { success: false, error: Some(e.to_string()) },
    }
}

#[derive(Debug, Deserialize)]
pub struct SaveLocalePayload {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub flat: BTreeMap<String, String>,
    #[serde(default)]
    pub format: Option<JsonFormat>,
}

#[derive(Debug, Serialize)]
pub struct SaveLocaleResult {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn save_locales(payload: Vec<SaveLocalePayload>) -> Vec<SaveLocaleResult> {
    payload
        .into_par_iter()
        .map(|p| {
            let fmt = p.format.unwrap_or_default();
            let obj = unflatten(&p.flat);
            let content = stringify_with_format(&obj, &fmt);
            if let Some(parent) = Path::new(&p.file_path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::write(&p.file_path, content) {
                Ok(_) => SaveLocaleResult { file_path: p.file_path, success: true, error: None },
                Err(e) => SaveLocaleResult { file_path: p.file_path, success: false, error: Some(e.to_string()) },
            }
        })
        .collect()
}

// ── Combined loader: scan + read + flatten + stats in one round-trip ─────────

#[derive(Debug, Serialize)]
pub struct LoadedLang {
    pub code: String,
    pub flat: BTreeMap<String, String>,
    pub format: JsonFormat,
    pub filled: usize,
}

#[derive(Debug, Serialize)]
pub struct LoadProjectResult {
    pub translations: BTreeMap<String, BTreeMap<String, String>>,
    pub formats: BTreeMap<String, JsonFormat>,
    pub all_keys: Vec<String>,
    pub filled: BTreeMap<String, usize>,
    pub missing_total: usize,
    pub project: Project,
    pub added_languages: Vec<Language>,
}

#[tauri::command]
pub fn load_project(mut project: Project) -> LoadProjectResult {
    let mut added: Vec<Language> = vec![];

    // Sync locales folder — attach filePath to matching codes, add newcomers.
    if let Some(dir) = project.locales_path.clone() {
        let scan = scan_locales(dir.clone());
        if scan.error.is_none() {
            let existing_codes: std::collections::HashSet<String> =
                project.languages.iter().map(|l| l.code.clone()).collect();
            let by_code: std::collections::HashMap<String, String> = scan
                .files
                .iter()
                .map(|f| (f.code.clone(), f.file_path.clone()))
                .collect();

            for lang in project.languages.iter_mut() {
                if lang.file_path.is_none() {
                    if let Some(p) = by_code.get(&lang.code) {
                        lang.file_path = Some(p.clone());
                    }
                }
            }
            for f in &scan.files {
                if !existing_codes.contains(&f.code) {
                    let new_lang = Language {
                        code: f.code.clone(),
                        label: f.code.to_uppercase(),
                        flag: None,
                        translator_code: None,
                        file_path: Some(f.file_path.clone()),
                    };
                    added.push(new_lang.clone());
                    project.languages.push(new_lang);
                }
            }
        }
    }

    // Parallel read + parse + flatten.
    let per_lang: Vec<LoadedLang> = project
        .languages
        .par_iter()
        .map(|l| {
            let (flat, format) = match &l.file_path {
                Some(fp) => match std::fs::read_to_string(fp) {
                    Ok(content) => {
                        let format = detect_format(&content);
                        match serde_json::from_str::<Value>(&content) {
                            Ok(v) => {
                                let mut m = BTreeMap::new();
                                flatten(&v, "", &mut m);
                                (m, format)
                            }
                            Err(_) => (BTreeMap::new(), format),
                        }
                    }
                    Err(_) => (BTreeMap::new(), JsonFormat::default()),
                },
                None => (BTreeMap::new(), JsonFormat::default()),
            };
            let filled = flat.values().filter(|v| !v.is_empty()).count();
            LoadedLang { code: l.code.clone(), flat, format, filled }
        })
        .collect();

    let mut translations = BTreeMap::new();
    let mut formats = BTreeMap::new();
    let mut filled = BTreeMap::new();
    let mut key_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for l in per_lang {
        for k in l.flat.keys() { key_set.insert(k.clone()); }
        filled.insert(l.code.clone(), l.filled);
        formats.insert(l.code.clone(), l.format);
        translations.insert(l.code, l.flat);
    }
    let all_keys: Vec<String> = key_set.into_iter().collect();

    let mut missing_total = 0usize;
    for lang in &project.languages {
        let m = translations.get(&lang.code);
        for k in &all_keys {
            let empty = m.map(|mm| mm.get(k).map(|v| v.is_empty()).unwrap_or(true)).unwrap_or(true);
            if empty { missing_total += 1; }
        }
    }

    LoadProjectResult { translations, formats, all_keys, filled, missing_total, project, added_languages: added }
}

// ── Diff computation for the "rewrite all" preview ───────────────────────────

#[derive(Debug, Serialize)]
pub struct LangDiff {
    pub lang: String,
    pub label: String,
    #[serde(rename = "newFile")]
    pub new_file: bool,
    pub added: Vec<String>,
    pub changed: Vec<String>,
    pub deleted: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct DiffInput {
    pub languages: Vec<Language>,
    pub translations: BTreeMap<String, BTreeMap<String, String>>,
}

#[tauri::command]
pub fn compute_diff(input: DiffInput) -> (Vec<LangDiff>, BTreeMap<String, JsonFormat>) {
    let mut formats: BTreeMap<String, JsonFormat> = BTreeMap::new();

    let diffs: Vec<LangDiff> = input
        .languages
        .par_iter()
        .map(|lang| {
            let current = input.translations.get(&lang.code).cloned().unwrap_or_default();
            let Some(fp) = lang.file_path.as_ref() else {
                return (
                    lang.code.clone(),
                    None,
                    LangDiff {
                        lang: lang.code.clone(), label: lang.label.clone(),
                        new_file: true, added: vec![], changed: vec![], deleted: vec![],
                    },
                );
            };
            let (existing, fmt) = match std::fs::read_to_string(fp) {
                Ok(c) => {
                    let format = detect_format(&c);
                    match serde_json::from_str::<Value>(&c) {
                        Ok(v) => { let mut m = BTreeMap::new(); flatten(&v, "", &mut m); (m, Some(format)) }
                        Err(_) => (BTreeMap::new(), Some(format)),
                    }
                }
                Err(_) => (BTreeMap::new(), None),
            };
            let added: Vec<String> = current.keys().filter(|k| !existing.contains_key(*k)).cloned().collect();
            let deleted: Vec<String> = existing.keys().filter(|k| !current.contains_key(*k)).cloned().collect();
            let changed: Vec<String> = current
                .iter()
                .filter(|(k, v)| existing.get(*k).map(|e| e != *v).unwrap_or(false))
                .map(|(k, _)| k.clone())
                .collect();
            (
                lang.code.clone(), fmt,
                LangDiff { lang: lang.code.clone(), label: lang.label.clone(), new_file: false, added, changed, deleted },
            )
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|(code, fmt, d)| { if let Some(f) = fmt { formats.insert(code, f); } d })
        .collect();

    (diffs, formats)
}

// ── Stats — cheap recompute after mutations ──────────────────────────────────

#[derive(Debug, Serialize)]
pub struct StatsResult {
    pub all_keys: Vec<String>,
    pub filled: BTreeMap<String, usize>,
    pub missing_total: usize,
    pub namespace_missing: BTreeMap<String, usize>,
}

#[derive(Debug, Deserialize)]
pub struct StatsInput {
    pub translations: BTreeMap<String, BTreeMap<String, String>>,
    pub languages: Vec<String>,
}

#[tauri::command]
pub fn compute_stats(input: StatsInput) -> StatsResult {
    let mut key_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for m in input.translations.values() {
        for k in m.keys() { key_set.insert(k.clone()); }
    }
    let all_keys: Vec<String> = key_set.into_iter().collect();

    let mut filled: BTreeMap<String, usize> = BTreeMap::new();
    for code in &input.languages {
        let m = input.translations.get(code);
        let mut n = 0usize;
        for k in &all_keys {
            if let Some(mm) = m {
                if let Some(v) = mm.get(k) {
                    if !v.is_empty() { n += 1; }
                }
            }
        }
        filled.insert(code.clone(), n);
    }

    let mut missing_total = 0usize;
    let mut namespace_missing: BTreeMap<String, usize> = BTreeMap::new();
    for k in &all_keys {
        let mut any_missing = false;
        for code in &input.languages {
            let m = input.translations.get(code);
            let empty = m.map(|mm| mm.get(k).map(|v| v.is_empty()).unwrap_or(true)).unwrap_or(true);
            if empty { missing_total += 1; any_missing = true; }
        }
        if any_missing {
            let parts: Vec<&str> = k.split('.').collect();
            for i in 1..parts.len() {
                let ns = parts[..i].join(".");
                *namespace_missing.entry(ns).or_insert(0) += 1;
            }
        }
    }

    StatsResult { all_keys, filled, missing_total, namespace_missing }
}

// ── Project store ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_projects() -> Vec<Project> {
    store().read().projects
}

#[tauri::command]
pub fn save_project(project: Project) -> Result<bool, String> {
    let mut cfg = store().read();
    if let Some(i) = cfg.projects.iter().position(|p| p.id == project.id) {
        cfg.projects[i] = project;
    } else {
        cfg.projects.push(project);
    }
    store().write(&cfg).map(|_| true)
}

#[tauri::command]
pub fn delete_project(id: String) -> Result<bool, String> {
    let mut cfg = store().read();
    cfg.projects.retain(|p| p.id != id);
    if cfg.last_project_id.as_deref() == Some(id.as_str()) {
        cfg.last_project_id = cfg.projects.first().map(|p| p.id.clone());
    }
    store().write(&cfg).map(|_| true)
}

#[tauri::command]
pub fn get_last_project() -> Option<String> {
    store().read().last_project_id
}

#[tauri::command]
pub fn set_last_project(id: Option<String>) -> Result<bool, String> {
    let mut cfg = store().read();
    cfg.last_project_id = id;
    store().write(&cfg).map(|_| true)
}

// ── Splash orchestration ─────────────────────────────────────────────────────

#[tauri::command]
pub fn app_ready(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
}
