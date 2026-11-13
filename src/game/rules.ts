import values from '../../design/rules.json' with { type: 'json' };
import type { Rules } from '../../design/schema.ts';
import { hash } from './random.ts';

export type { Rules };
// JSON imports widen literal types; `npm run check:design` checks the file against the schema.
export const rules = values as unknown as Rules;
export const rulesHash = (cfg: Rules) => hash(JSON.stringify(cfg)).toString(16).padStart(8, '0');

export type SkillId = keyof Rules['skills'];
export type PactId = keyof Rules['pacts'];
export type StatId = 'power' | 'rate' | 'range' | 'crit' | 'luck';
export type UpgradeId = SkillId | StatId | 'recover' | PactId;
export type Rarity = keyof Rules['growth']['rarity'];
export type PopStyle = Rules['skills'][SkillId]['pop'];
export type ParticleKind = keyof Rules['particles'];
export type BossKind = Rules['bosses'][number]['kind'] | 'higgs';

export const skillIds = Object.keys(rules.skills) as SkillId[];
export const statIds: StatId[] = ['power', 'rate', 'range', 'crit', 'luck'];
export const pactIds = Object.keys(rules.pacts) as PactId[];
export const rarityIds: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const particleIds = Object.keys(rules.particles) as ParticleKind[];

export const isSkill = (id: UpgradeId): id is SkillId => id in rules.skills;
export const isPact = (id: UpgradeId): id is PactId => id in rules.pacts;
export const isStat = (id: UpgradeId): id is StatId => statIds.includes(id as StatId);
