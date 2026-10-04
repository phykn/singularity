export const particleIds = ['quark', 'muon', 'proton', 'neutron'] as const;
export type ParticleKind = typeof particleIds[number];

export function particleKind(family: 'small' | 'dense', id: number, stage: number): ParticleKind {
  if (family === 'small') return stage >= 1 && id % 4 === 1 ? 'muon' : 'quark';
  return stage >= 2 && id % 2 === 0 ? 'neutron' : 'proton';
}

export function particleMotion(kind: ParticleKind, age: number) {
  if (kind !== 'muon') return { speed: 1, turn: 1, charging: false, dashing: false };
  const phase = (age + 1e-8) % 2.4;
  const charging = phase < .35, dashing = phase >= .35 && phase < .6;
  // A complete pause/dash cycle covers the same distance as steady movement.
  return { speed: charging ? 0 : dashing ? 2.4 : 1, turn: charging || dashing ? 0 : 4 / 3, charging, dashing };
}

export const particleNames = {
  ko: { quark: '쿼크', muon: '뮤온', proton: '양성자', neutron: '중성자' },
  en: { quark: 'Quark', muon: 'Muon', proton: 'Proton', neutron: 'Neutron' },
  zh: { quark: '夸克', muon: '缪子', proton: '质子', neutron: '中子' },
  ja: { quark: 'クォーク', muon: 'ミューオン', proton: '陽子', neutron: '中性子' },
};

export const particleSymbols = { quark: 'q', proton: 'p', muon: 'μ', neutron: 'n' };
