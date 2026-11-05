import './proto.css';
import { Sounds } from './stage.ts';
import type { Run } from './stage.ts';
import { AimRun } from './aim.ts';
import { PilotRun } from './pilot.ts';
import { ChargeRun } from './charge.ts';

type Entry = {
  hash: string;
  title: string;
  hand: string;
  blurb: string;
  make: (root: HTMLElement, seed: number, sounds: Sounds) => Run;
};

const entries: Entry[] = [
  {
    hash: 'a',
    title: 'A. 조준',
    hand: '손 = 어디를 때릴 것인가',
    blurb:
      '전자는 알아서 돌고 번개는 알아서 나간다. 마우스·터치 위치가 조준점이고, 번개는 조준점 근처를 때린다. 손을 놓으면 전자 가까이만 약하게 때린다.',
    make: (root, seed, sounds) => new AimRun(root, seed, sounds),
  },
  {
    hash: 'b',
    title: 'B. 조종',
    hand: '손 = 어디에 있을 것인가',
    blurb:
      '사거리가 짧은 자동 공격. 누르고 있으면 전자가 안으로 파고들고 놓으면 바깥 궤도로 돌아온다. 입자는 껍질로 떠서 천천히 가라앉는다. 핵에 닿으면 끝.',
    make: (root, seed, sounds) => new PilotRun(root, seed, sounds),
  },
  {
    hash: 'c',
    title: 'C. 충전',
    hand: '손 = 언제 놓을 것인가',
    blurb:
      '약한 자동 공격. 누르고 있으면 공격과 소리가 멎고 고리가 자란다. 놓으면 고리 안의 입자가 한꺼번에 터지고 질량이 빠진다. 3초를 넘기면 불발.',
    make: (root, seed, sounds) => new ChargeRun(root, seed, sounds),
  },
];

const root = document.getElementById('proto')!;
const sounds = new Sounds();
let run: Run | null = null;

function picker(): void {
  root.innerHTML = `
    <div class="picker">
      <h1>SINGULARITY · 방향 시제품</h1>
      <p>세 가지 손을 2분 30초씩 해 봅니다. 자동 공격과 레벨 업 카드는 셋 다 있습니다. 소리를 켜고(이어폰) 해 보세요. 키보드: Space · 방향키 · 1/2 · R · Esc.</p>
      ${entries
        .map(
          (e) =>
            `<a class="card" href="#${e.hash}"><b>${e.title}</b> <i>${e.hand}</i><p>${e.blurb}</p></a>`,
        )
        .join('')}
      <a class="card plain" href="/">현재 게임 (v0.1.61)</a>
    </div>`;
}

function play(entry: Entry): void {
  root.innerHTML = `
    <div class="bar">
      <a href="#">← 목록</a>
      <b>${entry.title}</b>
      <span class="help"></span>
      <button class="mute" type="button">소리 끄기</button>
    </div>
    <div class="arena"></div>`;
  const arena = root.querySelector<HTMLElement>('.arena')!;
  const help = root.querySelector<HTMLElement>('.help')!;
  const mute = root.querySelector<HTMLButtonElement>('.mute')!;
  const start = () => {
    run?.destroy();
    run = entry.make(arena, Math.floor(Math.random() * 1e9), sounds);
    window.__proto = { run, sounds };
    help.textContent = run.help;
    run.onExit = (how) => {
      if (how === 'restart') start();
      else location.hash = '';
    };
  };
  mute.onclick = () => {
    sounds.muted = !sounds.muted;
    if (sounds.muted) sounds.stop();
    mute.textContent = sounds.muted ? '소리 켜기' : '소리 끄기';
    run?.canvas.focus({ preventScroll: true });
  };
  start();
}

function render(): void {
  run?.destroy();
  run = null;
  const entry = entries.find((e) => e.hash === location.hash.slice(1));
  if (entry) play(entry);
  else picker();
}

declare global {
  interface Window {
    __proto?: { run: Run; sounds: Sounds };
  }
}

void document.fonts.load('12px "Singularity Pixel KO"').catch(() => []);
window.addEventListener('hashchange', render);
render();
