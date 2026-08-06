# Voicebox

Voicebox 是一个本地优先的 ASR 模型评估桌面端。当前 Provider 对接微软官方
[VibeASR.cpp](https://github.com/microsoft/VibeASR.cpp)，通过 Tauri 捕获系统声音，按固定窗口生成
24 kHz 单声道 WAV，并发送给常驻的 `asr_stream_server`。模型在一次会话中只加载一次。

## 已实现

- 系统声音实时捕获（WebView2 `getDisplayMedia` loopback）
- 语言选择：自动、中文、英语、法语、意大利语、韩语、葡萄牙语、越南语
- VibeASR.cpp 常驻进程协议：`---READY---` / `---ACK---` / `---END---`
- 分片级延迟、RTF、实时达标率、转写字符数
- 粘贴参考文本后计算 WER / CER
- 会话历史和 JSON 评估报告导出
- Rust `AsrProvider` 抽象，已为 Whisper.cpp、SenseVoice 等模型预留 UI 和注册位
- 演示模式：未安装 1.58 GB 模型时也可以完整体验界面

## 启动 UI

要求 Node.js 20+、Rust stable 和 Windows WebView2。

```powershell
npm install
npm run tauri dev
```

仅预览前端：

```powershell
npm run dev
```

前端预览会自动使用演示音频流；Tauri 桌面端会请求屏幕/窗口共享权限。请在系统选择器中勾选
“同时分享系统音频”。视频轨道不会被保存或处理。

## 安装 VibeASR.cpp

Windows 上游要求 GCC/Clang，不支持 MSVC。直接执行：

```powershell
.\scripts\setup-vibeasr.ps1
```

默认使用 `https://hf-mirror.com` 下载两个 GGUF 文件（仅下载推理所需的约 1.70 GB，不下载原始
Safetensors）。如需使用 Hugging Face 官方站点：

```powershell
.\scripts\setup-vibeasr.ps1 -HuggingFaceEndpoint https://huggingface.co
```

强制从头重新下载两个模型：

```powershell
.\scripts\setup-vibeasr.ps1 -ForceModelRedownload
```

如果系统缺少 CMake 或 MinGW-w64，脚本会从 WinLibs 的 GitHub Release 下载便携工具链到 `.tools/winlibs`。
工具链包含 GCC、CMake 和 GNU Make，不修改系统 PATH，也不需要管理员权限。只安装构建依赖、暂不编译或
下载模型时可以使用：

```powershell
.\scripts\setup-vibeasr.ps1 -InstallDependenciesOnly
```

脚本会：

1. 克隆 VibeASR.cpp 及其 `llama.cpp` 子模块到 `native/VibeASR.cpp`；
2. 构建 `asr_stream_server.exe`；
3. 从 Hugging Face 下载预量化模型到 `models/vibeasr`。

完成后打开 Voicebox 的“运行设置”，检查路径并关闭“演示模式”。默认路径是：

```text
native/VibeASR.cpp/build/bin/asr_stream_server.exe
models/vibeasr/vibeasr-vae-encoder-i8_s.gguf
models/vibeasr/vibeasr-lm-i2_s-embed-q6_k.gguf
```

## 架构

```text
System audio
  -> WebView2 media capture
  -> 24 kHz mono WAV chunks
  -> Tauri IPC
  -> Rust Provider Registry
  -> VibeASR.cpp persistent server
  -> transcript + latency + RTF
  -> session / WER / CER / export
```

模型实现位于 `src-tauri/src/providers/`。新增模型时实现 `AsrProvider`：

```rust
pub trait AsrProvider {
    fn id(&self) -> &'static str;
    fn transcribe(&mut self, wav_path: &Path) -> Result<String, String>;
    fn update_language(&mut self, language: &str) -> Result<(), String>;
    fn stop(&mut self) -> Result<(), String>;
}
```

随后在 `create_provider` 与 `descriptors` 中注册。前端模型选择器从 Rust registry 读取，不需要重新设计页面。

## 当前限制

- VibeASR.cpp 当前没有独立的 `--language` 参数；语言选择会通过 `CONTEXT:` 作为解码提示发送，
  “自动检测”则不指定语种。
- 实时模式是固定窗口的增量识别，不是声学帧级在线解码。窗口可在设置中调整，默认 5 秒。
- WER 对中文等无空格语言的参考意义有限，中文评估优先看 CER。
