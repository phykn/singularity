import type { UpgradeId } from '../game/rules.ts';

export const BLUE = 0x8ce8fb,
  WHITE = 0xf1fcff,
  AMBER = 0xffd08a,
  GOLD = 0xf9d894;

// Skill identity stays the same across attacks, cards and icons; rarity uses the frame.
export const skillColors: Record<UpgradeId, number> = {
  area: 0x879fff,
  repeat: 0x75e8e0,
  multi: 0xffdf78,
  chain: 0x79ecaa,
  pierce: 0xbd9aff,
  burst: 0xff96c1,
  strike: 0xffbe69,
  wave: 0x69bdff,
  whip: 0xff9171,
  focus: 0xe3b3ff,
  power: 0xffad86,
  rate: 0xc7ed83,
  range: BLUE,
  recover: 0x79ecaa,
};

export const skillColor = (id: UpgradeId) => '#' + skillColors[id].toString(16).padStart(6, '0');
