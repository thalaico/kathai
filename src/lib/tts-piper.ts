/*
 * Piper TTS — VITS-based on-device neural voice via
 * @mintplex-labs/piper-tts-web.
 *
 * Why this exists alongside KittenTTS: VITS (Piper) is a single-stage
 * architecture that synthesizes noticeably faster than StyleTTS2
 * (Kitten) on WASM CPU, at the cost of a ~60 MB download per voice
 * (vs Kitten's ~23 MB). The package wraps an internal Web Worker and
 * caches models in OPFS, so integration here is mostly engine plumbing
 * plus the same streaming-chunk playback we already use for Kitten.
 */

import { TtsSession, download } from '@mintplex-labs/piper-tts-web';
import type { TTSEngine, TTSVoice, SpeakOptions } from './tts';

export const PIPER_DEFAULT_VOICE = 'en_US-hfc_female-medium';

/**
 * Paths to the runtime files we vendor under /tts-runtime/ via
 * vite-plugin-static-copy. We override the package defaults (which
 * point at cdnjs files that don't exist for ORT 1.18.0) so inference
 * works at all, and so the service worker can cache them for offline.
 */
const PIPER_WASM_PATHS = {
  onnxWasm: '/tts-runtime/onnx/',
  piperData: '/tts-runtime/piper/piper_phonemize.data',
  piperWasm: '/tts-runtime/piper/piper_phonemize.wasm',
};

/**
 * Curated list of English voices. The full Piper catalog has 60+
 * voices across ~40 languages but exposing them all here would be
 * noise; users can request specific voices in Settings later.
 */
const VOICE_CATALOG: TTSVoice[] = [
  { id: 'en_US-hfc_female-medium', label: 'hfc — us, female', lang: 'en-US' },
  { id: 'en_US-hfc_male-medium', label: 'hfc — us, male', lang: 'en-US' },
  { id: 'en_US-amy-medium', label: 'amy — us, female', lang: 'en-US' },
  { id: 'en_US-ryan-medium', label: 'ryan — us, male', lang: 'en-US' },
  { id: 'en_US-lessac-medium', label: 'lessac — us, female', lang: 'en-US' },
  { id: 'en_US-libritts_r-medium', label: 'libritts — us, multi', lang: 'en-US' },
  { id: 'en_GB-cori-medium', label: 'cori — gb, female', lang: 'en-GB' },
  { id: 'en_GB-alan-medium', label: 'alan — gb, male', lang: 'en-GB' },
];

type LoadStatus =
  | { type: 'idle' }
  | { type: 'loading'; message: string }
  | { type: 'ready' }
  | { type: 'error'; error: string };

export class PiperEngine implements TTSEngine {
  readonly name = 'piper';

  private session: TtsSession | null = null;
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private status: LoadStatus = { type: 'idle' };
  private readyPromise: Promise<void> | null = null;
  private loadedVoice: string | null = null;
  private onStatus: ((s: LoadStatus) => void) | null = null;
  private nextReqId = 0;
  private currentReqId = 0;
  /** Pre-synthesized blob for the next sentence (see prefetch()). */
  private prefetchedText: string | null = null;
  private prefetchedBlob: Promise<Blob> | null = null;

  isAvailable(): boolean {
    return this.status.type === 'ready';
  }

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

  markFailed(reason: string) {
    this.emit({ type: 'error', error: reason });
  }

