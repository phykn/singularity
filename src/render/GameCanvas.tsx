import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { ElectronScene } from './ElectronScene.ts';
import type { Game } from '../game/Game.ts';
import type { OrbitRhythm } from '../app/OrbitRhythm.ts';

export function GameCanvas({
  getGame,
  getRhythm,
  onReady,
}: {
  getGame: () => Game;
  getRhythm: () => OrbitRhythm;
  onReady: (ready: boolean) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = node.current!;
    onReady(false);
    const scene = new ElectronScene(getGame, getRhythm);
    let engine: Phaser.Game | undefined,
      observer: ResizeObserver | undefined,
      disposed = false;
    void document.fonts
      .load('12px "Singularity Pixel"')
      .catch(() => [])
      .then(() => {
        if (disposed) return;
        engine = new Phaser.Game({
          type: Phaser.AUTO,
          parent: canvas,
          width: Math.round(canvas.clientWidth || 360),
          height: Math.round(canvas.clientHeight || 320),
          backgroundColor: '#080a0e',
          scene: [scene],
          banner: false,
          audio: { noAudio: true },
          render: { antialias: false, pixelArt: true, roundPixels: true },
          scale: { mode: Phaser.Scale.NONE },
          fps: { target: 60 },
        });
        const rendered = () => {
          if (disposed) return;
          if (!scene.sys.isActive()) {
            waitForRender();
            return;
          }
          const renderer = engine!.renderer;
          if (
            !(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) ||
            !renderer.gl.isContextLost()
          )
            onReady(true);
        };
        const waitForRender = () => {
          if (!disposed) engine!.events.once(Phaser.Core.Events.POST_RENDER, rendered);
        };
        waitForRender();
        engine.renderer.on(Phaser.Renderer.Events.LOSE_WEBGL, () => {
          if (!disposed) onReady(false);
        });
        engine.renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, waitForRender);
        observer = new ResizeObserver(() => {
          if (canvas.clientWidth && canvas.clientHeight)
            engine?.scale.resize(Math.round(canvas.clientWidth), Math.round(canvas.clientHeight));
        });
        observer.observe(canvas);
      });
    return () => {
      disposed = true;
      onReady(false);
      observer?.disconnect();
      engine?.destroy(true);
    };
  }, [getGame, getRhythm, onReady]);

  return <div className="canvas" ref={node} />;
}
