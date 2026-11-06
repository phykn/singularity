import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import type { Session } from '../session/Session.ts';
import { Scene } from './Scene.ts';

// Reports ready once the scene has drawn a frame, and not while WebGL is lost.
export function Canvas({
  session,
  onReady,
}: {
  session: Session;
  onReady: (ready: boolean) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = node.current!,
      scene = new Scene(session);
    let engine: Phaser.Game | undefined,
      observer: ResizeObserver | undefined,
      disposed = false;
    onReady(false);
    void document.fonts
      .load('12px "Singularity Pixel"')
      .catch(() => [])
      .then(() => {
        if (disposed) return;
        const game = (engine = new Phaser.Game({
          type: Phaser.AUTO,
          parent,
          width: Math.round(parent.clientWidth || 360),
          height: Math.round(parent.clientHeight || 320),
          backgroundColor: '#080a0e',
          scene: [scene],
          banner: false,
          audio: { noAudio: true },
          render: { antialias: false, pixelArt: true, roundPixels: true },
          scale: { mode: Phaser.Scale.NONE },
          fps: { target: 60 },
        }));
        const wait = () => {
          if (!disposed) game.events.once(Phaser.Core.Events.POST_RENDER, drawn);
        };
        const drawn = () => {
          if (disposed) return;
          if (!scene.sys.isActive()) return wait();
          const renderer = game.renderer;
          if (
            !(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) ||
            !renderer.gl.isContextLost()
          )
            onReady(true);
        };
        wait();
        game.renderer.on(Phaser.Renderer.Events.LOSE_WEBGL, () => !disposed && onReady(false));
        game.renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, wait);
        observer = new ResizeObserver(() => {
          if (parent.clientWidth && parent.clientHeight)
            game.scale.resize(Math.round(parent.clientWidth), Math.round(parent.clientHeight));
        });
        observer.observe(parent);
      });
    return () => {
      disposed = true;
      onReady(false);
      observer?.disconnect();
      engine?.destroy(true);
    };
  }, [session, onReady]);
  return <div className="canvas" ref={node} />;
}
