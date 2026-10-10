import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game.ts';
import { GameAudio } from './GameAudio.ts';
import { GameSession } from './GameSession.ts';
import { newSeed } from './seed.ts';
import {
  bestRecord,
  bestBeyondRecord,
  readBeyondRecord,
  beyondRecordKey,
  readLanguage,
  readRecord,
  readSettings,
  languageKey,
  recordKey,
  save,
  settingsKey,
} from './storage.ts';
import type { BestRecord, BeyondRecord, Settings } from './storage.ts';
import type { UpgradeId } from '../game/rules.ts';
import { languages } from '../ui/i18n.ts';
import type { Language } from '../ui/i18n.ts';

export function useGame() {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return readLanguage(localStorage);
    } catch {
      return 'ko';
    }
  });
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return readSettings(localStorage);
    } catch {
      return { sound: false };
    }
  });
  const [best, setBest] = useState<BestRecord | null>(() => {
    try {
      return readRecord(localStorage);
    } catch {
      return null;
    }
  });
  const [storageOk, setStorageOk] = useState(true);
  const [bestBeyond, setBestBeyond] = useState<BeyondRecord | null>(() => {
    try {
      return readBeyondRecord(localStorage);
    } catch {
      return null;
    }
  });
  const beyondRef = useRef(bestBeyond);
  beyondRef.current = bestBeyond;
  const failedSaves = useRef(new Set<string>());
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [, redraw] = useState(0);
  const force = () => redraw((n) => n + 1);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const bestRef = useRef(best);
  bestRef.current = best;
  const [audio] = useState(() => new GameAudio());
  const [session] = useState(() => {
    const game = new Game(newSeed(), { recordEvents: false });
    return new GameSession(game, audio, {
      sound: () => settingsRef.current.sound,
      saveResult: (result) => {
        if (result.endless) {
          let record = bestBeyondRecord(beyondRef.current, result);
          try {
            const stored = readBeyondRecord(localStorage);
            if (stored) record = bestBeyondRecord(record, stored);
          } catch {
            /* The write below reports unavailable storage. */
          }
          beyondRef.current = record;
          setBestBeyond(record);
          return write(beyondRecordKey, record);
        }
        let record = bestRecord(bestRef.current, result);
        try {
          const stored = readRecord(localStorage);
          if (stored) record = bestRecord(record, stored);
        } catch {
          /* The write below reports unavailable storage. */
        }
        bestRef.current = record;
        setBest(record);
        return write(recordKey, record);
      },
      redraw: force,
    });
  });
  const getGame = useCallback(() => session.game, [session]);
  const onRenderReady = useCallback(
    (ready: boolean) => session.setRenderReady(ready, performance.now()),
    [session],
  );

  function reportSave(key: string, ok: boolean): boolean {
    if (ok) failedSaves.current.delete(key);
    else failedSaves.current.add(key);
    setStorageOk(failedSaves.current.size === 0);
    return ok;
  }

  function write(key: string, value: unknown): boolean {
    try {
      return reportSave(key, save(localStorage, key, value));
    } catch {
      return reportSave(key, false);
    }
  }

  function changeSettings(next: Settings) {
    settingsRef.current = next;
    setSettings(next);
    write(settingsKey, next);
  }

  function changeLanguage(next: Language) {
    setLanguage(next);
    write(languageKey, next);
  }

  useEffect(() => {
    document.documentElement.lang = languages.find((entry) => entry.id === language)!.html;
  }, [language]);

  async function enableAudio() {
    const enabled = await audio.unlock();
    if (enabled !== null) setAudioUnavailable(!enabled);
    return enabled;
  }

  async function toggleSound() {
    const sound = !settingsRef.current.sound;
    changeSettings({ ...settingsRef.current, sound });
    setAudioUnavailable(false);
    if (!sound) audio.suspend();
    else if ((await enableAudio()) === false && settingsRef.current.sound)
      changeSettings({ ...settingsRef.current, sound: false });
  }

  function replace() {
    const game = new Game(newSeed(session.game.seed), { recordEvents: false });
    game.setHidden(document.hidden);
    session.replace(game, performance.now());
  }

  function begin() {
    if (!session.renderReady) return;
    if (settingsRef.current.sound) void enableAudio();
    session.begin(performance.now());
  }

  function pause(paused: boolean) {
    session.pause(paused, performance.now());
    if (!paused && settingsRef.current.sound) void enableAudio();
  }

  useEffect(() => {
    let frame = 0;
    const visibility = () => session.setHidden(document.hidden, performance.now());
    const suspend = () => session.suspend(performance.now());
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('freeze', suspend);
    document.addEventListener('resume', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', visibility);
    session.game.setHidden(document.hidden);
    const step = (wall: number) => {
      session.step(wall);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('freeze', suspend);
      document.removeEventListener('resume', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', visibility);
      session.dispose();
    };
  }, [session]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__gameDebug = {
      getModel: getGame,
      prepare: (seed: number) => {
        const game = new Game(seed);
        game.setHidden(document.hidden);
        session.replace(game, performance.now());
      },
      advance: (ms: number) => session.advance(ms, performance.now()),
      xp: (xp: number) => {
        session.game.debugSetXp(xp);
        force();
      },
      restart: (seed: number, combat = true) => {
        const game = new Game(seed, { combat });
        game.setHidden(document.hidden);
        game.start();
        session.replace(game, performance.now());
      },
    };
    return () => {
      delete window.__gameDebug;
    };
  }, [session, getGame]);

  return {
    game: session.game,
    getGame,
    language,
    settings,
    best,
    bestBeyond,
    storageOk,
    audioUnavailable,
    renderReady: session.renderReady,
    playbackSpeed: session.playbackSpeed,
    pauseOnChoice: session.pauseOnChoice,
    toggleChoicePause: () => session.toggleChoicePause(performance.now()),
    cycleSpeed: () => session.cycleSpeed(performance.now()),
    onRenderReady,
    begin,
    continueBeyond: () => {
      if (settingsRef.current.sound) void enableAudio();
      session.continueBeyond(performance.now());
    },
    pause,
    replace,
    select: (id: UpgradeId, number: number) => session.select(id, number, performance.now()),
    changeLanguage,
    toggleSound,
  };
}

declare global {
  interface Window {
    __gameDebug?: {
      getModel: () => Game;
      prepare: (seed: number) => void;
      advance: (ms: number) => void;
      xp: (xp: number) => void;
      restart: (seed: number, combat?: boolean) => void;
    };
  }
}
