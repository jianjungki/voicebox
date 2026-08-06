export type SessionStatus = "idle" | "preparing" | "listening" | "stopping" | "paused" | "error";

export interface ModelDescriptor {
  id: string;
  name: string;
  vendor: string;
  description: string;
  status: "ready" | "setup" | "planned";
  supportsStreaming: boolean;
  languages: string[];
  color: string;
}

export interface AppSettings {
  demoMode: boolean;
  vibe: {
    serverPath: string;
    vaeModelPath: string;
    lmModelPath: string;
    threads: number;
    chunkSeconds: number;
  };
}

export interface TranscriptSegment {
  id: string;
  sequence: number;
  startMs: number;
  endMs: number;
  text: string;
  latencyMs: number;
  rtf: number;
  confidence?: number;
  isFinal: boolean;
}

export interface TranscribeChunkRequest {
  providerId: string;
  language: string;
  wavBase64: string;
  sequence: number;
  audioDurationMs: number;
}

export interface TranscribeChunkResponse {
  sequence: number;
  text: string;
  latencyMs: number;
  rtf: number;
}

export interface EvaluationSummary {
  durationMs: number;
  averageLatencyMs: number;
  averageRtf: number;
  realtimeRate: number;
  wordCount: number;
  wer?: number;
  cer?: number;
}

export interface SavedSession {
  id: string;
  title: string;
  createdAt: string;
  language: string;
  model: string;
  durationMs: number;
  transcript: string;
  averageRtf: number;
}
