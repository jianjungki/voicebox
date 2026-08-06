mod models;
mod providers;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use models::{AppSettings, ModelDescriptor, TranscribeChunkRequest, TranscribeChunkResponse};
use providers::{create_provider, ActiveProvider, AsrProvider};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

#[derive(Default)]
struct RuntimeState {
    active: Option<ActiveProvider>,
}

struct AppState {
    runtime: Arc<Mutex<RuntimeState>>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve app config directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create app config directory: {error}"))?;
    Ok(directory.join("settings.json"))
}

fn read_settings(path: &Path) -> AppSettings {
    fs::read_to_string(path)
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn list_models() -> Vec<ModelDescriptor> {
    providers::descriptors()
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    Ok(read_settings(&path))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    let serialized = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;
    fs::write(path, serialized).map_err(|error| format!("Failed to save settings: {error}"))?;
    Ok(settings)
}

#[tauri::command]
async fn start_model_session(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    language: String,
) -> Result<(), String> {
    let settings = read_settings(&settings_path(&app)?);
    if settings.demo_mode {
        return Ok(());
    }
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = runtime
            .lock()
            .map_err(|_| "ASR runtime lock poisoned".to_string())?;
        if let Some(mut current) = guard.active.take() {
            current.stop()?;
        }
        let mut provider = create_provider(&provider_id, &settings)?;
        provider.update_language(&language)?;
        guard.active = Some(provider);
        Ok(())
    })
    .await
    .map_err(|error| format!("Failed to join ASR startup task: {error}"))?
}

#[tauri::command]
async fn transcribe_chunk(
    app: AppHandle,
    state: State<'_, AppState>,
    request: TranscribeChunkRequest,
) -> Result<TranscribeChunkResponse, String> {
    let runtime = state.runtime.clone();
    let cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve cache directory: {error}"))?
        .join("chunks");

    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&cache_directory)
            .map_err(|error| format!("Failed to create audio cache: {error}"))?;
        let wav_path = cache_directory.join(format!("{}-{}.wav", request.sequence, Uuid::new_v4()));
        let wav_bytes = BASE64
            .decode(request.wav_base64.as_bytes())
            .map_err(|error| format!("Invalid audio payload: {error}"))?;
        fs::write(&wav_path, wav_bytes)
            .map_err(|error| format!("Failed to write audio chunk: {error}"))?;

        let started = Instant::now();
        let result = (|| {
            let mut guard = runtime
                .lock()
                .map_err(|_| "ASR runtime lock poisoned".to_string())?;
            let provider = guard
                .active
                .as_mut()
                .ok_or_else(|| "No active ASR model session".to_string())?;
            if provider.id() != request.provider_id {
                return Err(format!(
                    "Active provider is {}, requested {}",
                    provider.id(),
                    request.provider_id
                ));
            }
            provider.update_language(&request.language)?;
            provider.transcribe(&wav_path)
        })();
        let latency_ms = started.elapsed().as_millis() as u64;
        let _ = fs::remove_file(&wav_path);
        let text = result?;
        let rtf = if request.audio_duration_ms == 0 {
            0.0
        } else {
            latency_ms as f64 / request.audio_duration_ms as f64
        };

        Ok(TranscribeChunkResponse {
            sequence: request.sequence,
            text,
            latency_ms,
            rtf,
        })
    })
    .await
    .map_err(|error| format!("Failed to join transcription task: {error}"))?
}

#[tauri::command]
async fn stop_model_session(state: State<'_, AppState>) -> Result<(), String> {
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = runtime
            .lock()
            .map_err(|_| "ASR runtime lock poisoned".to_string())?;
        if let Some(mut provider) = guard.active.take() {
            provider.stop()?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Failed to join ASR shutdown task: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            runtime: Arc::new(Mutex::new(RuntimeState::default())),
        })
        .invoke_handler(tauri::generate_handler![
            list_models,
            load_settings,
            save_settings,
            start_model_session,
            transcribe_chunk,
            stop_model_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Voicebox");
}
