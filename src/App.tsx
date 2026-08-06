import {
  Activity,
  Archive,
  AudioLines,
  ChevronDown,
  Circle,
  Clock3,
  Copy,
  Cpu,
  Download,
  Gauge,
  Languages,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Target,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SystemAudioCapture } from "./lib/audio-capture";
import {
  FALLBACK_MODELS,
  getModels,
  isTauri,
  loadSettings,
  saveSettings,
  startModelSession,
  stopModelSession,
  transcribeChunk,
} from "./lib/bridge";
import { summarizeEvaluation } from "./lib/metrics";
import type {
  AppSettings,
  ModelDescriptor,
  SavedSession,
  SessionStatus,
  TranscriptSegment,
} from "./types";

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "自动检测", short: "AUTO" },
  { value: "zh-CN", label: "中文（普通话）", short: "ZH" },
  { value: "en-US", label: "English", short: "EN" },
  { value: "fr-FR", label: "Français", short: "FR" },
  { value: "it-IT", label: "Italiano", short: "IT" },
  { value: "ko-KR", label: "한국어", short: "KO" },
  { value: "pt-BR", label: "Português", short: "PT" },
  { value: "vi-VN", label: "Tiếng Việt", short: "VI" },
];

const STARTER_SESSIONS: SavedSession[] = [
  {
    id: "sample-1",
    title: "产品访谈 · 中文",
    createdAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    language: "zh-CN",
    model: "VibeVoice ASR BitNet",
    durationMs: 192_000,
    transcript: "这是一条示例评估记录。",
    averageRtf: 0.42,
  },
  {
    id: "sample-2",
    title: "Podcast clip · EN",
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    language: "en-US",
    model: "VibeVoice ASR BitNet",
    durationMs: 78_000,
    transcript: "An example evaluation session.",
    averageRtf: 0.38,
  },
];

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function Waveform({ active, level }: { active: boolean; level: number }) {
  const bars = useMemo(
    () => Array.from({ length: 68 }, (_, index) => 0.22 + Math.abs(Math.sin(index * 1.87)) * 0.48),
    [],
  );

  return (
    <div className={`waveform ${active ? "is-active" : ""}`} aria-label="实时音频波形">
      {bars.map((base, index) => {
        const nearHead = index > 47;
        const height = active ? Math.min(1, base + level * (nearHead ? 0.9 : 0.45)) : base * 0.4;
        return <i key={index} style={{ height: `${Math.max(7, height * 54)}px`, animationDelay: `${index * -22}ms` }} />;
      })}
      {active && <span className="wave-head" />}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "good" | "accent";
}) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-label">
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function SettingsModal({
  settings,
  onClose,
  onSave,
}: {
  settings: AppSettings;
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  const updateVibe = (key: keyof AppSettings["vibe"], value: string | number) => {
    setDraft((current) => ({ ...current, vibe: { ...current.vibe, [key]: value } }));
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">RUNTIME CONFIGURATION</span>
            <h2>模型运行设置</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭设置">
            <X size={18} />
          </button>
        </header>

        <div className="settings-body">
          <div className="settings-callout">
            <div className="model-mark vibe-mark"><AudioLines size={20} /></div>
            <div>
              <strong>VibeVoice ASR BitNet</strong>
              <p>连接上游常驻流式服务 `asr_stream_server`，模型仅在会话开始时加载一次。</p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={draft.demoMode}
                onChange={(event) => setDraft({ ...draft, demoMode: event.target.checked })}
              />
              <span />
            </label>
          </div>
          <p className="switch-caption">演示模式 {draft.demoMode ? "已开启：使用模拟转写结果" : "已关闭：调用本地模型"}</p>

          <label className="field-label">
            <span>流式服务路径</span>
            <input
              value={draft.vibe.serverPath}
              onChange={(event) => updateVibe("serverPath", event.target.value)}
              placeholder=".../build/bin/asr_stream_server.exe"
            />
          </label>
          <label className="field-label">
            <span>VAE 模型路径</span>
            <input
              value={draft.vibe.vaeModelPath}
              onChange={(event) => updateVibe("vaeModelPath", event.target.value)}
              placeholder=".../vibeasr-vae-encoder-i8_s.gguf"
            />
          </label>
          <label className="field-label">
            <span>LM 模型路径</span>
            <input
              value={draft.vibe.lmModelPath}
              onChange={(event) => updateVibe("lmModelPath", event.target.value)}
              placeholder=".../vibeasr-lm-i2_s-embed-q6_k.gguf"
            />
          </label>

          <div className="settings-grid">
            <label className="field-label">
              <span>CPU 线程</span>
              <input
                type="number"
                min={1}
                max={32}
                value={draft.vibe.threads}
                onChange={(event) => updateVibe("threads", Number(event.target.value))}
              />
            </label>
            <label className="field-label">
              <span>音频窗口（秒）</span>
              <input
                type="number"
                min={2}
                max={30}
                value={draft.vibe.chunkSeconds}
                onChange={(event) => updateVibe("chunkSeconds", Number(event.target.value))}
              />
            </label>
          </div>

          <div className="provider-note">
            <Plus size={16} />
            <span>新的 ASR 引擎只需实现 Rust `AsrProvider` 接口并在 registry 注册，前端会自动显示。</span>
          </div>
        </div>

        <footer>
          <button className="button secondary" onClick={onClose}>取消</button>
          <button
            className="button primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(draft);
              setSaving(false);
            }}
          >
            {saving ? "保存中…" : "保存设置"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function App() {
  const [models, setModels] = useState<ModelDescriptor[]>(FALLBACK_MODELS);
  const [selectedModelId, setSelectedModelId] = useState("vibeasr");
  const [language, setLanguage] = useState("zh-CN");
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [durationMs, setDurationMs] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [referenceText, setReferenceText] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState("live");
  const [sessions, setSessions] = useState<SavedSession[]>(() => {
    const cached = localStorage.getItem("voicebox.sessions");
    return cached ? JSON.parse(cached) : STARTER_SESSIONS;
  });
  const captureRef = useRef<SystemAudioCapture | null>(null);
  const timerRef = useRef<number | null>(null);
  const demoTimerRef = useRef<number | null>(null);
  const demoStartTimeoutRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const sequenceRef = useRef(0);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const durationRef = useRef(0);
  const stoppingRef = useRef(false);
  const processingChainRef = useRef(Promise.resolve());
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const transcript = segments.map((segment) => segment.text).join(" ");
  const summary = useMemo(
    () => summarizeEvaluation(segments, durationMs, referenceText),
    [segments, durationMs, referenceText],
  );
  const isStopping = status === "stopping";
  const isCapturing = status === "listening" || status === "preparing";
  const isActive = isCapturing || isStopping;

  useEffect(() => {
    void Promise.all([getModels(), loadSettings()]).then(([availableModels, loadedSettings]) => {
      setModels(availableModels);
      setSettings(loadedSettings);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("voicebox.sessions", JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [segments]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (demoTimerRef.current) window.clearInterval(demoTimerRef.current);
    if (demoStartTimeoutRef.current) window.clearTimeout(demoStartTimeoutRef.current);
    void captureRef.current?.stop();
  }, []);

  const processChunk = useCallback((wavBase64: string, audioDurationMs: number) => {
    if (!settings) return Promise.resolve();
    const sequence = ++sequenceRef.current;
    const startMs = Math.max(0, Date.now() - startedAtRef.current - audioDurationMs);
    return transcribeChunk(
      { providerId: selectedModelId, language, wavBase64, sequence, audioDurationMs },
      settings.demoMode,
    ).then((response) => {
      if (!response.text.trim()) return;
      setSegments((current) => {
        const next = [
          ...current,
          {
          id: crypto.randomUUID(),
          sequence,
          startMs,
          endMs: startMs + audioDurationMs,
          text: response.text.trim(),
          latencyMs: response.latencyMs,
          rtf: response.rtf,
          isFinal: true,
          },
        ];
        segmentsRef.current = next;
        return next;
      });
    }).catch((error) => {
      if (stoppingRef.current) return;
      setStatus("error");
      setToast(error instanceof Error ? error.message : String(error));
    });
  }, [language, selectedModelId, settings]);

  const queueChunk = useCallback((wavBase64: string, audioDurationMs: number) => {
    processingChainRef.current = processingChainRef.current.then(() => processChunk(wavBase64, audioDurationMs));
    return processingChainRef.current;
  }, [processChunk]);

  const beginDemoStream = useCallback(() => {
    const enqueue = () => void queueChunk("", (settings?.vibe.chunkSeconds ?? 5) * 1000);
    demoStartTimeoutRef.current = window.setTimeout(enqueue, 900);
    demoTimerRef.current = window.setInterval(enqueue, (settings?.vibe.chunkSeconds ?? 5) * 1000);
    let phase = 0;
    const levelTimer = window.setInterval(() => {
      if (!demoTimerRef.current) {
        window.clearInterval(levelTimer);
        return;
      }
      phase += 0.6;
      setAudioLevel(0.16 + Math.abs(Math.sin(phase)) * 0.62 + Math.random() * 0.15);
    }, 120);
  }, [queueChunk, settings]);

  const startListening = async () => {
    if (!settings || !selectedModel) return;
    if (selectedModel.status === "planned") {
      setToast("这个 Provider 已预留，尚未接入运行时");
      return;
    }
    setStatus("preparing");
    setSegments([]);
    segmentsRef.current = [];
    setDurationMs(0);
    durationRef.current = 0;
    setActiveSessionId("live");
    sequenceRef.current = 0;
    stoppingRef.current = false;
    startedAtRef.current = Date.now();

    try {
      await startModelSession(selectedModelId, language);
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        durationRef.current = elapsed;
        setDurationMs(elapsed);
      }, 250);

      if (!isTauri()) {
        beginDemoStream();
      } else {
        const capture = new SystemAudioCapture({
          chunkSeconds: settings.vibe.chunkSeconds,
          onLevel: setAudioLevel,
          onChunk: ({ wavBase64, durationMs }) => queueChunk(wavBase64, durationMs),
          onEnded: () => void stopListening(),
        });
        captureRef.current = capture;
        await capture.start();
      }
      setStatus("listening");
    } catch (error) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      await stopModelSession().catch(() => undefined);
      setStatus("error");
      setToast(error instanceof Error ? error.message : String(error));
    }
  };

  const stopListening = async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStatus("stopping");
    setAudioLevel(0);
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (demoTimerRef.current) window.clearInterval(demoTimerRef.current);
    if (demoStartTimeoutRef.current) window.clearTimeout(demoStartTimeoutRef.current);
    timerRef.current = null;
    demoTimerRef.current = null;
    demoStartTimeoutRef.current = null;
    const capture = captureRef.current;
    captureRef.current = null;
    let stopError: unknown;
    try {
      await capture?.stop();
      await processingChainRef.current;
    } catch (error) {
      stopError = error;
    }
    try {
      await stopModelSession();
    } catch (error) {
      stopError ??= error;
    }

    const finalSegments = segmentsRef.current;
    const finalDuration = durationRef.current;
    const finalTranscript = finalSegments.map((segment) => segment.text).join(" ");
    const finalSummary = summarizeEvaluation(finalSegments, finalDuration, referenceText);
    if (finalSegments.length && selectedModel) {
      const newSession: SavedSession = {
        id: crypto.randomUUID(),
        title: `${language.startsWith("zh") ? "实时转写" : "Live capture"} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        createdAt: new Date().toISOString(),
        language,
        model: selectedModel.name,
        durationMs: finalDuration,
        transcript: finalTranscript,
        averageRtf: finalSummary.averageRtf,
      };
      setSessions((current) => [newSession, ...current.filter((session) => !session.id.startsWith("sample"))]);
      setActiveSessionId(newSession.id);
      setToast("本次评估已保存到会话历史");
    }
    stoppingRef.current = false;
    setStatus("idle");
    if (stopError) setToast(stopError instanceof Error ? stopError.message : String(stopError));
  };

  const resetSession = () => {
    setSegments([]);
    segmentsRef.current = [];
    setDurationMs(0);
    durationRef.current = 0;
    setReferenceText("");
    setActiveSessionId("live");
    setStatus("idle");
  };

  const exportSession = () => {
    const payload = {
      model: selectedModel?.name,
      language,
      createdAt: new Date().toISOString(),
      transcript,
      reference: referenceText,
      metrics: summary,
      segments,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `voicebox-evaluation-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("评估报告已导出");
  };

  const selectSavedSession = (session: SavedSession) => {
    if (isActive) return;
    setActiveSessionId(session.id);
    setLanguage(session.language);
    setDurationMs(session.durationMs);
    setSegments([
      {
        id: `${session.id}-segment`,
        sequence: 1,
        startMs: 0,
        endMs: session.durationMs,
        text: session.transcript,
        latencyMs: Math.round(session.averageRtf * session.durationMs),
        rtf: session.averageRtf,
        isFinal: true,
      },
    ]);
    segmentsRef.current = [
      {
        id: `${session.id}-segment`,
        sequence: 1,
        startMs: 0,
        endMs: session.durationMs,
        text: session.transcript,
        latencyMs: Math.round(session.averageRtf * session.durationMs),
        rtf: session.averageRtf,
        isFinal: true,
      },
    ];
    durationRef.current = session.durationMs;
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-symbol"><AudioLines size={21} strokeWidth={2.3} /></div>
          <div><strong>Voicebox</strong><span>ASR LAB</span></div>
        </div>

        <button className="new-session" onClick={resetSession} disabled={isActive}>
          <Plus size={17} />
          新建评估
        </button>

        <div className="sidebar-section">
          <div className="sidebar-heading"><span>工作区</span></div>
          <button className="nav-item active"><Radio size={17} />实时评估<span className="nav-dot" /></button>
          <button className="nav-item"><Archive size={17} />批量测试<span className="coming">Soon</span></button>
          <button className="nav-item"><Target size={17} />基准对比<span className="coming">Soon</span></button>
        </div>

        <div className="sidebar-section sessions-section">
          <div className="sidebar-heading"><span>最近会话</span><button aria-label="更多"><MoreHorizontal size={16} /></button></div>
          <div className="session-list">
            {sessions.slice(0, 6).map((session) => (
              <button
                key={session.id}
                className={`session-row ${activeSessionId === session.id ? "selected" : ""}`}
                onClick={() => selectSavedSession(session)}
              >
                <span className="session-status" />
                <span className="session-copy">
                  <strong>{session.title}</strong>
                  <small>{session.id.startsWith("sample-2") ? "昨天" : session.id.startsWith("sample") ? "18 分钟前" : new Date(session.createdAt).toLocaleDateString()}</small>
                </span>
                <span className="session-time">{formatDuration(session.durationMs)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <button onClick={() => setShowSettings(true)}><Settings2 size={17} />运行设置</button>
          <div className="runtime-indicator">
            <span className={settings?.demoMode ? "demo" : "online"} />
            {settings?.demoMode ? "演示运行时" : "本地运行时"}
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">LIVE EVALUATION</span>
            <h1>实时语音评估</h1>
          </div>
          <div className="topbar-actions">
            {settings?.demoMode && (
              <button className="demo-warning" onClick={() => setShowSettings(true)}>
                <Circle size={7} fill="currentColor" />演示模式 · 不会识别真实声音
              </button>
            )}
            <button className="icon-button" title="复制转写" onClick={() => void navigator.clipboard.writeText(transcript)} disabled={!transcript}>
              <Copy size={17} />
            </button>
            <button className="button secondary export-button" onClick={exportSession} disabled={!segments.length}>
              <Download size={16} />导出报告
            </button>
          </div>
        </header>

        <section className="control-strip">
          <label className="select-control model-select">
            <span>评估模型</span>
            <div className="select-value">
              <span className="model-mark vibe-mark"><AudioLines size={18} /></span>
              <span><strong>{selectedModel?.name}</strong><small>{selectedModel?.vendor} · {selectedModel?.supportsStreaming ? "Streaming" : "Batch"}</small></span>
              <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)} disabled={isActive}>
                {models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.status === "planned" ? "（待接入）" : ""}</option>)}
              </select>
              <ChevronDown size={16} />
            </div>
          </label>
          <label className="select-control language-select">
            <span>识别语言</span>
            <div className="select-value compact">
              <Languages size={18} />
              <strong>{LANGUAGE_OPTIONS.find((option) => option.value === language)?.label}</strong>
              <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={isActive}>
                {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <ChevronDown size={16} />
            </div>
          </label>
          <div className="source-control">
            <span>音频源</span>
            <div className={`source-value ${settings?.demoMode ? "is-demo" : ""}`}>
              <Radio size={18} />
              <div>
                <strong>{settings?.demoMode ? "模拟转写" : "系统声音"}</strong>
                <small>{settings?.demoMode ? "固定示例文本" : "WebView loopback"}</small>
              </div>
              <span className={settings?.demoMode ? "source-demo" : "source-ready"}>{settings?.demoMode ? "DEMO" : "READY"}</span>
            </div>
          </div>
        </section>

        <div className="content-grid">
          <section className="transcript-panel">
            <div className="panel-header">
              <div className="live-title">
                <span className={`live-pulse ${isCapturing ? "active" : ""}`} />
                <div>
                  <strong>{isStopping ? "正在结束评估" : isActive ? (settings?.demoMode ? "正在运行演示" : "正在监听系统声音") : segments.length ? "评估结果" : "等待开始"}</strong>
                  <small>{isStopping ? "采集已停止，正在完成已提交的音频分片" : isActive ? (settings?.demoMode ? "当前显示固定示例文本，不会识别真实声音" : "音频将被分片送入本地模型") : "点击下方按钮开始一次实时评估"}</small>
                </div>
              </div>
              <div className="recording-clock"><Clock3 size={15} /><span>{formatDuration(durationMs)}</span></div>
            </div>

            <Waveform active={status === "listening"} level={audioLevel} />

            <div className={`transcript-scroll ${segments.length ? "has-content" : ""}`}>
              {!segments.length ? (
                <div className="empty-state">
                  <div className="empty-orbit"><Mic2 size={26} /><span /><span /></div>
                  <strong>声音会在这里变成文字</strong>
                  <p>播放一段会议、视频或播客，Voicebox 会捕获系统声音并持续评估识别表现。</p>
                </div>
              ) : (
                <div className="segment-list">
                  {segments.map((segment) => (
                    <article className="segment" key={segment.id}>
                      <time>{formatTime(segment.startMs)}</time>
                      <div>
                        <p>{segment.text}</p>
                        <span className="segment-meta">#{segment.sequence.toString().padStart(2, "0")} · {segment.latencyMs} ms · RTF {segment.rtf.toFixed(2)}</span>
                      </div>
                    </article>
                  ))}
                  {status === "listening" && <div className="processing-line"><span /><span /><span />正在分析下一段音频</div>}
                  <div ref={scrollAnchorRef} />
                </div>
              )}
            </div>

            {showReference && (
              <div className="reference-box">
                <div><strong>参考文本</strong><small>用于实时计算 WER / CER，不会发送到模型。</small></div>
                <textarea value={referenceText} onChange={(event) => setReferenceText(event.target.value)} placeholder="粘贴这段音频的标准答案…" />
              </div>
            )}

            <div className="transport">
              <button className="transport-side" onClick={() => setShowReference((value) => !value)}>
                <SlidersHorizontal size={17} />{showReference ? "收起参考文本" : "添加参考文本"}
              </button>
              <button
                className={`listen-button ${isActive ? "stop" : ""}`}
                onClick={() => void (isActive ? stopListening() : startListening())}
                disabled={status === "preparing" || isStopping || !settings}
              >
                <span>{status === "preparing" || isStopping ? <Activity className="spin" size={20} /> : isActive ? <Square size={18} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</span>
                {status === "preparing" ? "正在加载模型" : isStopping ? "正在结束" : isActive ? "结束评估" : settings?.demoMode ? "开始演示" : "开始监听"}
              </button>
              <button className="transport-side right" onClick={resetSession} disabled={isActive || !segments.length}>
                <RotateCcw size={17} />清空结果
              </button>
            </div>
          </section>

          <aside className="insights-panel">
            <div className="insight-heading">
              <div><span className="eyebrow">PERFORMANCE</span><h2>实时指标</h2></div>
              <span className={`quality-chip ${summary.averageRtf && summary.averageRtf < 1 ? "good" : ""}`}>
                <Circle size={7} fill="currentColor" />{summary.averageRtf ? (summary.averageRtf < 1 ? "实时" : "偏慢") : "待测"}
              </span>
            </div>

            <div className="metric-grid">
              <MetricCard icon={<Zap size={16} />} label="平均延迟" value={summary.averageLatencyMs ? `${Math.round(summary.averageLatencyMs)} ms` : "—"} hint="每个音频窗口" tone="accent" />
              <MetricCard icon={<Gauge size={16} />} label="实时因子" value={summary.averageRtf ? summary.averageRtf.toFixed(2) : "—"} hint={summary.averageRtf ? (summary.averageRtf < 1 ? "快于音频速度" : "慢于音频速度") : "RTF < 1 为实时"} tone={summary.averageRtf && summary.averageRtf < 1 ? "good" : "default"} />
              <MetricCard icon={<Activity size={16} />} label="实时达标率" value={segments.length ? `${Math.round(summary.realtimeRate)}%` : "—"} hint="RTF < 1 的分片" />
              <MetricCard icon={<AudioLines size={16} />} label="识别字符" value={summary.wordCount ? summary.wordCount.toLocaleString() : "—"} hint={`${segments.length} 个有效分片`} />
            </div>

            <div className="accuracy-card">
              <div className="accuracy-header"><div><Target size={17} /><strong>准确率评估</strong></div><span>{referenceText.trim() ? "已启用" : "需要参考文本"}</span></div>
              <div className="accuracy-values">
                <div><span>WER</span><strong>{summary.wer === undefined ? "—" : `${(summary.wer * 100).toFixed(1)}%`}</strong><small>词错误率</small></div>
                <i />
                <div><span>CER</span><strong>{summary.cer === undefined ? "—" : `${(summary.cer * 100).toFixed(1)}%`}</strong><small>字错误率</small></div>
              </div>
              {!referenceText.trim() && <button onClick={() => setShowReference(true)}><Plus size={14} />添加标准答案</button>}
            </div>

            <div className="runtime-card">
              <div className="runtime-title"><Cpu size={17} /><strong>运行时</strong></div>
              <dl>
                <div><dt>Provider</dt><dd>VibeASR.cpp</dd></div>
                <div><dt>采样率</dt><dd>24 kHz · Mono</dd></div>
                <div><dt>音频窗口</dt><dd>{settings?.vibe.chunkSeconds ?? 5} 秒</dd></div>
                <div><dt>CPU 线程</dt><dd>{settings?.vibe.threads ?? 4}</dd></div>
              </dl>
              <div className="runtime-foot"><Sparkles size={14} /><span>{settings?.demoMode ? "当前为演示模式" : "全部推理均在本机完成"}</span></div>
            </div>

            <button className="add-provider" onClick={() => setShowSettings(true)}><Plus size={16} /><span><strong>接入其他模型</strong><small>Whisper.cpp · SenseVoice · 自定义 CLI</small></span></button>
          </aside>
        </div>
      </main>

      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (updated) => {
            const saved = await saveSettings(updated);
            setSettings(saved);
            setShowSettings(false);
            setToast("运行设置已保存");
          }}
        />
      )}

      {toast && <div className="toast"><Circle size={8} fill="currentColor" />{toast}</div>}
    </div>
  );
}
