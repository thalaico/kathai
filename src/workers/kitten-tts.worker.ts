/*
 * KittenTTS inference worker.
 *
 * Pipeline (ported from https://huggingface.co/spaces/shreyask/KittenTTS-WebGPU):
 *   text  → (phonemizer.js, eSpeak NG)
 *        → phonemes
 *        → int64 token ids  (via the Kitten vocab)
 *        → ORT session.run({ input_ids, style, speed })
 *        → Float32Array audio samples @ 24 kHz
 *
 * Loaded lazily: the main thread spawns this worker only when the user
 * opts into KittenTTS in Settings. Model bytes are cached in IndexedDB
 * after the first download so subsequent visits skip the ~23 MB fetch.
 */

/// <reference lib="webworker" />

// Visible in devtools when the worker script parses. If you don't see
// this line in the console, the worker blew up during module init.
console.log('[kathai-tts-worker] booting');

import * as ort from 'onnxruntime-web';
import { phonemize } from 'phonemizer';

console.log('[kathai-tts-worker] modules imported');

// ─────────────────────────────────────────────────────────────
// Vocab + tokenizer (character-level, IPA + ASCII)
// ─────────────────────────────────────────────────────────────

const VOCAB_CHARS = [
  '$',
  ...';:,.!?¡¿—…"«»"" ',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  ...'ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\'̩\'ᵻ',
];

const VOCAB: Record<string, number> = {};
for (let i = 0; i < VOCAB_CHARS.length; i++) VOCAB[VOCAB_CHARS[i]] = i;

function charsToIds(phonemes: string): number[] {
  const ids: number[] = [];
  for (const ch of phonemes) {
    const id = VOCAB[ch];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

function tokenize(phonemes: string): number[] {
  const ids = charsToIds(phonemes);
  ids.unshift(0); // BOS / pad
  ids.push(10); // EOS (vocab[10] = '.')
  ids.push(0); // trailing pad
  return ids;
}

// ─────────────────────────────────────────────────────────────
// .npy and .npz decoders — voices.npz is a zip of numpy arrays
// ─────────────────────────────────────────────────────────────

interface NpyArray {
  data: Float32Array;
  shape: number[];
}

function parseNpyHeader(bytes: Uint8Array): { descr: string; shape: number[]; dataOffset: number } {
  if (bytes[0] !== 0x93 || String.fromCharCode(...bytes.slice(1, 6)) !== 'NUMPY') {
    throw new Error('Not a valid .npy file');
  }
  const major = bytes[6];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let headerLen: number;
  let dataOffset: number;
  if (major === 1) {
    headerLen = view.getUint16(8, true);
    dataOffset = 10;
  } else {
    headerLen = view.getUint32(8, true);
    dataOffset = 12;
  }
  const headerText = new TextDecoder().decode(bytes.slice(dataOffset, dataOffset + headerLen));
  const descrMatch = headerText.match(/'descr'\s*:\s*'([^']+)'/);
  const shapeMatch = headerText.match(/'shape'\s*:\s*\(([^)]*)\)/);
  if (!descrMatch) throw new Error(`Could not parse dtype: ${headerText}`);
  const shape = shapeMatch
    ? shapeMatch[1]
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n))
    : [];
  return { descr: descrMatch[1], shape, dataOffset: dataOffset + headerLen };
}

function parseNpy(bytes: Uint8Array): NpyArray {
  const { descr, shape, dataOffset } = parseNpyHeader(bytes);
  const raw = bytes.slice(dataOffset);
  const buf = new ArrayBuffer(raw.length);
  new Uint8Array(buf).set(raw);
  let data: Float32Array;
  if (descr === '<f4' || descr === 'float32') {
    data = new Float32Array(buf);
  } else if (descr === '<f8' || descr === 'float64') {
    const f64 = new Float64Array(buf);
    data = new Float32Array(f64.length);
    for (let i = 0; i < f64.length; i++) data[i] = f64[i];
  } else {
    throw new Error(`Unsupported npy dtype: ${descr}`);
  }
  return { data, shape };
}

