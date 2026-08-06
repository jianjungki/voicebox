use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use crate::models::VibeSettings;

use super::AsrProvider;

pub struct VibeAsrProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
}

fn resolve_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return Ok(path);
    }

    let current_directory = std::env::current_dir()
        .map_err(|error| format!("Cannot read current directory: {error}"))?;
    let manifest_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = vec![current_directory.join(&path)];

    if current_directory.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        if let Some(repository_root) = current_directory.parent() {
            candidates.push(repository_root.join(&path));
        }
    }

    if let Some(repository_root) = manifest_directory.parent() {
        candidates.push(repository_root.join(&path));
    }

    if let Some(found) = candidates.iter().find(|candidate| candidate.exists()) {
        return Ok(found.clone());
    }

    Ok(candidates
        .into_iter()
        .last()
        .unwrap_or_else(|| current_directory.join(path)))
}

fn language_context(language: &str) -> &'static str {
    match language {
        "zh-CN" => "The spoken language is Mandarin Chinese. Use simplified Chinese characters and return transcript text only.",
        "en-US" => "The spoken language is English. Return transcript text only.",
        "fr-FR" => "The spoken language is French. Return transcript text only.",
        "it-IT" => "The spoken language is Italian. Return transcript text only.",
        "ko-KR" => "The spoken language is Korean. Return transcript text only.",
        "pt-BR" => "The spoken language is Brazilian Portuguese. Return transcript text only.",
        "vi-VN" => "The spoken language is Vietnamese. Return transcript text only.",
        _ => "Detect the spoken language automatically and return transcript text only.",
    }
}

impl VibeAsrProcess {
    pub fn start(settings: &VibeSettings) -> Result<Self, String> {
        let server_path = resolve_path(&settings.server_path)?;
        let vae_model_path = resolve_path(&settings.vae_model_path)?;
        let lm_model_path = resolve_path(&settings.lm_model_path)?;

        for (label, path) in [
            ("streaming server", &server_path),
            ("VAE model", &vae_model_path),
            ("LM model", &lm_model_path),
        ] {
            if !path.is_file() {
                return Err(format!("VibeASR {label} not found: {}", path.display()));
            }
        }

        let working_directory = server_path
            .parent()
            .ok_or_else(|| "Invalid VibeASR server path".to_string())?;

        let mut child = Command::new(&server_path)
            .current_dir(working_directory)
            .arg("--vae-model")
            .arg(&vae_model_path)
            .arg("--lm-model")
            .arg(&lm_model_path)
            .arg("-t")
            .arg(settings.threads.to_string())
            .arg("--sample-rate")
            .arg("24000")
            .arg("--greedy")
            .arg("--no-token-stream")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start VibeASR streaming server: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open VibeASR stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open VibeASR stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to open VibeASR stderr".to_string())?;
        let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(40)));
        let stderr_tail_writer = stderr_tail.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut tail) = stderr_tail_writer.lock() {
                    if tail.len() == 40 {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
            }
        });
        let mut provider = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            stderr_tail,
        };
        provider.wait_for_marker("---READY---")?;
        Ok(provider)
    }

    fn wait_for_marker(&mut self, marker: &str) -> Result<Vec<String>, String> {
        let mut lines = Vec::new();
        loop {
            let mut line = String::new();
            let bytes = self
                .stdout
                .read_line(&mut line)
                .map_err(|error| format!("Failed to read VibeASR output: {error}"))?;
            if bytes == 0 {
                let details = self
                    .stderr_tail
                    .lock()
                    .ok()
                    .map(|tail| tail.iter().cloned().collect::<Vec<_>>().join("\n"))
                    .unwrap_or_default();
                return Err(if details.is_empty() {
                    "VibeASR server exited unexpectedly".into()
                } else {
                    format!("VibeASR server exited unexpectedly:\n{details}")
                });
            }
            let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
            if trimmed == marker {
                return Ok(lines);
            }
            if trimmed.starts_with("[ERROR]") {
                return Err(trimmed);
            }
            if !trimmed.starts_with("---") {
                lines.push(trimmed);
            }
        }
    }

    fn send_line(&mut self, value: &str) -> Result<(), String> {
        writeln!(self.stdin, "{value}")
            .map_err(|error| format!("Failed to write to VibeASR: {error}"))?;
        self.stdin
            .flush()
            .map_err(|error| format!("Failed to flush VibeASR input: {error}"))
    }
}

impl AsrProvider for VibeAsrProcess {
    fn id(&self) -> &'static str {
        "vibeasr"
    }

    fn transcribe(&mut self, wav_path: &Path) -> Result<String, String> {
        let absolute = fs::canonicalize(wav_path)
            .map_err(|error| format!("Failed to resolve audio chunk path: {error}"))?;
        self.send_line(&absolute.to_string_lossy())?;
        let lines = self.wait_for_marker("---END---")?;
        Ok(lines.join("\n").trim().to_string())
    }

    fn update_language(&mut self, language: &str) -> Result<(), String> {
        self.send_line(&format!("CONTEXT:{}", language_context(language)))?;
        self.wait_for_marker("---ACK---")?;
        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        let _ = self.send_line("EXIT");
        match self.child.try_wait() {
            Ok(Some(_)) => Ok(()),
            _ => {
                let _ = self.child.kill();
                let _ = self.child.wait();
                Ok(())
            }
        }
    }
}

impl Drop for VibeAsrProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
