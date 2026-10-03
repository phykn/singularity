import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import Phaser from 'phaser';
import { ElectronScene } from './scene.ts';
import type { Game } from './game.ts';
import type { Settings } from './storage.ts';

export function GameCanvas({ model, settings }: { model: RefObject<Game | null>; settings: RefObject<Settings> }) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = node.current!;
    const scene = new ElectronScene(() => model.current!, () => settings.current.reduced);
    const engine = new Phaser.Game({
      type: Phaser.AUTO, parent: canvas, width: canvas.clientWidth || 360, height: canvas.clientHeight || 320,
      backgroundColor: '#080a0e', scene: [scene], banner: false, audio: { noAudio: true },
      render: { antialias: true, pixelArt: false, roundPixels: false },
      scale: { mode: Phaser.Scale.NONE }, fps: { target: 60 },
    });
    const observer = new ResizeObserver(() => { if (canvas.clientWidth && canvas.clientHeight) engine.scale.resize(canvas.clientWidth, canvas.clientHeight); });
    observer.observe(canvas);
    return () => { observer.disconnect(); engine.destroy(true); };
  }, []);

  return <div className="canvas" ref={node} />;
}
