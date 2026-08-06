export interface AudioChunk {
  wavBase64: string;
  durationMs: number;
  peak: number;
}

interface CaptureOptions {
  chunkSeconds: number;
  onLevel: (level: number) => void;
  onChunk: (chunk: AudioChunk) => Promise<void>;
  onEnded: () => void;
}

function mergeBuffers(buffers: Float32Array[]) {
  const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }
  return merged;
}

function downsample(input: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(Math.floor((index + 1) * ratio), input.length);
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += input[sourceIndex];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

export class SystemAudioCapture {
  private stream?: MediaStream;
  private context?: AudioContext;
  private processor?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private buffers: Float32Array[] = [];
  private bufferedSamples = 0;
  private stopping = false;
  private options: CaptureOptions;

  constructor(options: CaptureOptions) {
    this.options = options;
  }

  async start() {
    this.stopping = false;
    const constraints = {
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: "include",
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions;

    this.stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    const audioTrack = this.stream.getAudioTracks()[0];
    if (!audioTrack) {
      this.stream.getTracks().forEach((track) => track.stop());
      throw new Error("没有捕获到系统声音。请在分享窗口中勾选“同时分享系统音频”。");
    }

    this.stream.getVideoTracks().forEach((track) => {
      track.enabled = false;
      track.addEventListener("ended", () => this.options.onEnded());
    });

    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(new MediaStream([audioTrack]));
    this.processor = this.context.createScriptProcessor(4096, Math.max(1, this.source.channelCount), 1);
    this.processor.onaudioprocess = (event) => {
      if (this.stopping) return;
      const input = event.inputBuffer;
      const mono = new Float32Array(input.length);
      let peak = 0;
      for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
        const data = input.getChannelData(channel);
        for (let index = 0; index < data.length; index += 1) mono[index] += data[index] / input.numberOfChannels;
      }
      for (const sample of mono) peak = Math.max(peak, Math.abs(sample));
      this.options.onLevel(Math.min(1, peak * 2.6));
      this.buffers.push(mono);
      this.bufferedSamples += mono.length;

      const targetSamples = this.context!.sampleRate * this.options.chunkSeconds;
      if (this.bufferedSamples >= targetSamples) void this.flush();
    };

    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  async flush() {
    if (!this.context || !this.buffers.length) return;
    const buffers = this.buffers;
    this.buffers = [];
    this.bufferedSamples = 0;
    const merged = mergeBuffers(buffers);
    const samples = downsample(merged, this.context.sampleRate, 24_000);
    const peak = samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
    await this.options.onChunk({
      wavBase64: encodeWav(samples, 24_000),
      durationMs: Math.round((samples.length / 24_000) * 1000),
      peak,
    });
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.buffers = [];
    this.bufferedSamples = 0;
    await this.context?.close();
    this.stream = undefined;
    this.context = undefined;
    this.processor = undefined;
    this.source = undefined;
    this.options.onLevel(0);
  }
}
