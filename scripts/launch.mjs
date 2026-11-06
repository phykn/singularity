// Playwright's Chromium, or installed Chrome or Edge on Windows; BROWSER_PATH picks another.
import { existsSync } from 'node:fs';

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
