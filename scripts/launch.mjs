import { existsSync } from 'node:fs';

// Playwright's Chromium, or installed Chrome or Edge on Windows; BROWSER_PATH picks another.
export async function launchBrowser() {
  const { chromium } = await import('playwright');
  const executablePath =
    process.env.BROWSER_PATH ??
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find(existsSync);
  return chromium.launch({ headless: true, ...(executablePath && { executablePath }) });
}

// GAME_URL when set, otherwise a dev server of our own on a free port.
export async function serve() {
  if (process.env.GAME_URL) return { url: process.env.GAME_URL, close: async () => {} };
  const { createServer } = await import('vite');
  const vite = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 8090, strictPort: false },
  });
  await vite.listen();
  return { url: vite.resolvedUrls.local[0], close: () => vite.close() };
}