  /**
   * Download + initialize a voice. Safe to call multiple times; will
   * reload the session when switching voices. After a failed load the
   * next call tears down and retries cleanly.
   */
  load(voiceId: string = PIPER_DEFAULT_VOICE): Promise<void> {
    // Already loaded this exact voice and not in error state → reuse.
    if (
      this.readyPromise &&
      this.status.type !== 'error' &&
      this.loadedVoice === voiceId
    ) {
      return this.readyPromise;
    }

    // Switching voice or retrying → discard old session.
    // TtsSession is a hard singleton; clear it so the next `create()`
    // actually loads the new voice's model instead of reusing the old one.
    (TtsSession as any)._instance = null;
    this.session = null;
    this.readyPromise = null;
    this.prefetchedText = null;
    this.prefetchedBlob = null;

    this.readyPromise = (async () => {
      try {
        this.emit({ type: 'loading', message: 'Preparing piper…' });
        await download(voiceId, (progress) => {
          if (progress.total > 0) {
            const pct = Math.round((progress.loaded * 100) / progress.total);
            const mb = (progress.loaded / 1024 / 1024).toFixed(1);
            this.emit({
              type: 'loading',
              message: `Downloading voice… ${pct}% (${mb} MB)`,
            });
          }
        });
        this.emit({ type: 'loading', message: 'Initializing session…' });
        this.session = await TtsSession.create({
          voiceId,
          wasmPaths: PIPER_WASM_PATHS,
        });
        if (this.session.waitReady && this.session.waitReady !== true) {
          await this.session.waitReady;
        }
        this.loadedVoice = voiceId;
        this.emit({ type: 'ready' });
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        this.emit({ type: 'error', error: msg });
        throw err;
      }
    })();

    return this.readyPromise;
  }

  async listVoices(): Promise<TTSVoice[]> {
    return VOICE_CATALOG;
  }

  getLoadedVoice(): string | null {
    return this.loadedVoice;
  }

  /**
   * Pre-synthesize the next sentence. Called by the player immediately
   * after speak() starts so the predict runs in the worker during the
   * current sentence's playback. If the text matches what speak() later
   * receives, the cached blob is reused (zero wait for synthesis).
   */
  prefetch(text: string): void {
    if (!this.session || !this.isAvailable()) return;
    this.prefetchedText = text;
    this.prefetchedBlob = this.session.predict(text);
  }

  /**
   * Speak a single piece of text (typically one sentence, as chunked by
   * the player). Uses a prefetched blob if one was prepared for this
   * exact text; otherwise synthesizes on the spot.
   */
  speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (!this.session || !this.isAvailable()) {
      return Promise.reject(new Error('Piper not loaded'));
    }
    const session = this.session;
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = this.audioCtx;
    const reqId = ++this.nextReqId;
    this.currentReqId = reqId;
    const playbackRate = Math.max(0.25, Math.min(4, opts.rate ?? 1));

    return new Promise<void>(async (resolve, reject) => {
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve();
      };

      const onAbort = () => {
        this.currentReqId = -1;
        this.prefetchedText = null;
        this.prefetchedBlob = null;
        try {
          this.currentSource?.stop();
        } catch {
          /* already stopped */
        }
        this.currentSource = null;
        finish(new DOMException('aborted', 'AbortError'));
      };

      if (opts.signal?.aborted) {
        finish(new DOMException('aborted', 'AbortError'));
        return;
      }
      opts.signal?.addEventListener('abort', onAbort);

      try {
        if (this.currentReqId !== reqId) return;

        // Use prefetched blob if it matches, otherwise synthesize fresh.
        let blob: Blob;
        if (this.prefetchedText === text && this.prefetchedBlob) {
          blob = await this.prefetchedBlob;
          this.prefetchedText = null;
          this.prefetchedBlob = null;
        } else {
          this.prefetchedText = null;
          this.prefetchedBlob = null;
          blob = await session.predict(text);
        }
        if (this.currentReqId !== reqId) return;

        const arrayBuf = await blob.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        if (this.currentReqId !== reqId) return;

        await new Promise<void>((res, rej) => {
          try {
            const src = ctx.createBufferSource();
            src.buffer = audioBuf;
            src.playbackRate.value = playbackRate;
            src.connect(ctx.destination);
            this.currentSource = src;
            src.onended = () => {
              if (this.currentSource === src) this.currentSource = null;
              res();
            };
            if (ctx.state === 'suspended') {
              ctx.resume().then(() => src.start(), rej);
            } else {
              src.start();
            }
          } catch (err) {
            rej(err as Error);
          }
        });

        if (this.currentReqId === reqId) finish();
      } catch (err) {
        if (!settled) finish(err as Error);
      }
    });
  }

  cancel(): void {
    this.currentReqId = -1;
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
