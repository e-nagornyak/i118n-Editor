use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Language {
    pub code: String,
    #[serde(default)]
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "translatorCode")]
    pub translator_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "filePath")]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default = "default_base_lang", rename = "baseLanguage")]
    pub base_language: String,
    #[serde(default)]
    pub languages: Vec<Language>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "localesPath")]
    pub locales_path: Option<String>,
}

fn default_base_lang() -> String {
    "en".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default, rename = "lastProjectId", skip_serializing_if = "Option::is_none")]
    pub last_project_id: Option<String>,
}

/// Serialized-once mutex around the on-disk config so concurrent commands
/// can't race with each other on read-modify-write.
pub struct ConfigStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl ConfigStore {
    pub fn new() -> Self {
        let base = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("i18n-editor-tauri");
        let _ = std::fs::create_dir_all(&base);
        Self { path: base.join("projects.json"), lock: Mutex::new(()) }
    }

    pub fn read(&self) -> Config {
        let _g = self.lock.lock().unwrap();
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn write(&self, cfg: &Config) -> Result<(), String> {
        let _g = self.lock.lock().unwrap();
        let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, s).map_err(|e| e.to_string())
    }
}
