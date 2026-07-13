use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const PLUGIN_API_VERSION: u32 = 3;
pub(crate) const HOST_API_VERSION: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginManifest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version_code: u32,
    pub(crate) version_name: String,
    #[serde(default)]
    pub(crate) author: String,
    #[serde(default)]
    pub(crate) description: String,
    pub(crate) api_version: u32,
    #[serde(default = "default_host_api_version")]
    pub(crate) min_host_api_version: u32,
    #[serde(default = "default_entry")]
    pub(crate) entry: String,
    #[serde(default)]
    pub(crate) include_dirs: Vec<String>,
    #[serde(default)]
    pub(crate) icon: Option<String>,
    #[serde(default)]
    pub(crate) capabilities: Vec<String>,
    #[serde(default)]
    pub(crate) config_fields: Vec<PluginConfigField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginConfigField {
    pub(crate) key: String,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) summary: Option<String>,
    #[serde(default)]
    pub(crate) group: String,
    #[serde(rename = "type")]
    pub(crate) field_type: String,
    #[serde(default)]
    pub(crate) required: bool,
    #[serde(default, deserialize_with = "deserialize_config_default")]
    pub(crate) default_value: String,
    #[serde(default)]
    pub(crate) options: Vec<PluginConfigOption>,
    #[serde(default)]
    pub(crate) dependency: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginConfigOption {
    pub(crate) value: String,
    pub(crate) label: String,
    #[serde(default)]
    pub(crate) summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourcePlugin {
    #[serde(flatten)]
    pub(crate) manifest: PluginManifest,
    pub(crate) plugin_dir: String,
    pub(crate) icon_path: Option<String>,
    pub(crate) icon_data_url: Option<String>,
    pub(crate) enabled: bool,
    pub(crate) sort_order: i32,
    pub(crate) installed_at: String,
    pub(crate) updated_at: String,
    pub(crate) config: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInstallFailure {
    pub(crate) root_path: String,
    pub(crate) reason: String,
    pub(crate) plugin_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInstallResult {
    pub(crate) installed: Vec<SourcePlugin>,
    pub(crate) failed: Vec<PluginInstallFailure>,
}

fn default_host_api_version() -> u32 {
    1
}

fn default_entry() -> String {
    "source.js".to_string()
}

fn deserialize_config_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::String(value) => Ok(value),
        Value::Bool(value) => Ok(value.to_string()),
        Value::Number(value) => Ok(value.to_string()),
        Value::Null => Ok(String::new()),
        _ => Err(serde::de::Error::custom(
            "plugin config defaultValue must be a string, boolean, number, or null",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scalar_config_defaults_are_normalized_to_runtime_strings() {
        let manifest: PluginManifest = serde_json::from_value(serde_json::json!({
            "id": "com.example.defaults",
            "name": "Defaults",
            "versionCode": 1,
            "versionName": "1.0.0",
            "apiVersion": 3,
            "configFields": [
                { "key": "enabled", "title": "Enabled", "type": "switch", "defaultValue": true },
                { "key": "limit", "title": "Limit", "type": "number", "defaultValue": 20 }
            ]
        }))
        .unwrap();

        assert_eq!(manifest.config_fields[0].default_value, "true");
        assert_eq!(manifest.config_fields[1].default_value, "20");
    }

    #[test]
    fn structured_config_defaults_are_rejected() {
        let result = serde_json::from_value::<PluginManifest>(serde_json::json!({
            "id": "com.example.defaults",
            "name": "Defaults",
            "versionCode": 1,
            "versionName": "1.0.0",
            "apiVersion": 3,
            "configFields": [
                { "key": "bad", "title": "Bad", "type": "text", "defaultValue": { "nested": true } }
            ]
        }));

        assert!(result.is_err());
    }
}
