use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &[
    "node_modules", "dist", "build", "target", "out", "coverage", "vendor", "Pods",
    "DerivedData", "bower_components", "storybook-static",
];
const CODE_EXTS: &[&str] = &[
    "js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte", "astro", "html", "php", "py",
    "rb", "erb", "go", "rs", "dart", "swift", "kt", "java", "hbs", "liquid", "twig",
];
const PLURAL_SUFFIXES: &[&str] = &["_zero", "_one", "_two", "_few", "_many", "_other", "_plural"];
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct UsageInput {
    pub root: String,
    pub keys: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct MissingRef {
    pub key: String,
    pub file: String,
    pub line: usize,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct UsageResult {
    pub files_scanned: usize,
    pub unused: Vec<String>,
    /// Keys only reachable through a dynamic prefix like `status.${x}` —
    /// probably used, but we can't prove it statically.
    pub dynamic: Vec<String>,
    pub missing: Vec<MissingRef>,
}

#[derive(Default)]
struct FileScan {
    literals: HashSet<String>,
    prefixes: HashSet<String>,
    refs: Vec<(String, usize)>,
}

fn re_literal() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"["'`]([A-Za-z0-9_][\w.:\-]*)["'`]"#).unwrap())
}
fn re_prefix() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(?:`([A-Za-z_][\w.:\-]*\.)\$\{|["']([A-Za-z_][\w.:\-]*\.)["']\s*\+)"#).unwrap())
}
fn re_call() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"(?:(?:^|[^\w.$])(?:t|tc|te|\$t|i18n\.t|i18next\.t|translate)\s*\(\s*|i18nKey\s*=\s*\{?\s*)["'`]([A-Za-z0-9_][\w.:\-]*)["'`]"#).unwrap()
    })
}

fn scan_file(path: &Path) -> Option<FileScan> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut out = FileScan::default();
    for c in re_literal().captures_iter(&content) {
        out.literals.insert(c[1].to_string());
    }
    for c in re_prefix().captures_iter(&content) {
        if let Some(m) = c.get(1).or_else(|| c.get(2)) {
            out.prefixes.insert(m.as_str().to_string());
        }
    }
    let mut line_starts = vec![0usize];
    line_starts.extend(content.match_indices('\n').map(|(i, _)| i + 1));
    for c in re_call().captures_iter(&content) {
        let m = c.get(1).unwrap();
        let line = line_starts.partition_point(|&s| s <= m.start());
        out.refs.push((m.as_str().to_string(), line));
    }
    Some(out)
}

fn strip_namespace(s: &str) -> &str {
    s.split_once(':').map(|(_, k)| k).unwrap_or(s)
}

fn plural_base(key: &str) -> Option<&str> {
    PLURAL_SUFFIXES.iter().find_map(|suf| key.strip_suffix(suf))
}

#[tauri::command]
pub fn scan_code_usage(input: UsageInput) -> Result<UsageResult, String> {
    let root = Path::new(&input.root);
    if !root.is_dir() {
        return Err(format!("Not a folder: {}", input.root));
    }
    let files: Vec<_> = WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 || !e.file_type().is_dir() {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.') && !SKIP_DIRS.contains(&name.as_ref())
        })
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.path().extension().and_then(|x| x.to_str()).map_or(false, |x| CODE_EXTS.contains(&x))
                && e.metadata().map_or(false, |m| m.len() <= MAX_FILE_BYTES)
        })
        .map(|e| e.into_path())
        .collect();

    let scans: Vec<(String, FileScan)> = files
        .par_iter()
        .filter_map(|p| {
            let rel = p.strip_prefix(root).unwrap_or(p).to_string_lossy().into_owned();
            scan_file(p).map(|s| (rel, s))
        })
        .collect();

    let mut literals: HashSet<String> = HashSet::new();
    let mut prefixes: HashSet<String> = HashSet::new();
    for (_, s) in &scans {
        for l in &s.literals {
            literals.insert(strip_namespace(l).to_string());
            literals.insert(l.clone());
        }
        for p in &s.prefixes {
            prefixes.insert(strip_namespace(p).to_string());
        }
    }
    // `t('billing.plans', { returnObjects: true })` uses the whole subtree;
    // only dotted literals count, otherwise any stray "app" would match.
    let object_literals: Vec<&String> = literals.iter().filter(|l| l.contains('.')).collect();

    let keys: HashSet<&str> = input.keys.iter().map(String::as_str).collect();
    let mut unused = Vec::new();
    let mut dynamic = Vec::new();
    for key in &input.keys {
        let used = literals.contains(key)
            || plural_base(key).map_or(false, |b| literals.contains(b))
            || object_literals.iter().any(|l| key.len() > l.len() && key.starts_with(l.as_str()) && key.as_bytes()[l.len()] == b'.');
        if used {
            continue;
        }
        if prefixes.iter().any(|p| key.starts_with(p.as_str())) {
            dynamic.push(key.clone());
        } else {
            unused.push(key.clone());
        }
    }

    let mut missing: BTreeMap<String, MissingRef> = BTreeMap::new();
    for (file, s) in &scans {
        for (raw, line) in &s.refs {
            let k = strip_namespace(raw);
            let known = keys.contains(k)
                || PLURAL_SUFFIXES.iter().any(|suf| keys.contains(format!("{k}{suf}").as_str()))
                || input.keys.iter().any(|key| key.len() > k.len() && key.starts_with(k) && key.as_bytes()[k.len()] == b'.');
            if known {
                continue;
            }
            missing
                .entry(k.to_string())
                .and_modify(|m| m.count += 1)
                .or_insert(MissingRef { key: k.to_string(), file: file.clone(), line: *line, count: 1 });
        }
    }

    Ok(UsageResult {
        files_scanned: scans.len(),
        unused,
        dynamic,
        missing: missing.into_values().collect(),
    })
}