async function parseNpz(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Find End of Central Directory.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('Invalid ZIP: no EOCD');

  const cdOffset = view.getUint32(eocd + 16, true);
  const cdCount = view.getUint16(eocd + 10, true);

  const entries: Array<{
    fileName: string;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    compressionMethod: number;
  }> = [];

  let p = cdOffset;
  for (let i = 0; i < cdCount && view.getUint32(p, true) === 0x02014b50; i++) {
    const compressionMethod = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const fileName = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen));
    entries.push({
      fileName,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      compressionMethod,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const files = new Map<string, Uint8Array>();
  for (const e of entries) {
    const lh = e.localHeaderOffset;
    const nameLen = view.getUint16(lh + 26, true);
    const extraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + nameLen + extraLen;

    let raw: Uint8Array;
    if (e.compressionMethod === 0) {
      raw = bytes.slice(dataStart, dataStart + e.uncompressedSize);
    } else if (e.compressionMethod === 8) {
      // Deflate-raw via DecompressionStream.
      const compressed = bytes.slice(dataStart, dataStart + e.compressedSize);
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      raw = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        raw.set(c, off);
        off += c.length;
      }
    } else {
      console.warn(`Skipping ${e.fileName}: unsupported compression ${e.compressionMethod}`);
      continue;
    }
    files.set(e.fileName, raw);
  }
  return files;
}

async function loadVoicesNpz(
  url: string,
): Promise<Record<string, { data: Float32Array; shape: [number, number] }>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`voices.npz fetch ${res.status}`);
  const files = await parseNpz(await res.arrayBuffer());
  const voices: Record<string, { data: Float32Array; shape: [number, number] }> = {};
  for (const [name, bytes] of files) {
    if (!name.endsWith('.npy')) continue;
    const voiceName = name.replace(/\.npy$/, '');
    const { data, shape } = parseNpy(bytes);
    voices[voiceName] = {
      data,
      shape: [shape[0] || 1, shape[1] || data.length],
    };
  }
  return voices;
}

// ─────────────────────────────────────────────────────────────
// Model caching in IndexedDB (avoid re-downloading ~23 MB)
// ─────────────────────────────────────────────────────────────

const CACHE_DB = 'kathai-tts-cache';
const CACHE_STORE = 'models';

function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key: string): Promise<ArrayBuffer | null> {
  const db = await openCacheDB();
  return new Promise((resolve) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const req = tx.objectStore(CACHE_STORE).get(key);
    req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function cachePut(key: string, buf: ArrayBuffer): Promise<void> {
  const db = await openCacheDB();
  return new Promise((resolve) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put(buf, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function fetchWithProgress(
  url: string,
  key: string,
  report: (pct: number, mb: number) => void,
): Promise<ArrayBuffer> {
  const cached = await cacheGet(key);
  if (cached) {
    report(100, cached.byteLength / 1024 / 1024);
    return cached;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url}: ${res.status}`);

  const total = parseInt(res.headers.get('content-length') ?? '0', 10);
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      const pct = Math.round((received / total) * 100);
      const mb = received / 1024 / 1024;
      report(pct, mb);
    }
  }
  const merged = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  await cachePut(key, merged.buffer);
  return merged.buffer;
}

// ─────────────────────────────────────────────────────────────
// Model loading + inference
// ─────────────────────────────────────────────────────────────

let session: ort.InferenceSession | null = null;
let voices: Record<string, { data: Float32Array; shape: [number, number] }> = {};
let config: any = null;

function hfUrl(repo: string, path: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${path}`;
}

async function loadModel(repoId: string) {
  postStatus('Loading config…');
  let cfgRes = await fetch(hfUrl(repoId, 'kitten_config.json'));
  if (!cfgRes.ok) cfgRes = await fetch(hfUrl(repoId, 'config.json'));
  if (!cfgRes.ok) throw new Error('Missing config.json');
  config = await cfgRes.json();

  postStatus('Downloading model & voices…');

  const modelUrl = hfUrl(
    repoId,
    repoId.startsWith('onnx-community/') ? 'onnx/model.onnx' : config.model_file,
  );
  const voicesUrl = hfUrl(repoId, config.voices || 'voices.npz');

  const modelP = fetchWithProgress(modelUrl, `model:${repoId}`, (pct, mb) =>
    postStatus(`Downloading model… ${pct}% (${mb.toFixed(1)} MB)`),
  );
  const voicesP = loadVoicesNpz(voicesUrl);

  const [modelBuf, loadedVoices] = await Promise.all([modelP, voicesP]);
  voices = loadedVoices;

  postStatus('Initializing ONNX session…');
  ort.env.wasm.numThreads = 1;
  session = await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] });

  const voiceList = config.voice_aliases
    ? Object.keys(config.voice_aliases)
    : Object.keys(voices);

  postMessage({ type: 'ready', voices: voiceList, modelName: config.name });
}

function endWithPeriod(s: string): string {
  s = s.trim();
  if (!s) return s;
  if (!'.!?,;:'.includes(s[s.length - 1])) s += '.';
  return s;
}

function chunkText(text: string, maxLen = 400): string[] {
  const raw = text.match(/[^.!?]*[.!?]+|[^.!?]+$/g) || [text];
  const out: string[] = [];
  for (const s of raw) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxLen) {
      out.push(endWithPeriod(trimmed));
    } else {
      const words = trimmed.split(/\s+/);
      let cur = '';
      for (const w of words) {
        if (cur.length + w.length + 1 <= maxLen) cur += (cur ? ' ' : '') + w;
        else {
          if (cur) out.push(endWithPeriod(cur));
          cur = w;
        }
      }
      if (cur) out.push(endWithPeriod(cur));
    }
  }
  return out;
}

