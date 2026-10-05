import type { UpgradeId } from '../game/rules.ts';

export const BLUE = 0x8ce8fb,
  WHITE = 0xf1fcff,
  AMBER = 0xffd08a,
  GOLD = 0xf9d894;

// Skill identity stays the same across attacks, cards and icons; rarity uses the frame.
export const skillColors: Record<UpgradeId, number> = {
  repeat: 0x75e8e0,
  multi: 0xffdf78,
  chain: 0x79ecaa,
  pierce: 0xbd9aff,
  burst: 0xff96c1,
  strike: 0xffbe69,
  focus: 0xe3b3ff,
  repel: 0x69bdff,
  orb: 0x86dcff,
  charge: 0xf2d886,
  bridge: 0x9bafff,
  gather: 0xb9a2e5,
  stun: 0xc8dd96,
  chase: 0xffad86,
  surge: 0x78dfcc,
  return: 0x94bfff,
  power: 0xffad86,
  rate: 0xc7ed83,
  range: BLUE,
  recover: 0x79ecaa,
};

export const skillColor = (id: UpgradeId) => '#' + skillColors[id].toString(16).padStart(6, '0');
