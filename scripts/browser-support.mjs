import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { chromium } from 'playwright';

export const base = process.env.GAME_URL ?? 'http://localhost:8081';
export const screenshotsDir = join(
  'artifacts/screenshots',
  new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid,
);
let screenshotCount = 0;

export async function capture(page, path) {
  mkdirSync(screenshotsDir, { recursive: true });
  mkdirSync(dirname(path), { recursive: true });
  const archived = join(
    screenshotsDir,
    String(++screenshotCount).padStart(3, '0') + '-' + basename(path),
  );
  await page.screenshot({ path: archived });
  copyFileSync(archived, path);
  return archived;
}

export function launchBrowser() {
  const executablePath =
    process.env.BROWSER_PATH ??
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find(existsSync);
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
}
