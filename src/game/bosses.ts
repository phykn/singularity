export const bossIds = ['gluon', 'w', 'z', 'tau', 'top', 'higgs'] as const;
export type BossKind = (typeof bossIds)[number];
