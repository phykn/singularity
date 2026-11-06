import type { Language } from '../../session/storage.ts';
import { en } from './en.ts';
import { ja } from './ja.ts';
import { ko } from './ko.ts';
import type { Copy } from './ko.ts';
import { zh } from './zh.ts';

export type { Copy, Language };
export const copy: Record<Language, Copy> = { ko, en, zh, ja };
export const languages: { id: Language; label: string; html: string }[] = [
  { id: 'ko', label: '한국어', html: 'ko' },
  { id: 'en', label: 'ENG', html: 'en' },
  { id: 'zh', label: '中文', html: 'zh-CN' },
  { id: 'ja', label: '日本語', html: 'ja' },
];
export const htmlLang = (language: Language) => languages.find((l) => l.id === language)!.html;
