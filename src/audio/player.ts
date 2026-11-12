import { rmsLevel } from "./timeline";
import { silentWav } from "./wav";

export interface PlaybackCallbacks {
  /** Called every animation frame while playing. */
  onFrame(level: number, currentTime: number, duration: number): void;
  onEnded(): void;
}

type MediaWithPitch = HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };

/**
 * AudioPlayer (design doc §5.10): plays WAV at a pitch-preserving speed and reports the loudness.
 * HTMLAudioElement is used (not AudioBufferSourceNode) because only media elements keep the pitch
 * when sped up. Never touches the DOM of the modal (design doc §2.2).
 */
export class AudioPlayer {
  private audio: MediaWithPitch | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;
  private url: string | null = null;
  private raf = 0;
  private callbacks: PlaybackCallbacks | null = null;

  /**
   * Must run synchronously inside a user gesture (e.g. the confirm button's click handler):
   * iOS only allows audio that was started from a gesture, so we start silence now and reuse
   * the same element once the real clip arrives.
   */
  unlock(): void {
    const audio = this.ensureAudio();
    try {
      void this.ensureContext()?.resume();
    } catch {
      /* AudioContext unavailable: play without the level meter */
    }
    if (!audio.src || audio.paused) {
      this.setSource(silentWav());
      void audio.play().catch(() => undefined);
    }
  }

  async play(wav: Uint8Array, speed: number, callbacks: PlaybackCallbacks): Promise<void> {
    this.stopLoop();
    const audio = this.ensureAudio();
    this.callbacks = callbacks;
    this.setSource(wav);
    audio.playbackRate = speed;
    audio.preservesPitch = true;
    audio.webkitPreservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.onended = () => {
      this.stopLoop();
      this.callbacks?.onFrame(0, audio.duration, audio.duration);
      this.callbacks?.onEnded();
    };
    try {
      await this.ensureContext()?.resume();
    } catch {
      /* ignore */
    }
    await audio.play();
    this.loop();
  }

  stop(): void {
    this.stopLoop();
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
    }
    this.callbacks = null;
  }

  dispose(): void {
    this.stop();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (this.audio) this.audio.removeAttribute("src");
    this.audio = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
  }

  // --- internals ---

  private ensureAudio(): MediaWithPitch {
    if (!this.audio) this.audio = new Audio() as MediaWithPitch;
    return this.audio;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(this.ensureAudio());
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    this.ctx = ctx;
    this.analyser = analyser;
    this.samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    return ctx;
  }

  private setSource(wav: Uint8Array): void {
    if (this.url) URL.revokeObjectURL(this.url);
    const bytes = new Uint8Array(wav.byteLength);
    bytes.set(wav);
    this.url = URL.createObjectURL(new Blob([bytes.buffer], { type: "audio/wav" }));
    this.ensureAudio().src = this.url;
  }

  private loop = (): void => {
    const audio = this.audio;
    if (!audio || audio.paused) return;
    let level = 0;
    if (this.analyser && this.samples) {
      this.analyser.getByteTimeDomainData(this.samples);
      level = rmsLevel(this.samples);
    }
    this.callbacks?.onFrame(level, audio.currentTime, audio.duration);
    this.raf = window.requestAnimationFrame(this.loop);
  };

  private stopLoop(): void {
    window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
