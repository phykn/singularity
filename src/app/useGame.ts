import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game.ts';
import { GameAudio } from './GameAudio.ts';
import { GameSession } from './GameSession.ts';
import { ResultRecords } from './ResultRecords.ts';
import { newSeed } from './seed.ts';
import { readLanguage, readSettings, languageKey, save, settingsKey } from './storage.ts';
import type { Settings } from './storage.ts';
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
  const [storageOk, setStorageOk] = useState(true);
  const failedSaves = useRef(new Set<string>());
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [, redraw] = useState(0);
  const force = useCallback(() => redraw((n) => n + 1), []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const reportSave = useCallback((key: string, ok: boolean): boolean => {
    if (ok) failedSaves.current.delete(key);
    else failedSaves.current.add(key);
    setStorageOk(failedSaves.current.size === 0);
    return ok;
  }, []);

  const write = useCallback(
    (key: string, value: unknown): boolean => {
      try {
        return reportSave(key, save(localStorage, key, value));
      } catch {
        return reportSave(key, false);
      }
    },
    [reportSave],
  );

  const changeSettings = useCallback(
    (next: Settings) => {
      settingsRef.current = next;
      setSettings(next);
      write(settingsKey, next);
    },
    [write],
  );

  const changeLanguage = useCallback(
    (next: Language) => {
      setLanguage(next);
      write(languageKey, next);
    },
    [write],
  );

  const [records] = useState(() => new ResultRecords(() => localStorage, reportSave, force));
  const [session] = useState(() => {
    const game = new Game(newSeed(), { recordEvents: false });
    return new GameSession(game, new GameAudio(), {
      sound: () => settingsRef.current.sound,
      recordResult: (result) => records.record(result, performance.now()),
      audioUnlocked: (enabled) => setAudioUnavailable(!enabled),
      redraw: force,
    });
  });
  const getGame = useCallback(() => session.game, [session]);
  const getRhythm = useCallback(() => session.rhythm, [session]);
  const onRenderReady = useCallback(
    (ready: boolean) => session.setRenderReady(ready, performance.now()),
    [session],
  );

  useEffect(() => {
    document.documentElement.lang = languages.find((entry) => entry.id === language)!.html;
  }, [language]);

  const toggleSound = useCallback(async () => {
    const sound = !settingsRef.current.sound;
    changeSettings({ ...settingsRef.current, sound });
    setAudioUnavailable(false);
    if ((await session.setSound(sound)) === false && settingsRef.current.sound)
      changeSettings({ ...settingsRef.current, sound: false });
  }, [session, changeSettings]);

  const replace = useCallback(() => {
    const game = new Game(newSeed(session.game.seed), { recordEvents: false });
    game.setHidden(document.hidden);
    session.replace(game, performance.now());
  }, [session]);

  const begin = useCallback(() => {
    session.begin(performance.now());
  }, [session]);

  const pause = useCallback(
    (paused: boolean) => {
      session.pause(paused, performance.now());
    },
    [session],
  );
  const tapRhythm = useCallback(() => session.tapRhythm(performance.now()), [session]);
  const toggleChoicePause = useCallback(
    () => session.toggleChoicePause(performance.now()),
    [session],
  );
  const cycleSpeed = useCallback(() => session.cycleSpeed(performance.now()), [session]);
  const continueBeyond = useCallback(() => session.continueBeyond(performance.now()), [session]);
  const select = useCallback(
    (id: UpgradeId, number: number) => session.select(id, number, performance.now()),
    [session],
  );

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
      records.retry(wall);
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
  }, [session, records]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__gameDebug = {
      getModel: getGame,
      getRhythm,
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
  }, [session, getGame, getRhythm, force]);

  return {
    game: session.game,
    getGame,
    getRhythm,
    rhythm: session.rhythm,
    tapRhythm,
    language,
    settings,
    best: records.best,
    bestBeyond: records.beyond,
    storageOk,
    audioUnavailable,
    renderReady: session.renderReady,
    playbackSpeed: session.playbackSpeed,
    pauseOnChoice: session.pauseOnChoice,
    toggleChoicePause,
    cycleSpeed,
    onRenderReady,
    begin,
    continueBeyond,
    pause,
    replace,
    select,
    changeLanguage,
    toggleSound,
  };
}

declare global {
  interface Window {
    __gameDebug?: {
      getModel: () => Game;
      getRhythm: () => import('./OrbitRhythm.ts').OrbitRhythm;
      prepare: (seed: number) => void;
      advance: (ms: number) => void;
      xp: (xp: number) => void;
      restart: (seed: number, combat?: boolean) => void;
    };
  }
}
