import type { UpgradeId } from '../game/rules.ts';

export const BLUE = 0x8ce8fb,
  WHITE = 0xf1fcff,
  AMBER = 0xffd08a,
  GOLD = 0xf9d894,
  VIOLET = 0xb0a0ff;

// Skill identity stays the same across attacks, cards and icons; rarity uses the frame.
export const skillColors: Record<UpgradeId, number> = {
  repeat: 0x75e8e0,
  multi: 0xffdf78,
  chain: 0x79ecaa,
  pierce: 0xbd9aff,
  burst: 0xff96c1,
  strike: 0xffbe69,
  satellite: 0x86dcff,
  charge: 0xf2d886,
  surge: 0xffdf78,
  return: 0x94bfff,
  mark: 0x8ff0ff,
  tempo: 0xffc4e8,
  spark: 0xe3b3ff,
  field: 0x69bdff,
  fission: 0xc8dd96,
  overcharge: 0xff8a5c,
  power: 0xffad86,
  rate: 0xc7ed83,
  range: BLUE,
  crit: 0xffdf78,
  luck: 0xb9c8ff,
  recover: 0x79ecaa,
  overheat: 0xff536b,
  blast: 0xff536b,
  greed: 0xff536b,
  quiet: 0xff536b,
  overclock: 0xff536b,
  pulse: 0xff536b,
  gamble: 0xff536b,
  horizon: 0xff536b,
};

export const skillColor = (id: UpgradeId) => '#' + skillColors[id].toString(16).padStart(6, '0');
