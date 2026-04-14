/*
 * TTS engine abstraction.
 *
 * Phase 2 ships with a SpeechSynthesis-backed engine — genuinely on-device,
 * zero download, works everywhere. Phase 2.5 will add a KittenTTS/ONNX engine
 * behind the same interface.
 */

export interface TTSVoice {
  id: string;
  label: string;
  lang: string;
}

export interface TTSEngine {
  readonly name: string;
  isAvailable(): boolean;
  listVoices(): Promise<TTSVoice[]>;
  speak(text: string, opts: SpeakOptions): Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export interface SpeakOptions {
  voiceId?: string;
  rate?: number; // 0.5 – 2.0
  signal?: AbortSignal;
}

/**
 * SpeechSynthesis-backed engine. Uses the OS's native TTS.
 */
export class WebSpeechEngine implements TTSEngine {
  readonly name = 'web-speech';
  private voicesCache: SpeechSynthesisVoice[] = [];
  private voicesReady: Promise<void>;

  constructor() {
    this.voicesReady = this.loadVoices();
  }

  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  private loadVoices(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isAvailable()) {
        resolve();
        return;
      }
      const pick = () => {
        const v = window.speechSynthesis.getVoices();
        if (v.length > 0) {
          this.voicesCache = v;
          resolve();
          return true;
        }
        return false;
      };
      if (pick()) return;
      window.speechSynthesis.onvoiceschanged = () => {
        pick();
      };
      // Failsafe: some engines never fire the event on desktop.
      setTimeout(() => {
        if (this.voicesCache.length === 0) pick();
        resolve();
      }, 1500);
    });
  }

  async listVoices(): Promise<TTSVoice[]> {
    await this.voicesReady;
    return this.voicesCache.map((v) => ({
      id: v.voiceURI,
      label: v.name,
      lang: v.lang,
    }));
  }

  speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (!this.isAvailable()) return Promise.reject(new Error('SpeechSynthesis unavailable'));

    return new Promise((resolve, reject) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = opts.rate ?? 1.0;

      if (opts.voiceId) {
        const match = this.voicesCache.find((v) => v.voiceURI === opts.voiceId);
        if (match) utter.voice = match;
      }

      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve();
      };

      const onAbort = () => {
        window.speechSynthesis.cancel();
        finish(new DOMException('aborted', 'AbortError'));
      };

      utter.onend = () => finish();
      utter.onerror = (e) => {
        // 'interrupted' / 'canceled' fire on cancel(); treat as abort, not error.
        if (e.error === 'interrupted' || e.error === 'canceled') finish(new DOMException('aborted', 'AbortError'));
        else finish(new Error(`SpeechSynthesis error: ${e.error}`));
      };

      if (opts.signal?.aborted) {
        finish(new DOMException('aborted', 'AbortError'));
        return;
      }
      opts.signal?.addEventListener('abort', onAbort);

      window.speechSynthesis.speak(utter);
    });
  }

  cancel(): void {
    if (this.isAvailable()) window.speechSynthesis.cancel();
  }

  pause(): void {
    if (this.isAvailable()) window.speechSynthesis.pause();
  }

  resume(): void {
    if (this.isAvailable()) window.speechSynthesis.resume();
  }
}

let _engine: TTSEngine | null = null;

export function getTTSEngine(): TTSEngine {
  if (!_engine) _engine = new WebSpeechEngine();
  return _engine;
}