function splitTokens(s: string): string[] {
  return s.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) || [];
}

async function synthChunk(text: string, voiceName: string, speed: number): Promise<Float32Array> {
  if (!session || !config) throw new Error('Model not loaded');

  let actualVoice = voiceName;
  if (config.voice_aliases?.[voiceName]) actualVoice = config.voice_aliases[voiceName];
  const voice = voices[actualVoice];
  if (!voice) throw new Error(`Voice "${voiceName}" not found`);
  if (config.speed_priors?.[actualVoice]) speed *= config.speed_priors[actualVoice];

  // Keep punctuation regions verbatim; phonemize only the word regions.
  const punctRe = /(\s*[;:,.!?¡¿—…"«»""()[\]{}]+\s*)+/g;
  const segments: Array<{ match: boolean; text: string }> = [];
  let last = 0;
  for (const m of text.matchAll(punctRe)) {
    if (m.index === undefined) continue;
    if (last < m.index) segments.push({ match: false, text: text.slice(last, m.index) });
    segments.push({ match: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ match: false, text: text.slice(last) });

  const phonemized = await Promise.all(
    segments.map(async (seg) =>
      seg.match ? seg.text : (await phonemize(seg.text, 'en-us')).join(' '),
    ),
  );
  const phonemes = splitTokens(phonemized.join('')).join(' ');
  const ids = tokenize(phonemes);

  // Voice embedding: [T, D] where T is a per-length style bucket.
  const t = Math.min(text.length, voice.shape[0] - 1);
  const d = voice.shape[1];
  const style = voice.data.slice(t * d, (t + 1) * d);

  const inputIds = new ort.Tensor('int64', BigInt64Array.from(ids.map((n) => BigInt(n))), [
    1,
    ids.length,
  ]);
  const styleT = new ort.Tensor('float32', style, [1, d]);
  const speedT = new ort.Tensor('float32', new Float32Array([speed]), [1]);

  const out = await session.run({ input_ids: inputIds, style: styleT, speed: speedT });
  const audio = out[session.outputNames[0]].data as Float32Array;

  // Trim tail silence observed in StyleTTS2 outputs (~5k samples).
  return audio.length > 24_000 ? audio.slice(0, audio.length - 5_000) : audio;
}

async function synthesize(text: string, voice: string, speed: number) {
  const chunks = chunkText(text);
  postStatus(`Synthesizing (${chunks.length} chunk${chunks.length > 1 ? 's' : ''})…`);

  const parts: Float32Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    postMessage({ type: 'progress', current: i + 1, total: chunks.length });
    parts.push(await synthChunk(chunks[i], voice, speed));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const merged = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    merged.set(p, off);
    off += p.length;
  }
  // transfer the underlying buffer to the main thread for zero-copy.
  postMessage(
    { type: 'audio', audio: merged.buffer, sampleRate: 24_000 },
    { transfer: [merged.buffer] },
  );
}

// ─────────────────────────────────────────────────────────────
// Worker message loop
// ─────────────────────────────────────────────────────────────

function postStatus(message: string) {
  postMessage({ type: 'status', message });
}

self.addEventListener('message', async (e: MessageEvent) => {
  const { action, ...data } = e.data;
  try {
    if (action === 'load') {
      await loadModel(data.repoId);
    } else if (action === 'synthesize') {
      await synthesize(data.text, data.voice, data.speed);
    }
  } catch (err) {
    const e = err as Error;
    // Log to the worker console so it's visible in devtools, then post
    // a formatted error with stack to the main thread.
    console.error('[kathai-tts-worker]', e);
    const detail = `${e.message ?? String(e)}${e.stack ? '\n' + e.stack : ''}`;
    postMessage({ type: 'error', error: detail });
  }
});

self.addEventListener('error', (e) => {
  postMessage({ type: 'error', error: e.message ?? 'Unknown worker error' });
});
