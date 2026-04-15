import { writable } from 'svelte/store';
import { getFromDB, saveToDB } from '$lib/db';

export type EngineType = 'web-speech' | 'piper';

export interface Settings {
  engine: EngineType;
  voiceId?: string;
}

const DEFAULTS: Settings = {
  engine: 'web-speech',
};

const KEY = 'user';

export const settings = writable<Settings>({ ...DEFAULTS });

let loaded = false;

export async function loadSettings(): Promise<Settings> {
  const row = await getFromDB<{ key: string; engine?: string; voiceId?: string }>(
    'settings',
    KEY,
  );
  const merged: Settings = { ...DEFAULTS, ...((row ?? {}) as Partial<Settings>) };
  delete (merged as any).key;

  // Migrate any legacy 'kitten' engine setting from previous builds.
  if ((merged.engine as string) === 'kitten') {
    merged.engine = 'web-speech';
    merged.voiceId = undefined;
  }

  settings.set(merged);
  loaded = true;
  return merged;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  if (!loaded) await loadSettings();
  settings.update((s) => ({ ...s, ...patch }));
  // Read the just-updated value back out for persistence.
  let current: Settings = { ...DEFAULTS };
  settings.subscribe((v) => (current = v))();
  await saveToDB('settings', { key: KEY, ...current });
}
