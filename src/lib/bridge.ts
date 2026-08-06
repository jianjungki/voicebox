import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  ModelDescriptor,
  TranscribeChunkRequest,
  TranscribeChunkResponse,
} from "../types";

export const DEFAULT_SETTINGS: AppSettings = {
  demoMode: true,
  vibe: {
    serverPath: "native/VibeASR.cpp/build/bin/asr_stream_server.exe",
    vaeModelPath: "models/vibeasr/vibeasr-vae-encoder-i8_s.gguf",
    lmModelPath: "models/vibeasr/vibeasr-lm-i2_s-embed-q6_k.gguf",
    threads: 4,
    chunkSeconds: 5,
  },
};

export const FALLBACK_MODELS: ModelDescriptor[] = [
  {
    id: "vibeasr",
    name: "VibeVoice ASR BitNet",
    vendor: "Microsoft",
    description: "1.58 GB · CPU real-time · multilingual",
    status: "ready",
    supportsStreaming: true,
    languages: ["auto", "zh-CN", "en-US", "fr-FR", "it-IT", "ko-KR", "pt-BR", "vi-VN"],
    color: "#5f6fff",
  },
  {
    id: "whispercpp",
    name: "Whisper.cpp",
    vendor: "Community",
    description: "Provider slot reserved",
    status: "planned",
    supportsStreaming: true,
    languages: ["auto"],
    color: "#c75f3c",
  },
  {
    id: "sensevoice",
    name: "SenseVoice",
    vendor: "FunAudioLLM",
    description: "Provider slot reserved",
    status: "planned",
    supportsStreaming: false,
    languages: ["auto"],
    color: "#279478",
  },
];

export function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export async function getModels(): Promise<ModelDescriptor[]> {
  if (!isTauri()) return FALLBACK_MODELS;
  return invoke<ModelDescriptor[]>("list_models");
}

export async function loadSettings(): Promise<AppSettings> {
  if (!isTauri()) {
    const cached = localStorage.getItem("voicebox.settings");
    return cached ? { ...DEFAULT_SETTINGS, ...JSON.parse(cached) } : DEFAULT_SETTINGS;
  }
  return invoke<AppSettings>("load_settings");
}

export async function saveSettings(settings: AppSettings) {
  if (!isTauri()) {
    localStorage.setItem("voicebox.settings", JSON.stringify(settings));
    return settings;
  }
  return invoke<AppSettings>("save_settings", { settings });
}

export async function startModelSession(providerId: string, language: string) {
  if (!isTauri()) return;
  return invoke<void>("start_model_session", { providerId, language });
}

export async function stopModelSession() {
  if (!isTauri()) return;
  return invoke<void>("stop_model_session");
}

const demoLines: Record<string, string[]> = {
  "zh-CN": [
    "欢迎来到 Voicebox 语音模型评估台。",
    "当前正在监听系统音频，并以五秒为窗口进行流式转写。",
    "右侧会持续更新延迟、实时率和处理速度。",
    "你也可以粘贴参考文本，计算字错率和词错率。",
  ],
  "en-US": [
    "Welcome to the Voicebox speech model evaluation lab.",
    "System audio is being captured and transcribed in rolling windows.",
    "Latency and real-time performance are updated for every segment.",
  ],
};

export async function transcribeChunk(
  request: TranscribeChunkRequest,
  demoMode: boolean,
): Promise<TranscribeChunkResponse> {
  if (!isTauri() || demoMode) {
    await new Promise((resolve) => window.setTimeout(resolve, 450 + Math.random() * 550));
    const lines = demoLines[request.language] ?? demoLines["en-US"];
    const text = lines[(request.sequence - 1) % lines.length];
    const latencyMs = Math.round(610 + Math.random() * 380);
    return {
      sequence: request.sequence,
      text,
      latencyMs,
      rtf: Number((latencyMs / request.audioDurationMs).toFixed(3)),
    };
  }
  return invoke<TranscribeChunkResponse>("transcribe_chunk", { request });
}

