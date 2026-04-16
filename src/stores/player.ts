import { writable, get } from 'svelte/store';
import { getTTSEngine, getWebSpeechEngine, markNeuralBroken } from '$lib/tts';
import { settings } from '$stores/settings';
import { chunkBySentences } from '$lib/text-chunker';

export type PlayerStatus = 'idle' | 'playing' | 'paused';

export interface PlayerState {
  status: PlayerStatus;
  chunks: string[];
  currentChunk: number;
  rate: number;
  voiceId?: string;
}

const initial: PlayerState = {
  status: 'idle',
  chunks: [],
  currentChunk: 0,
  rate: 1.0,
};

export const playerState = writable<PlayerState>({ ...initial });

let abortCtrl: AbortController | null = null;
let onFinishedCb: (() => void) | null = null;

function isAbort(err: unknown): boolean {
  return (err as DOMException)?.name === 'AbortError';
}

/**
 * Speak one chunk with engine selection + first-class fallback.
 * If the active engine is a neural one and it throws a non-abort
 * error, we mark it broken for the rest of the session and retry
 * the same chunk with Web Speech so the listener experience doesn't
 * drop mid-chapter.
 */
async function speakChunk(
  text: string,
  rate: number,
  signal: AbortSignal,
): Promise<void> {
  const engine = getTTSEngine();
  const voiceId =
    engine.name === 'piper'
      ? get(settings).voiceId
      : get(playerState).voiceId;

  try {
    await engine.speak(text, { rate, voiceId, signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    if (engine.name !== 'web-speech') {
      markNeuralBroken((err as Error).message ?? String(err));
      await getWebSpeechEngine().speak(text, { rate, signal });
      return;
    }
    throw err;
  }
}

async function runLoop(startIdx: number) {
  abortCtrl?.abort();
  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;

  playerState.update((s) => ({ ...s, status: 'playing', currentChunk: startIdx }));

  try {
    for (let i = startIdx; i < get(playerState).chunks.length; i++) {
      if (signal.aborted) return;
      playerState.update((s) => ({ ...s, currentChunk: i }));
      const { chunks, rate } = get(playerState);
      await speakChunk(chunks[i], rate, signal);
    }
    const cb = onFinishedCb;
    playerState.update((s) => ({ ...s, status: 'idle' }));
    cb?.();
  } catch (err) {
    if (!isAbort(err)) {
      console.error('TTS error:', err);
      playerState.update((s) => ({ ...s, status: 'idle' }));
    }
  }
}

export function startPlaying(text: string, onFinished?: () => void) {
  const chunks = chunkBySentences(text, 20);
  if (chunks.length === 0) {
    onFinished?.();
    return;
  }
  onFinishedCb = onFinished ?? null;
  playerState.update((s) => ({ ...s, chunks, currentChunk: 0 }));
  runLoop(0);
}

export function stopPlaying() {
  abortCtrl?.abort();
  abortCtrl = null;
  onFinishedCb = null;
  getTTSEngine().cancel();
  playerState.set({ ...initial, rate: get(playerState).rate, voiceId: get(playerState).voiceId });
}

export function pausePlaying() {
  const s = get(playerState);
  if (s.status !== 'playing') return;
  getTTSEngine().pause();
  playerState.update((st) => ({ ...st, status: 'paused' }));
}

export function resumePlaying() {
  const s = get(playerState);
  if (s.status !== 'paused') return;
  getTTSEngine().resume();
  playerState.update((st) => ({ ...st, status: 'playing' }));
}

export function nextChunk() {
  const s = get(playerState);
  if (s.chunks.length === 0) return;
  const next = Math.min(s.currentChunk + 1, s.chunks.length - 1);
  abortCtrl?.abort();
  runLoop(next);
}

export function prevChunk() {
  const s = get(playerState);
  if (s.chunks.length === 0) return;
  const prev = Math.max(s.currentChunk - 1, 0);
  abortCtrl?.abort();
  runLoop(prev);
}

export function setRate(rate: number) {
  playerState.update((s) => ({ ...s, rate }));
  const s = get(playerState);
  if (s.status === 'playing') {
    // Restart current chunk at new rate — SpeechSynthesis can't change rate mid-utterance.
    abortCtrl?.abort();
    runLoop(s.currentChunk);
  }
}

export function setVoice(voiceId: string) {
  playerState.update((s) => ({ ...s, voiceId }));
}
