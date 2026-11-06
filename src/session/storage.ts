// Saved preferences. Keys and formats are the old game's, so saved values keep working.
export const languageIds = ['ko', 'en', 'zh', 'ja'] as const;
export type Language = (typeof languageIds)[number];
export const keys = {
  language: 'singularity.language',
  sound: 'singularity.sound',
  record: 'singularity.record',
  beyond: 'singularity.beyond',
  seed: 'singularity.seed',
};

function read(storage: Storage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
export function save(storage: Storage, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Without a saved choice, the browser's language if it is one of the four, otherwise English.
export function readLanguage(storage: Storage, browser: readonly string[]): Language {
  const saved = read(storage, keys.language);
  if (languageIds.includes(saved as Language)) return saved as Language;
  const spoken = browser.map((tag) => tag.slice(0, 2).toLowerCase());
  return languageIds.find((id) => id === spoken[0]) ?? 'en';
}

// Sound is on unless the player turned it off.
export const readSound = (storage: Storage) => read(storage, keys.sound) !== false;

// A fresh seed that differs from the previous run's and from the one saved last page load.
export function newSeed(storage: Storage, previous?: number): number {
  const stored = Number(read(storage, keys.seed) ?? NaN),
    random = new Uint32Array(1);
  do crypto.getRandomValues(random);
  while (random[0] === previous || random[0] === stored);
  save(storage, keys.seed, random[0]);
  return random[0];
}
