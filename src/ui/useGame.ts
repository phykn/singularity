import { useCallback, useEffect, useRef, useState } from 'react';
import { GameAudio } from '../audio/GameAudio.ts';
import { Game } from '../game/Game.ts';
import { Session } from '../session/Session.ts';
import { keys, newSeed, readLanguage, readSound, save } from '../session/storage.ts';
import type { Language } from '../session/storage.ts';
import { htmlLang } from './text/index.ts';

// Storage the browser refuses still reads as empty; saving it reports failure.
function browserStorage(): Storage {
  try {
    localStorage.getItem(keys.sound);
    return localStorage;
  } catch {
    return {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable');
      },
    } as unknown as Storage;
  }
}

const now = () => performance.now();

export function useGame() {
  const [storage] = useState(browserStorage);
  const [language, setLanguage] = useState(() =>
    readLanguage(storage, navigator.languages ?? [navigator.language]),
  );
  const [sound, setSound] = useState(() => readSound(storage));
  const [audioFailed, setAudioFailed] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [, setFrame] = useState(0);
  const redraw = useCallback(() => setFrame((n) => n + 1), []);
  const soundRef = useRef(sound);
  const write = useCallback(
    (key: string, value: unknown) => setStorageFailed(!save(storage, key, value)),
    [storage],
  );
  const fresh = useCallback(
    (previous?: number) => new Game(newSeed(storage, previous), { recordEvents: false }),
    [storage],
  );
  const [session] = useState(
    () =>
      new Session(fresh(), new GameAudio(), {
        sound: () => soundRef.current,
        // Off for this page only; the saved choice stays.
        audioFailed: () => {
          soundRef.current = false;
          setSound(false);
          setAudioFailed(true);
        },
        record: () => {},
        redraw,
      }),
  );

  const toggleSound = useCallback(() => {
    const next = !soundRef.current;
    soundRef.current = next;
    setSound(next);
    setAudioFailed(false);
    write(keys.sound, next);
    void session.setSound(next);
  }, [session, write]);
  const changeLanguage = useCallback(
    (next: Language) => {
      setLanguage(next);
      write(keys.language, next);
    },
    [write],
  );
  const onReady = useCallback((ready: boolean) => session.setReady(ready, now()), [session]);

  useEffect(() => {
    document.documentElement.lang = htmlLang(language);
  }, [language]);

  useEffect(() => {
    let frame = 0;
    const hide = () => document.hidden && session.hide(now());
    const leave = () => session.hide(now());
    document.addEventListener('visibilitychange', hide);
    document.addEventListener('freeze', leave);
    window.addEventListener('pagehide', leave);
    const step = (wall: number) => {
      session.frame(wall);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', hide);
      document.removeEventListener('freeze', leave);
      window.removeEventListener('pagehide', leave);
      session.dispose();
    };
  }, [session]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const swap = (game: Game) => {
      session.replace(game, now());
      if (document.hidden) session.hide(now());
    };
    window.__gameDebug = {
      getGame: () => session.game,
      prepare: (seed) => swap(new Game(seed)),
      restart: (seed, combat = true) => {
        const game = new Game(seed, { combat });
        game.start();
        swap(game);
      },
      advance: (ms) => {
        session.game.advance(ms);
        redraw();
      },
    };
    return () => {
      delete window.__gameDebug;
    };
  }, [session, redraw]);

  return {
    session,
    game: session.game,
    language,
    sound,
    audioFailed,
    storageFailed,
    onReady,
    toggleSound,
    changeLanguage,
    start: () => session.start(now()),
    pause: (paused: boolean) => session.pause(paused, now()),
    cycleSpeed: () => session.cycleSpeed(now()),
    restart: () => session.replace(fresh(session.game.seed), now()),
  };
}

declare global {
  interface Window {
    __gameDebug?: {
      getGame: () => Game;
      prepare: (seed: number) => void;
      restart: (seed: number, combat?: boolean) => void;
      advance: (ms: number) => void;
    };
  }
}
