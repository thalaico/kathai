/*
 * TTS engine abstraction.
 *
 * Two engines ship today:
 *   - WebSpeechEngine: the OS's native SpeechSynthesis. Zero download,
 *     instant, works everywhere. Default.
 *   - PiperEngine: on-device neural VITS via @mintplex-labs/piper-tts-web.
 *     ~60 MB one-time download per voice, much better quality, cached
 *     in OPFS so subsequent visits skip the network entirely.
 *
 * Both implement the same TTSEngine interface so the player doesn't
 * care which one is active.
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

import { get } from 'svelte/store';
import { PiperEngine } from './tts-piper';
import { settings } from '$stores/settings';

let _webSpeech: WebSpeechEngine | null = null;
let _piper: PiperEngine | null = null;
/**
 * Sticky flag flipped if Piper ever throws a non-abort error during
 * synthesis. Prevents retrying a broken engine forever; the user can
 * reset it by reloading the page or toggling engines in Settings.
 */
let _piperBroken = false;

export function getWebSpeechEngine(): WebSpeechEngine {
  if (!_webSpeech) _webSpeech = new WebSpeechEngine();
  return _webSpeech;
}

/**
 * Returns the Piper engine singleton. Does NOT auto-load the model —
 * callers are responsible for .load() when the user opts in via
 * Settings or on app startup if the setting is persisted.
 */
export function getPiperEngine(): PiperEngine {
  if (!_piper) _piper = new PiperEngine();
  return _piper;
}

/** Mark the current neural engine as broken for the rest of this session. */
export function markNeuralBroken(reason?: string): void {
  _piperBroken = true;
  if (reason) console.warn('[kathai] neural TTS disabled for session:', reason);
  if (_piper && reason) _piper.markFailed(reason);
}

export function isNeuralBroken(): boolean {
  return _piperBroken;
}

/**
 * The active engine. Honors the user's setting, falls back to Web
 * Speech when:
 *   - the user hasn't opted into a neural engine
 *   - the selected neural engine hasn't finished loading yet
 *   - the neural engine threw a non-abort error earlier this session
 */
export function getTTSEngine(): TTSEngine {
  if (_piperBroken) return getWebSpeechEngine();
  const cfg = get(settings);
  if (cfg.engine === 'piper' && _piper && _piper.isAvailable()) return _piper;
  return getWebSpeechEngine();
}
