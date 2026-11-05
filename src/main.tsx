import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import { rules } from './game/rules.ts';
import './ui/style.css';

declare global {
  interface Window {
    __rulesVariant?: string;
  }
}

type Plain = Record<string, unknown>;
const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Deep-merges a partial rule set over the live one; arrays replace, objects merge.
function merge(base: Plain, over: Plain): void {
  for (const [key, value] of Object.entries(over)) {
    if (key === 'note') continue;
    const current = base[key];
    if (isPlain(value) && isPlain(current)) merge(current, value);
    else base[key] = value;
  }
}

// Development only: `?rules=<name>` loads design/variants/<name>.json over the rules
// before anything reads them, so a variant can be played without rebuilding.
async function applyVariant(): Promise<void> {
  const name = new URLSearchParams(location.search).get('rules');
  if (!import.meta.env.DEV || !name) return;
  try {
    const response = await fetch(`/design/variants/${encodeURIComponent(name)}.json`);
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return;
    merge(rules as unknown as Plain, (await response.json()) as Plain);
    window.__rulesVariant = name;
  } catch {
    // An unknown or broken variant leaves the rules untouched.
  }
}

await applyVariant();
createRoot(document.getElementById('root')!).render(<App />);
