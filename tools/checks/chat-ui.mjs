// Browser regression checks use an isolated profile, an in-memory world and a local provider.
// Run after a desktop build with `pnpm test:ui`; no saved credentials are read or changed.
import { chromium, expect, devices } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';

const android = process.argv.includes('--android') || process.env.CHAT_TEST_TARGET === 'android';
const testPort = android ? 5179 : 5178;
const baseURL = process.env.CHAT_TEST_URL ?? `http://127.0.0.1:${testPort}`;
if (process.env.CHAT_TEST_SCREENSHOTS) await mkdir(process.env.CHAT_TEST_SCREENSHOTS, { recursive: true });
const browser = await chromium.launch({ headless: true });
let requests = [];
const provider = createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const payload = JSON.parse(body);
    requests.push(payload);
    const system = payload.messages[0].content;
    const reply = system.includes('turn director') ? 'Aria' : 'Harbor reply\n[[next:end]]';
    if (!payload.stream) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${provider.address().port}/v1`;
const server = process.env.CHAT_TEST_URL ? undefined : spawn(process.execPath, ['tools/serve.mjs', '--port', String(testPort), '--dir', android ? 'apps/android/dist' : 'apps/desktop/dist'], { stdio: 'ignore' });

function archive(world = 'chat-check') {
  const files = {
    'manifest.yaml': `schemaVersion: "1.0"\nid: ${world}\nname: Chat Check\nversion: 1\nentry: world.yaml`,
    'world.yaml': `id: ${world}\nname: Chat Check\nversion: 1\nentrypoints: []`,
    'index/entities.yaml': 'entities:\n - id: character:aria\n   type: character\n   name: Aria\n   nameEn: Aria\n   tags: []\n   relations: []\n - id: character:borin\n   type: character\n   name: Borin\n   nameEn: Borin\n   tags: []\n   relations: []',
    'timeline/time-slices.yaml': 'timeSlices: []',
    'timeline/states.yaml': 'states: []',
    'assets/media.yaml': 'media: []',
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))));
}

async function openChat(page, name) {
  await page.locator('.dt-student-row').filter({ hasText: name }).click();
  const timeline = page.getByRole('dialog', { name: /Choose timeline/ });
  await expect(timeline.or(page.getByRole('textbox', { name: 'Message', exact: true }))).toBeVisible();
  if (await timeline.isVisible()) {
    await timeline.getByRole('button', { name: 'Timeline', exact: true }).click();
    await timeline.getByRole('option', { name: 'None', exact: true }).click();
    await timeline.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
}

try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(baseURL, { signal: AbortSignal.timeout(500) })).ok) break; } catch { /* Server is starting. */ }
    if (attempt >= 50) throw new Error('Chat test server did not start.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const targets = android ? [['android-build', devices['Pixel 7']]] : [['desktop', { viewport: { width: 1280, height: 800 } }], ['android-size', devices['Pixel 7']]];
  for (const [name, options] of targets) {
    requests = [];
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    if (android) await context.exposeBinding('nativeTestInvoke', async (_source, command, args) => {
      if (command !== 'provider_chat') throw new Error(`Unexpected native command: ${command}`);
      const response = await fetch(`${args.endpoint}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args.request) });
      return (await response.json()).choices[0].message.content;
    });
    await context.addInitScript(({ endpoint, android }) => {
      localStorage.setItem('blue-archive.language', 'en');
      localStorage.setItem('danmutalk.first-run-guide-complete', 'true');
      if (android) {
        localStorage.setItem('world-player.provider', JSON.stringify({ endpoint, model: 'stub', maxCycleSpeakers: 1, maxTokens: 256 }));
        window.__TAURI_INTERNALS__ = { invoke: (command, args) => window.nativeTestInvoke(command, args) };
      }
    }, { endpoint, android });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/credentials', route => route.fulfill(android ? { status: 404, body: '' } : { json: { secret: '', settings: { endpoint, model: 'stub', maxCycleSpeakers: 1, maxTokens: 256 }, settingsUpdatedAt: Date.now() } }));
    if (android) await page.route('**/api/health', route => route.fulfill({ status: 404, body: '' }));
    await page.goto(baseURL);
    await page.locator('input[type=file]').setInputFiles({ name: 'chat-check.zip', mimeType: 'application/zip', buffer: archive() });
    await expect(page.locator('.dt-student-row')).toHaveCount(2);
    await openChat(page, 'Aria');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Aria draft\nsecond line');
    // Switch chats before either has a saved turn; their drafts must stay isolated.
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await openChat(page, 'Borin');
    await expect(composer).toHaveValue('');
    await composer.fill('Borin draft');
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await openChat(page, 'Aria');
    await expect(composer).toHaveValue('Aria draft\nsecond line');
    await composer.fill('Hello harbor\nsecond line');
    // IME Enter must not send while composing.
    await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    await expect(composer).toHaveValue('Hello harbor\nsecond line');
    await composer.evaluate(element => { element.form.requestSubmit(); element.form.requestSubmit(); });
    await expect(page.getByRole('button', { name: 'Continue conversation' })).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('.chat-bubble').filter({ hasText: 'Harbor reply' })).toBeVisible();
    const composerBounds = await composer.boundingBox();
    expect(composerBounds.y + composerBounds.height).toBeLessThanOrEqual(page.viewportSize().height);
    await expect(composer).toHaveValue('');
    const reply = page.locator('.chat-row').filter({ hasText: 'Harbor reply' });
    await reply.hover();
    await reply.getByRole('button', { name: 'Bookmark message' }).click();
    await page.getByRole('button', { name: '★ Saved' }).click();
    await expect(page.locator('.chat-row')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search conversation messages' }).fill('no such message');
    await expect(page.getByText('No matching messages.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search conversation messages' }).fill('HARBOR');
    await expect(page.locator('.chat-row')).toHaveCount(1);
    await reply.getByRole('button', { name: 'Reply to this message' }).click();
    await expect(composer).toHaveValue(/> Aria\n> Harbor reply/);
    await composer.fill('');
    await page.getByRole('searchbox', { name: 'Search conversation messages' }).fill('');
    await page.getByRole('button', { name: '★ Saved' }).click();
    if (process.env.CHAT_TEST_SCREENSHOTS) await page.screenshot({ path: `${process.env.CHAT_TEST_SCREENSHOTS}/${name}-chat.png` });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export conversation' });
    await expect(dialog.getByRole('textbox', { name: 'Transcript preview' })).toHaveValue(/Hello harbor\nsecond line/);
    if (process.env.CHAT_TEST_SCREENSHOTS) await page.screenshot({ path: `${process.env.CHAT_TEST_SCREENSHOTS}/${name}-export.png` });
    if (android) {
      await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard unavailable'); } } }); });
      await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
      await expect(dialog.getByRole('status')).toHaveText('Text selected. Use your device’s Copy command.');
      await expect(dialog.getByRole('button', { name: 'Download .txt' })).toHaveCount(0);
    } else {
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Download .txt' }).click();
      expect((await download).suggestedFilename()).toBe('danmutalk-Chat_Check.txt');
    }
    await dialog.getByRole('textbox').press('Escape');
    await expect(dialog).toBeHidden();
    const before = requests.length;
    await page.getByRole('button', { name: 'Continue conversation' }).click();
    await expect(page.locator('.chat-bubble').filter({ hasText: 'Harbor reply' })).toHaveCount(2);
    expect(requests.length).toBeGreaterThan(before);
    await expect(page.locator('.chat-row.mine')).toHaveCount(1);
    // The package source is not persisted. Reopening it after reload should restore local chat tools.
    await composer.fill('restart draft');
    await page.reload();
    await page.locator('input[type=file]').setInputFiles({ name: 'chat-check.zip', mimeType: 'application/zip', buffer: archive() });
    await openChat(page, 'Aria');
    await expect(composer).toHaveValue('restart draft');
    await page.getByRole('button', { name: '★ Saved' }).click();
    await expect(page.locator('.chat-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'other.zip', mimeType: 'application/zip', buffer: archive('other-world') });
    await openChat(page, 'Aria');
    await expect(composer).toHaveValue('');
    await expect(page.locator('.chat-row')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    console.log(`${name}: drafts, IME, send, search, bookmarks, quote, export, continuation, restart and world isolation PASS`);
    await context.close();
  }
} finally {
  await browser.close();
  provider.close();
  server?.kill();
}
