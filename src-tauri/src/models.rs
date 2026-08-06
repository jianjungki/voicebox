use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub description: String,
    pub status: String,
    pub supports_streaming: bool,
    pub languages: Vec<String>,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VibeSettings {
    pub server_path: String,
    pub vae_model_path: String,
    pub lm_model_path: String,
    pub threads: u16,
    pub chunk_seconds: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub demo_mode: bool,
    pub vibe: VibeSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            demo_mode: true,
            vibe: VibeSettings {
                server_path: "native/VibeASR.cpp/build/bin/asr_stream_server.exe".into(),
                vae_model_path: "models/vibeasr/vibeasr-vae-encoder-i8_s.gguf".into(),
                lm_model_path: "models/vibeasr/vibeasr-lm-i2_s-embed-q6_k.gguf".into(),
                threads: 4,
                chunk_seconds: 5,
            },
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeChunkRequest {
    pub provider_id: String,
    pub language: String,
    pub wav_base64: String,
    pub sequence: u32,
    pub audio_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeChunkResponse {
    pub sequence: u32,
    pub text: String,
    pub latency_ms: u64,
    pub rtf: f64,
}
