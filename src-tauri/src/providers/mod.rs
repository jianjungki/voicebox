mod vibe;

use std::path::Path;

use crate::models::{AppSettings, ModelDescriptor};

pub use vibe::VibeAsrProcess;

pub trait AsrProvider {
    fn id(&self) -> &'static str;
    fn transcribe(&mut self, wav_path: &Path) -> Result<String, String>;
    fn update_language(&mut self, language: &str) -> Result<(), String>;
    fn stop(&mut self) -> Result<(), String>;
}

pub enum ActiveProvider {
    Vibe(VibeAsrProcess),
}

impl AsrProvider for ActiveProvider {
    fn id(&self) -> &'static str {
        match self {
            Self::Vibe(provider) => provider.id(),
        }
    }

    fn transcribe(&mut self, wav_path: &Path) -> Result<String, String> {
        match self {
            Self::Vibe(provider) => provider.transcribe(wav_path),
        }
    }

    fn update_language(&mut self, language: &str) -> Result<(), String> {
        match self {
            Self::Vibe(provider) => provider.update_language(language),
        }
    }

    fn stop(&mut self) -> Result<(), String> {
        match self {
            Self::Vibe(provider) => provider.stop(),
        }
    }
}

pub fn create_provider(id: &str, settings: &AppSettings) -> Result<ActiveProvider, String> {
    match id {
        "vibeasr" => Ok(ActiveProvider::Vibe(VibeAsrProcess::start(&settings.vibe)?)),
        _ => Err(format!("Unknown ASR provider: {id}")),
    }
}

pub fn descriptors() -> Vec<ModelDescriptor> {
    vec![
        ModelDescriptor {
            id: "vibeasr".into(),
            name: "VibeVoice ASR BitNet".into(),
            vendor: "Microsoft".into(),
            description: "1.58 GB · CPU real-time · multilingual".into(),
            status: "ready".into(),
            supports_streaming: true,
            languages: [
                "auto", "zh-CN", "en-US", "fr-FR", "it-IT", "ko-KR", "pt-BR", "vi-VN",
            ]
            .iter()
            .map(|value| value.to_string())
            .collect(),
            color: "#5f6fff".into(),
        },
        ModelDescriptor {
            id: "whispercpp".into(),
            name: "Whisper.cpp".into(),
            vendor: "Community".into(),
            description: "Provider slot reserved".into(),
            status: "planned".into(),
            supports_streaming: true,
            languages: vec!["auto".into()],
            color: "#c75f3c".into(),
        },
        ModelDescriptor {
            id: "sensevoice".into(),
            name: "SenseVoice".into(),
            vendor: "FunAudioLLM".into(),
            description: "Provider slot reserved".into(),
            status: "planned".into(),
            supports_streaming: false,
            languages: vec!["auto".into()],
            color: "#279478".into(),
        },
    ]
}
