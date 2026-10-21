use crate::text;
use serde_json::{json, Value};
pub fn config(v: &Value) -> Value {
    let provider = match text(v, "provider") {
        "ollama" => "ollama",
        "huggingface" => "huggingface",
        _ => "nilai",
    };
    let model = if text(v, "model").is_empty() {
        "gemma-4-26B-A4B-it"
    } else {
        text(v, "model")
    };
    let identifier = if model == "custom" && !text(v, "customModel").is_empty() {
        text(v, "customModel").to_string()
    } else {
        match provider {
            "nilai" if model == "gemma-4-26B-A4B-it" => "google/gemma-4-26B-A4B-it".into(),
            "huggingface" => {
                let name = if model == "gemma-4-26B-A4B-it" {
                    "google/gemma-4-26B-A4B-it"
                } else {
                    model
                };
                if name.contains(':') {
                    name.into()
                } else {
                    format!("{name}:together")
                }
            }
            _ => model.into(),
        }
    };
    let endpoint = match provider {
        "ollama" => format!(
            "http://{}:{}",
            if text(v, "ollamaAddress").is_empty() {
                "localhost"
            } else {
                text(v, "ollamaAddress")
            },
            v["ollamaPort"].as_u64().filter(|p| *p > 0).unwrap_or(11434)
        ),
        "huggingface" => "https://router.huggingface.co/v1".into(),
        _ => "https://api.nilai.nillion.network/nuc/v1/".into(),
    };
    let validation = if provider == "huggingface" && text(v, "huggingfaceApiKey").is_empty() {
        json!({"valid":false,"error":"HuggingFace API key is required"})
    } else if model == "custom" && text(v, "customModel").trim().is_empty() {
        json!({"valid":false,"error":"Custom model name is required when \"Custom...\" is selected"})
    } else {
        json!({"valid":true})
    };
    json!({"provider":provider,"model":model,"identifier":identifier,"endpoint":endpoint,"displayName":match provider{"ollama"=>"Ollama (Local)","huggingface"=>"HuggingFace",_=>"nilAI"},"models":["gemma-4-26B-A4B-it"],"validation":validation})
}
