/*
 * KittenTTS — on-device neural TTS via StyleTTS2 + onnxruntime-web.
 *
 * Main-thread wrapper that:
 *   - spawns the worker on first use and sends it a `load` command
 *   - exposes a Promise-based `speak()` that satisfies the TTSEngine contract
 *   - plays the returned Float32Array audio via the Web Audio API
 *   - supports pause / resume / cancel via AudioContext + the AbortSignal
 */

import type { TTSEngine, TTSVoice, SpeakOptions } from './tts';

/**
 * Which KittenTTS variant to download. All paths below resolve against
 * huggingface.co/<repoId>/resolve/main/. KittenML/kitten-tts-nano-0.8-int8
 * is the smallest viable neural voice with the voices.npz layout —
 * 23 MB model + 3 MB voices + 8 voices (Bella, Jasper, Luna, Bruno,
 * Rosie, Hugo, Kiki, Leo).
 */
export const KITTEN_REPO = 'KittenML/kitten-tts-nano-0.8-int8';

type LoadStatus =
  | { type: 'idle' }
  | { type: 'loading'; message: string }
  | { type: 'ready' }
  | { type: 'error'; error: string };

type WorkerMsg =
  | { type: 'status'; message: string }
  | { type: 'ready'; voices: string[]; modelName?: string }
  | { type: 'progress'; current: number; total: number }
  | { type: 'audio'; audio: ArrayBuffer; sampleRate: number }
  | { type: 'error'; error: string };

export class KittenEngine implements TTSEngine {
  readonly name = 'kitten';

  private worker: Worker | null = null;
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private voicesList: string[] = [];
  private status: LoadStatus = { type: 'idle' };
  private readyPromise: Promise<void> | null = null;
  private onStatus: ((s: LoadStatus) => void) | null = null;

  /** Whether the speak pipeline is ready to accept input. */
  isAvailable(): boolean {
    return this.status.type === 'ready';
  }

  /** Status listener — the Settings panel uses this for the download UI. */
  subscribeStatus(fn: (s: LoadStatus) => void): () => void {
    this.onStatus = fn;
    fn(this.status);
    return () => {
      if (this.onStatus === fn) this.onStatus = null;
    };
  }

  private emit(s: LoadStatus) {
    this.status = s;
    this.onStatus?.(s);
  }

  /**
   * Called by the player when a synth throws. Records the error so the
   * next time the user opens Settings they see what went wrong and can
   * retry. isAvailable() returns false after this until a successful
   * load() completes.
   */
  markFailed(reason: string) {
    this.emit({ type: 'error', error: reason });
  }

  /**
   * Start loading the model. If a load is already in progress or succeeded,
   * returns the existing promise. After a failed load, a fresh call will
   * tear down the old worker and retry cleanly.
   */
  load(): Promise<void> {
    // In flight or already successful → reuse the existing promise.
    if (this.readyPromise && this.status.type !== 'error') {
      return this.readyPromise;
    }

    // Retry after a prior failure: tear down and start over.
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
    }
    this.readyPromise = null;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      try {
        this.emit({ type: 'loading', message: 'Starting worker…' });
        this.worker = new Worker(
          new URL('../workers/kitten-tts.worker.ts', import.meta.url),
          { type: 'module' },
        );
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        this.emit({ type: 'error', error: msg });
        reject(err);
        return;
      }

      // Load-phase message router. Once we hit 'ready' or 'error', this
      // listener detaches so it doesn't intercept later synthesis-time
      // status/error messages (which belong to speak()'s per-call listener).
      const onLoadMsg = (e: MessageEvent<WorkerMsg>) => {
        const msg = e.data;
        if (msg.type === 'status') {
          this.emit({ type: 'loading', message: msg.message });
        } else if (msg.type === 'ready') {
          this.voicesList = msg.voices;
          this.emit({ type: 'ready' });
          this.worker?.removeEventListener('message', onLoadMsg);
          resolve();
        } else if (msg.type === 'error') {
          this.emit({ type: 'error', error: msg.error });
          this.worker?.removeEventListener('message', onLoadMsg);
          reject(new Error(msg.error));
        }
      };
      this.worker.addEventListener('message', onLoadMsg);

      this.worker.postMessage({ action: 'load', repoId: KITTEN_REPO });
    });

    return this.readyPromise;
  }

  async listVoices(): Promise<TTSVoice[]> {
    if (!this.isAvailable()) return [];
    return this.voicesList.map((v) => ({ id: v, label: v, lang: 'en-US' }));
  }

  speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (!this.worker || !this.isAvailable()) {
      return Promise.reject(new Error('KittenTTS not loaded'));
    }
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = this.audioCtx;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        this.worker!.removeEventListener('message', onMessage);
        if (err) reject(err);
        else resolve();
      };

      const onAbort = () => {
        try {
          this.currentSource?.stop();
        } catch {
          /* already stopped */
        }
        this.currentSource = null;
        finish(new DOMException('aborted', 'AbortError'));
      };

      const onMessage = async (e: MessageEvent<WorkerMsg>) => {
        const msg = e.data;
        if (msg.type === 'audio') {
          try {
            const samples = new Float32Array(msg.audio);
            const buffer = ctx.createBuffer(1, samples.length, msg.sampleRate);
            buffer.getChannelData(0).set(samples);
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            const playbackRate = Math.max(0.25, Math.min(4, opts.rate ?? 1));
            src.playbackRate.value = playbackRate;
            src.connect(ctx.destination);
            this.currentSource = src;
            src.onended = () => {
              if (this.currentSource === src) this.currentSource = null;
              finish();
            };
            if (ctx.state === 'suspended') await ctx.resume();
            src.start();
          } catch (err) {
            finish(err as Error);
          }
        } else if (msg.type === 'error') {
          finish(new Error(msg.error));
        }
      };

      if (opts.signal?.aborted) {
        finish(new DOMException('aborted', 'AbortError'));
        return;
      }
      opts.signal?.addEventListener('abort', onAbort);

      this.worker!.addEventListener('message', onMessage);
      this.worker!.postMessage({
        action: 'synthesize',
        text,
        voice: opts.voiceId || this.voicesList[0] || 'expr-voice-2-m',
        speed: 1, // playbackRate applied on the AudioBufferSourceNode
      });
    });
  }

  cancel(): void {
    try {
      this.currentSource?.stop();
    } catch {
      /* already stopped */
    }
    this.currentSource = null;
  }

  pause(): void {
    this.audioCtx?.suspend().catch(() => {});
  }

  resume(): void {
    this.audioCtx?.resume().catch(() => {});
  }
}
