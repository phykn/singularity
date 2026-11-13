import { useLayoutEffect, useRef } from 'react';
import { arenaViewport } from '../render/timeline.ts';
import { ControlIcon } from './icons.tsx';
import { LanguagePicker, Notice, SoundToggle } from './Preferences.tsx';
import { Best } from './Result.tsx';
import { copy } from './text/index.ts';
import type { useGame } from './useGame.ts';

type Controls = ReturnType<typeof useGame>;

// The title screen above the arena: the GitHub link, help and settings, and the name.
export function TitleHead({
  g,
  onOpen,
}: {
  g: Controls;
  onOpen: (panel: 'guide' | 'settings') => void;
}) {
  const c = copy[g.language],
    radius = g.game.rules.orbit.radius,
    caption = useRef<HTMLDivElement>(null),
    github = useRef<HTMLAnchorElement>(null);

  // The name sits halfway between the header and the top of the orbit.
  useLayoutEffect(() => {
    const title = caption.current!,
      link = github.current!,
      layout = title.parentElement!,
      surface = layout.querySelector('.arena')!;
    const position = () => {
      const bounds = surface.getBoundingClientRect(),
        view = arenaViewport(Math.round(bounds.width), Math.round(bounds.height)),
        orbitTop = bounds.top + view.centerY - radius * view.scale,
        center = (link.getBoundingClientRect().bottom + orbitTop) / 2;
      title.style.setProperty('--title-center', `${center - layout.getBoundingClientRect().top}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    for (const node of [layout, surface, link]) observer.observe(node);
    return () => observer.disconnect();
  }, [radius]);

  return (
    <>
      <header className="topbar">
        <a
          ref={github}
          className="github-link"
          href="https://github.com/phykn/singularity"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          title="GitHub"
        >
          <ControlIcon id="github" />
          <span>GitHub</span>
          <ControlIcon id="star" className="github-star" />
        </a>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label={c.guide}
            aria-haspopup="dialog"
            onClick={() => onOpen('guide')}
          >
            <ControlIcon id="help" />
          </button>
          <button
            className="icon-button"
            aria-label={c.settings}
            aria-haspopup="dialog"
            onClick={() => onOpen('settings')}
          >
            <ControlIcon id="settings" />
          </button>
        </div>
      </header>
      <div ref={caption} className="arena-caption">
        <h1 lang="en">SINGULARITY</h1>
      </div>
    </>
  );
}

// Below the arena: sound, START, language and the best results.
export function TitleFoot({ g }: { g: Controls }) {
  const ready = g.session.ready;
  return (
    <div className="preparation">
      <SoundToggle g={g} />
      <button className="primary start" onClick={g.start} disabled={!ready}>
        <span>{ready ? 'START' : copy[g.language].loading}</span>
        <ControlIcon id="next" />
      </button>
      <LanguagePicker g={g} />
      <Best records={g.records} language={g.language} />
      <Notice g={g} />
    </div>
  );
}
