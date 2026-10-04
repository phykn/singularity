import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../game/model.ts';
import { GameAudio } from './audio.ts';
import {
  bestRecord,
  readLanguage,
  readRecord,
  readRun,
  readSettings,
  languageKey,
  recordKey,
  save,
  saveRun,
  settingsKey,
} from './storage.ts';
import type { Record as Best, Settings } from './storage.ts';
import type { UpgradeId } from '../game/rules.ts';
import { languages } from '../ui/i18n.ts';
import type { Language } from '../ui/i18n.ts';

const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const frameTickLimit = 8;
const firstSeed = () => {
  const seed = new URLSearchParams(location.search).get('seed');
  return import.meta.env.DEV && seed !== null && /^\d+$/.test(seed)
    ? Number(seed) >>> 0
    : newSeed();
};

export function useGame() {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return readLanguage(localStorage);
    } catch {
      return 'ko';
    }
  });
  const [settings, setSettings] = useState<Settings>(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      return readSettings(localStorage, reduced);
    } catch {
      return { sound: false, reduced };
    }
  });
  const [best, setBest] = useState<Best | null>(() => {
    try {
      return readRecord(localStorage);
    } catch {
      return null;
    }
  });
  const [storageOk, setStorageOk] = useState(true);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [renderReady, setRenderReady] = useState(false);
  const rendered = useRef(false);
  const [, redraw] = useState(0);
  const model = useRef<Game | null>(null);
  model.current ??= (() => {
    try {
      return readRun(localStorage) ?? new Game(firstSeed());
    } catch {
      return new Game(firstSeed());
    }
  })();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const bestRef = useRef(best);
  bestRef.current = best;
  const [sound] = useState(() => new GameAudio());
  const audio = useRef(sound);
  const lastWall = useRef(performance.now());
  const processed = useRef<Game | null>(null);
  const heard = useRef(model.current.events.length);
  const force = () => redraw((n) => n + 1);
  const game = model.current;
  const persist = useCallback((current = model.current!) => {
    try {
      setStorageOk(saveRun(localStorage, current));
    } catch {
      setStorageOk(false);
    }
  }, []);

  const onRenderReady = useCallback(
    (ready: boolean) => {
      rendered.current = ready;
      lastWall.current = performance.now();
      setRenderReady(ready);
      if (!ready) {
        audio.current.suspend();
        persist();
      } else if (
        settingsRef.current.sound &&
        !model.current!.paused &&
        model.current!.phase !== 'ready'
      )
        void audio.current.unlock();
    },
    [persist],
  );

  function changeSettings(next: Settings) {
    settingsRef.current = next;
    setSettings(next);
    try {
      setStorageOk(save(localStorage, settingsKey, next));
    } catch {
      setStorageOk(false);
    }
  }

  function changeLanguage(next: Language) {
    setLanguage(next);
    try {
      setStorageOk(save(localStorage, languageKey, next));
    } catch {
      setStorageOk(false);
    }
  }

  useEffect(() => {
    document.documentElement.lang = languages.find((entry) => entry.id === language)!.html;
  }, [language]);

  async function enableAudio() {
    const enabled = await audio.current.unlock();
    if (enabled !== null) setAudioUnavailable(!enabled);
    return enabled;
  }

  async function toggleSound() {
    const sound = !settingsRef.current.sound;
    changeSettings({ ...settingsRef.current, sound });
    setAudioUnavailable(false);
    if (!sound) audio.current.suspend();
    else if ((await enableAudio()) === false && settingsRef.current.sound)
      changeSettings({ ...settingsRef.current, sound: false });
  }

  function replace(seed = newSeed()) {
    const next = new Game(seed);
    next.setHidden(document.hidden);
    model.current = next;
    persist(next);
    heard.current = 0;
    processed.current = null;
    lastWall.current = performance.now();
    force();
  }

  function begin() {
    if (!rendered.current) return;
    if (settingsRef.current.sound) void enableAudio();
    lastWall.current = performance.now();
    model.current!.start();
    persist();
    force();
  }

  function pause(paused: boolean) {
    model.current!.setManualPause(paused);
    persist();
    lastWall.current = performance.now();
    if (paused) audio.current.suspend();
    else if (settingsRef.current.sound) void enableAudio();
    force();
  }

  useEffect(() => {
    let frame = 0,
      lastDraw = 0,
      lastDrawTick = -1,
      lastSave = 0;
    const visibility = () => {
      if (rendered.current && document.hidden && !model.current!.hiddenPaused)
        model.current!.advance(Math.max(0, performance.now() - lastWall.current), frameTickLimit);
      model.current!.setHidden(document.hidden);
      lastWall.current = performance.now();
      if (document.hidden) {
        audio.current.suspend();
        persist();
      } else if (rendered.current && settingsRef.current.sound && !model.current!.manualPaused)
        void audio.current.unlock();
      force();
    };
    const suspend = () => {
      model.current!.setHidden(true);
      persist();
      audio.current.suspend();
      lastWall.current = performance.now();
    };
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('freeze', suspend);
    document.addEventListener('resume', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', visibility);
    model.current!.setHidden(document.hidden);
    const step = (wall: number) => {
      const current = model.current!;
      if (rendered.current) current.advance(Math.max(0, wall - lastWall.current), frameTickLimit);
      lastWall.current = wall;
      if (audio.current.enabled) audio.current.update(current, heard.current);
      heard.current = current.events.length;
      if (current.result && processed.current !== current) {
        processed.current = current;
        const record = bestRecord(bestRef.current, current.result);
        bestRef.current = record;
        setBest(record);
        try {
          setStorageOk(save(localStorage, recordKey, record));
        } catch {
          setStorageOk(false);
        }
        persist(current);
      }
      if (
        !current.hiddenPaused &&
        current.phase !== 'ready' &&
        current.phase !== 'result' &&
        wall - lastSave >= 1000
      ) {
        persist(current);
        lastSave = wall;
      }
      if (wall - lastDraw > 80 && current.elapsedTicks !== lastDrawTick) {
        force();
        lastDraw = wall;
        lastDrawTick = current.elapsedTicks;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      persist();
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('freeze', suspend);
      document.removeEventListener('resume', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', visibility);
      audio.current.destroy();
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__gameDebug = {
      getModel: () => model.current!,
      advance: (ms: number) => {
        model.current!.advance(ms);
        lastWall.current = performance.now();
        force();
      },
      xp: (xp: number) => {
        model.current!.debugSetXp(xp);
        force();
      },
      restart: (seed: number, combat = true) => {
        const next = new Game(seed, { combat });
        model.current = next;
        heard.current = 0;
        processed.current = null;
        next.start();
        persist(next);
        lastWall.current = performance.now();
        force();
      },
    };
    return () => {
      delete window.__gameDebug;
    };
  }, []);

  function select(id: UpgradeId, number: number) {
    if (!rendered.current) return;
    model.current!.select(id, false, number);
    persist();
    force();
  }

  return {
    game,
    model,
    settingsRef,
    language,
    settings,
    best,
    storageOk,
    audioUnavailable,
    renderReady,
    onRenderReady,
    begin,
    pause,
    replace,
    select,
    changeLanguage,
    changeSettings,
    toggleSound,
  };
}

declare global {
  interface Window {
    __gameDebug?: {
      getModel: () => Game;
      advance: (ms: number) => void;
      xp: (xp: number) => void;
      restart: (seed: number, combat?: boolean) => void;
    };
  }
}
