import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist');
const dashboardIndex = path.join(distRoot, 'dashboard', 'index.html');
const rawLeakTerms = [
  'fallback',
  'transcript',
  'confidence',
  'sourceHash',
  'segmentId',
  'subtitle_url',
  'dynamicBillFeedback',
];

await stat(dashboardIndex).catch(() => {
  throw new Error('Missing dist/dashboard/index.html. Run npm run build before real Dashboard QA.');
});

const server = await startServer();
const browser = await launchBrowser();
let cdp;

try {
  cdp = await connectToPage(browser.port);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  const consoleErrors = collectConsoleErrors(cdp);
  const baseUrl = `http://127.0.0.1:${server.port}`;
  let navigationSeq = 0;
  const dashboardUrl = hash => `${baseUrl}/dashboard/index.html?qa=${++navigationSeq}#${hash}`;

  await setViewport(cdp, 1280, 820);
  await navigate(cdp, dashboardUrl('dynamic-bill'));
  await waitFor(cdp, 'document.querySelector("[data-testid=\\"dynamic-bill-less-remind-creator\\"]") !== null');
  await assertNoHorizontalOverflow(cdp, '1280px dynamic bill');

  await click(cdp, '[data-testid="dynamic-bill-less-remind-creator"]');
  await waitFor(cdp, 'document.body.innerText.includes("8 秒") && document.body.innerText.includes("撤销")');
  await setViewport(cdp, 320, 760);
  await assertNoHorizontalOverflow(cdp, '320px pending undo');
  await assertFeedbackDockLayout(cdp, 'pending undo dock', ['撤销', '等待生效']);
  await assertNoRawLeak(cdp);

  await navigate(cdp, dashboardUrl('dynamic-bill'));
  await waitFor(cdp, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("撤销"))');
  await doubleClick(cdp, '[data-testid="dynamic-bill-feedback-undo"]');
  await waitFor(cdp, 'document.body.innerText.includes("已撤销")');
  await waitForQaState(cdp, 'state.pause === null && state.pendingAction === null && state.effectiveCount === 0 && state.undoRequestCount === 1');
  await waitFor(cdp, '!document.body.innerText.includes("撤销窗口已经结束")');

  await setViewport(cdp, 1280, 820);
  await click(cdp, '[data-testid="dynamic-bill-less-remind-creator"]');
  await expirePending(cdp);
  await navigate(cdp, dashboardUrl('dynamic-bill'));
  await waitForQaState(cdp, 'state.effectiveCount === 1 && state.pendingAction === null && state.prompt === null');
  await waitFor(cdp, 'document.querySelector("[data-testid=\\"dynamic-bill-less-remind-creator\\"]") !== null');

  await click(cdp, '[data-testid="dynamic-bill-less-remind-creator"]');
  await expirePending(cdp);
  await navigate(cdp, dashboardUrl('dynamic-bill'));
  await waitForQaState(cdp, 'state.effectiveCount === 2 && state.prompt === null');
  await waitFor(cdp, 'document.querySelector("[data-testid=\\"dynamic-bill-less-remind-creator\\"]") !== null');

  await click(cdp, '[data-testid="dynamic-bill-less-remind-creator"]');
  await expirePending(cdp);
  await navigate(cdp, dashboardUrl('dynamic-bill'));
  await waitFor(cdp, 'document.querySelector("[data-testid=\\"dynamic-bill-review-open\\"]") !== null');
  await waitForQaState(cdp, 'state.effectiveCount === 3 && state.prompt && state.prompt.state === "pending" && state.promptCreatedCount === 1');
  await setViewport(cdp, 320, 760);
  await assertNoHorizontalOverflow(cdp, '320px review prompt');
  await assertFeedbackDockLayout(cdp, 'review prompt dock', ['打开 UP 主页', '暂不处理']);

  await click(cdp, '[data-testid="dynamic-bill-review-open"]', { settleMs: 30 });
  await waitFor(cdp, 'Array.from(document.querySelectorAll("[data-testid^=\\"dynamic-bill-review-\\"]")).every(button => button.disabled)');
  await click(cdp, '[data-testid="dynamic-bill-review-dismiss"]', { settleMs: 30 });
  await waitForQaState(cdp, 'state.openedSpaceCount === 1 && state.dismissedPromptCount === 0');
  await waitFor(cdp, '!document.body.innerText.includes("暂不处理") || !document.querySelector("[data-testid=\\"dynamic-bill-review-dismiss\\"]")');

  await navigate(cdp, dashboardUrl('settings'));
  await waitFor(cdp, 'document.querySelector("[data-testid=\\"settings-dynamic-bill-pauses\\"]") !== null');
  await waitFor(cdp, 'document.body.innerText.includes("QA 示例 UP") && document.body.innerText.includes("恢复提醒")');
  await clickText(cdp, 'button', '恢复提醒');
  await waitFor(cdp, 'document.body.innerText.includes("当前没有暂停提醒的 UP")');
  await waitForQaState(cdp, 'state.pause === null && state.restoreCount === 1');

  await navigate(cdp, dashboardUrl('dynamic-bill'));
  await waitFor(cdp, 'document.querySelector(".dynamic-bill-page") !== null');
  await assertNoHorizontalOverflow(cdp, '320px final dynamic bill');

  await assertNoRawLeak(cdp);
  assert.deepEqual(consoleErrors(), []);
  console.log('PASS dynamic-bill-feedback-state.real-qa');
} finally {
  await cdp?.close().catch(() => {});
  browser.process.kill();
  await rm(browser.profileDir, { recursive: true, force: true }).catch(() => {});
  await new Promise(resolve => server.instance.close(resolve));
}

async function startServer() {
  const instance = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (requestUrl.pathname === '/') {
        response.writeHead(302, { Location: '/dashboard/index.html#dynamic-bill' });
        response.end();
        return;
      }
      if (requestUrl.pathname === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (requestUrl.pathname === '/dashboard/index.html') {
        const html = await readFile(dashboardIndex, 'utf8');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(html.replace('<script type="module"', `<script>${fixtureScript()}</script>\n  <script type="module"`));
        return;
      }

      const target = safeDistPath(requestUrl.pathname);
      const file = await readFile(target);
      response.writeHead(200, { 'Content-Type': contentType(target) });
      response.end(file);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  const port = await freePort();
  await new Promise(resolve => instance.listen(port, '127.0.0.1', resolve));
  return { instance, port };
}

function safeDistPath(urlPath) {
  const normalized = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const target = path.join(distRoot, normalized);
  if (!target.startsWith(distRoot)) throw new Error('Path traversal');
  return target;
}

function contentType(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function launchBrowser() {
  const browserPath = await firstExistingBrowser(process.env.BILI_BILL_QA_BROWSER
    ? [process.env.BILI_BILL_QA_BROWSER]
    : [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]);
  const port = await freePort();
  const profileDir = await mkdtemp(path.join(tmpdir(), 'bili-bill-real-qa-'));
  await mkdir(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ];
  const child = spawn(browserPath, args, { stdio: 'ignore' });
  child.on('error', error => {
    child.spawnError = error;
  });
  return { process: child, port, profileDir };
}

async function firstExistingBrowser(candidate) {
  const candidates = Array.isArray(candidate) ? candidate : [candidate];
  for (const item of candidates) {
    if (!item) continue;
    try {
      await stat(item);
      return item;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('No Chrome or Edge executable found. Set BILI_BILL_QA_BROWSER to run real Dashboard QA.');
}

async function connectToPage(port) {
  let lastError = '';
  let lastTargets = '';
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      lastTargets = targets.map(target => `${target.type}:${target.url}`).join(' | ');
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)
        ?? targets.find(target => target.type !== 'background_page' && target.webSocketDebuggerUrl);
      if (page) return new CdpSession(page.webSocketDebuggerUrl);
      if (targets.length > 0) {
        await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // Browser is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for browser CDP target. Last error: ${lastError || 'none'}. Last targets: ${lastTargets || 'none'}`);
}

function CdpSession(url) {
  this.nextId = 1;
  this.pending = new Map();
  this.waiters = [];
  this.socket = new WebSocket(url);
  this.ready = new Promise((resolve, reject) => {
    this.socket.addEventListener('open', resolve, { once: true });
    this.socket.addEventListener('error', reject, { once: true });
  });
  this.socket.addEventListener('message', event => this.handleMessage(event));

  this.send = async (method, params = {}) => {
    await this.ready;
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  };

  this.waitForEvent = (method, predicate = () => true, timeoutMs = 5000) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(waiter => waiter !== waiterEntry);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const waiterEntry = { method, predicate, resolve, reject, timer };
      this.waiters.push(waiterEntry);
    });
  };

  this.handleMessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (!message.method) return;
    for (const waiter of [...this.waiters]) {
      if (waiter.method !== message.method || !waiter.predicate(message.params ?? {})) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter(item => item !== waiter);
      waiter.resolve(message.params ?? {});
    }
  };

  this.close = async () => {
    await this.ready.catch(() => {});
    this.socket.close();
  };
}

function collectConsoleErrors(cdp) {
  const errors = [];
  cdp.waiters.push({
    method: 'Runtime.consoleAPICalled',
    predicate(params) {
      if (params.type === 'error') errors.push(params.args?.map(arg => arg.value ?? arg.description).join(' ') ?? 'console.error');
      return false;
    },
    resolve() {},
    reject() {},
    timer: undefined,
  });
  cdp.waiters.push({
    method: 'Runtime.exceptionThrown',
    predicate(params) {
      errors.push(params.exceptionDetails?.text ?? 'Runtime exception');
      return false;
    },
    resolve() {},
    reject() {},
    timer: undefined,
  });
  cdp.waiters.push({
    method: 'Log.entryAdded',
    predicate(params) {
      if (params.entry?.level === 'error') errors.push(params.entry.text ?? 'Log error');
      return false;
    },
    resolve() {},
    reject() {},
    timer: undefined,
  });
  return () => errors;
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, 'document.readyState === "complete" && document.querySelector("#app") !== null');
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 480,
  });
}

async function click(cdp, selector, options = {}) {
  await evaluate(cdp, `(() => {
    const selector = ${JSON.stringify(selector)};
    const element = document.querySelector(selector);
    if (!element) throw new Error("Missing selector: " + selector);
    element.click();
    return true;
  })()`);
  await delay(options.settleMs ?? 160);
}

async function clickText(cdp, selector, text) {
  await evaluate(cdp, `(() => {
    const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find(node => node.textContent.includes(${JSON.stringify(text)}));
    if (!element) throw new Error("Missing text: ${text}");
    element.click();
    return true;
  })()`);
  await delay(160);
}

async function doubleClick(cdp, selector) {
  await evaluate(cdp, `(() => {
    const selector = ${JSON.stringify(selector)};
    const element = document.querySelector(selector);
    if (!element) throw new Error("Missing selector: " + selector);
    element.click();
    element.click();
    return true;
  })()`);
  await delay(220);
}

async function waitFor(cdp, expression, timeoutMs = 6000) {
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await evaluate(cdp, `Boolean(${expression})`)) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for expression: ${expression}${lastError ? ` (${lastError})` : ''}`);
}

async function waitForQaState(cdp, expression) {
  await waitFor(cdp, `(() => {
    const state = window.__BiliBillDynamicBillQa.state();
    return Boolean(${expression});
  })()`);
}

async function expirePending(cdp) {
  await evaluate(cdp, 'window.__BiliBillDynamicBillQa.expirePending()');
}

async function assertNoRawLeak(cdp) {
  const text = await evaluate(cdp, 'document.body.innerText');
  for (const term of rawLeakTerms) {
    assert.equal(text.includes(term), false, `Visible raw term leaked: ${term}`);
  }
  assert.equal(/未消费|猜你喜欢/.test(text), false, 'Visible banned Dynamic Bill wording leaked');
}

async function assertNoHorizontalOverflow(cdp, label) {
  const overflow = await evaluate(cdp, `(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) - window.innerWidth;
  })()`);
  assert.ok(overflow <= 1, `${label} has horizontal overflow: ${overflow}`);
}

async function assertFeedbackDockLayout(cdp, label, expectedButtonTexts) {
  const result = await evaluate(cdp, `(() => {
    const dock = document.querySelector('.dynamic-bill-feedback-dock');
    if (!dock) return { missing: true };
    const dockRect = rectData(dock.getBoundingClientRect());
    const buttons = Array.from(dock.querySelectorAll('button')).map(button => ({
      text: button.textContent.trim(),
      disabled: button.disabled,
      rect: rectData(button.getBoundingClientRect()),
    }));
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const horizontalOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth;
    const overlaps = [];
    for (let i = 0; i < buttons.length; i += 1) {
      for (let j = i + 1; j < buttons.length; j += 1) {
        if (rectsOverlap(buttons[i].rect, buttons[j].rect)) {
          overlaps.push([buttons[i].text, buttons[j].text]);
        }
      }
    }
    return {
      missing: false,
      dockRect,
      buttons,
      viewport,
      horizontalOverflow,
      dockInViewport: inViewport(dockRect, viewport),
      buttonsInViewport: buttons.every(button => button.rect.width > 20 && button.rect.height > 20 && inViewport(button.rect, viewport)),
      overlaps,
    };

    function rectData(rect) {
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }

    function inViewport(rect, viewport) {
      return rect.left >= -1
        && rect.top >= -1
        && rect.right <= viewport.width + 1
        && rect.bottom <= viewport.height + 1;
    }

    function rectsOverlap(a, b) {
      return a.left < b.right - 1
        && a.right > b.left + 1
        && a.top < b.bottom - 1
        && a.bottom > b.top + 1;
    }
  })()`);

  assert.equal(result.missing, false, `${label} is missing`);
  assert.ok(result.horizontalOverflow <= 1, `${label} has horizontal overflow: ${result.horizontalOverflow}`);
  assert.equal(result.dockInViewport, true, `${label} dock is outside viewport: ${JSON.stringify(result)}`);
  assert.equal(result.buttonsInViewport, true, `${label} buttons are clipped: ${JSON.stringify(result)}`);
  assert.deepEqual(result.overlaps, [], `${label} buttons overlap: ${JSON.stringify(result.overlaps)}`);
  for (const text of expectedButtonTexts) {
    assert.ok(
      result.buttons.some(button => button.text.includes(text)),
      `${label} missing button text: ${text}`,
    );
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      ?? result.exceptionDetails.exception?.value
      ?? result.exceptionDetails.text
      ?? 'Runtime.evaluate failed';
    throw new Error(String(detail));
  }
  return result.result?.value;
}

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fixtureScript() {
  return String.raw`
(() => {
  const STORE_KEY = 'biliBillDynamicBillQaStateV1';
  const DAY_MS = 86400000;
  const CREATOR_MID = 2001;
  const CREATOR_NAME = 'QA 示例 UP';
  const config = {
    dailyWatchGoal: 60,
    weeklyWatchGoal: 420,
    overDependencyThreshold: 0.3,
    syncIntervalMinutes: 5,
    retentionDays: 90,
    showSidebar: true,
    theme: 'dark',
    ai: { baseURL: 'https://api.example.test', apiKey: '', chatModel: 'qa-model' },
    assistant: { currentVideoAiAssistantEnabled: false, smartFavoritesQaAiEnabled: false },
    dynamicBill: { aiExplanationsEnabled: false },
  };

  function initialState() {
    return {
      itemSeq: 1,
      item: makeItem(1, 'unopened'),
      pendingAction: null,
      pause: null,
      effectiveCount: 0,
      prompt: null,
      promptCreatedCount: 0,
      openedSpaceCount: 0,
      dismissedPromptCount: 0,
      restoreCount: 0,
      undoneTokens: [],
      undoRequestCount: 0,
      lastUndoStatuses: [],
    };
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || initialState();
    } catch {
      return initialState();
    }
  }

  function saveState(state) {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function finalizeIfNeeded(state, now = Date.now()) {
    if (!state.pendingAction || state.pendingAction.undoDeadlineAt > now) return;
    state.pendingAction = null;
    state.effectiveCount += 1;
    if (state.effectiveCount >= 3 && !state.prompt) {
      state.prompt = {
        creatorMid: CREATOR_MID,
        creatorName: CREATOR_NAME,
        effectiveCount: state.effectiveCount,
        createdAt: now,
        state: 'pending',
      };
      state.promptCreatedCount += 1;
    }
    state.itemSeq += 1;
    state.item = makeItem(state.itemSeq, 'unopened');
  }

  function applyLessReminder(state, now = Date.now()) {
    if (state.pendingAction) {
      return {
        status: 'already_pending',
        action: state.pendingAction,
        item: state.item,
      };
    }
    const actionKey = 'qa-action-' + now + '-' + state.itemSeq;
    state.item = { ...state.item, status: 'processed', processedAt: now };
    state.pause = {
      creatorMid: CREATOR_MID,
      creatorName: CREATOR_NAME,
      startedAt: now,
      expiresAt: now + 30 * DAY_MS,
      source: 'user',
      remainingDays: 30,
      actionKey,
      updatedAt: now,
    };
    state.pendingAction = {
      actionKey,
      billKey: state.item.billKey,
      creatorMid: CREATOR_MID,
      creatorName: CREATOR_NAME,
      undoToken: 'qa-undo-' + actionKey,
      undoDeadlineAt: now + 8000,
      createdAt: now,
    };
    return {
      status: 'pending_undo',
      action: state.pendingAction,
      item: state.item,
    };
  }

  function undoLessReminder(state, undoToken) {
    if (state.undoneTokens.includes(undoToken)) {
      return { status: 'already_undone', item: state.item };
    }
    if (!state.pendingAction || state.pendingAction.undoToken !== undoToken) {
      return { status: 'invalid' };
    }
    state.pendingAction = null;
    state.pause = null;
    state.item = { ...state.item, status: 'unopened' };
    delete state.item.processedAt;
    state.undoneTokens.push(undoToken);
    return { status: 'undone', item: state.item };
  }

  function resolvePrompt(state, decision) {
    if (!state.prompt || state.prompt.state !== 'pending') {
      return { status: 'not_found' };
    }
    const promptView = {
      creatorMid: state.prompt.creatorMid,
      creatorName: state.prompt.creatorName,
      effectiveCount: state.prompt.effectiveCount,
      createdAt: state.prompt.createdAt,
    };
    state.prompt.state = decision === 'open_space' ? 'opened' : 'dismissed';
    if (decision === 'open_space') state.openedSpaceCount += 1;
    else state.dismissedPromptCount += 1;
    state.prompt = null;
    return {
      status: 'resolved',
      prompt: promptView,
      url: decision === 'open_space' ? 'https://space.bilibili.com/' + CREATOR_MID : undefined,
    };
  }

  function localDataSummary(state) {
    const now = Date.now();
    return {
      checkedAt: now,
      history: { totalRecords: 0, oldestViewAt: null, newestViewAt: null, lastSyncedAt: null, syncing: false, backfillComplete: false },
      favorites: { folderCount: 0, reportedItems: 0, storedItems: 0, indexedItems: 0, failedIndexItems: 0, pendingIndexItems: 0, incompleteFolders: 0, syncComplete: true, lastSyncedAt: null, lastIndexedAt: null },
      currentVideoSubtitles: { sourceCount: 0, segmentCount: 0, staleSegmentCount: 0, cachedVideoCount: 0, lastUpdatedAt: null },
      dynamicBill: {
        activeFollowedCreatorCount: 1,
        followedVideoUpdateCount: 1,
        billItemCount: 1,
        rotationRecordCount: 0,
        creatorPauseCount: state.pause ? 1 : 0,
        feedbackActionCount: state.pendingAction ? 1 : 0,
        creatorFeedbackCount: state.effectiveCount > 0 ? 1 : 0,
        creatorReviewPromptCount: state.prompt ? 1 : 0,
        activeCreatorPauses: state.pause ? [toPauseView(state.pause)] : [],
        unopenedItems: state.item.status === 'unopened' ? 1 : 0,
        openedItems: state.item.status === 'opened' ? 1 : 0,
        consumedItems: state.item.status === 'consumed' ? 1 : 0,
        processedItems: state.item.status === 'processed' ? 1 : 0,
        explanationCount: 0,
        lastGeneratedAt: state.item.generatedAt,
        lastSyncedAt: now,
        syncStatus: 'success',
      },
    };
  }

  function toPauseView(pause) {
    return {
      version: pauseVersion(pause),
      creatorMid: pause.creatorMid,
      creatorName: pause.creatorName,
      startedAt: pause.startedAt,
      expiresAt: pause.expiresAt,
      source: pause.source,
      remainingDays: Math.max(0, Math.ceil((pause.expiresAt - Date.now()) / DAY_MS)),
    };
  }

  function pauseVersion(pause) {
    return [
      pause.creatorMid,
      pause.startedAt,
      pause.expiresAt,
      pause.source,
      pause.actionKey || '',
      pause.updatedAt || pause.startedAt,
    ].join(':');
  }

  function makeItem(seq, status) {
    const now = Date.now();
    return {
      billKey: 'qa-bill-' + seq,
      column: 'follow_rotation',
      status,
      updateKey: 'qa-update-' + seq,
      creatorMid: CREATOR_MID,
      creatorName: CREATOR_NAME,
      creatorFace: '',
      historyBvids: [],
      evidence: {
        kind: 'follow_rotation',
        longWindow: windowEvidence(180),
        recentWindow: windowEvidence(30),
        newVideo: {
          updateKey: 'qa-update-' + seq,
          dynamicId: 'qa-dynamic-' + seq,
          bvid: 'BV1QaDynamic' + String(seq).padStart(2, '0'),
          avid: 9000 + seq,
          title: 'QA 动态账单示例视频 ' + seq,
          cover: '',
          duration: 180,
          pubtime: Math.floor(now / 1000) - 3600,
          dynamicTime: Math.floor(now / 1000) - 1800,
          tagName: '知识',
          tags: ['QA'],
        },
        follow: { followAgeKnown: false },
        cooldownRatio: 0,
        daysSinceLastWatch: null,
        facts: ['来自已关注 UP 的最近视频投稿。'],
        thresholds: {
          longWindowDays: 180,
          recentWindowDays: 30,
          updateWindowDays: 7,
          positiveCompletionRate: 0.5,
          minPositiveWatchSeconds: 180,
          minBuriedFollowAgeDays: 180,
          minObservedFollowDays: 30,
          minBuriedWeakWatchCount: 1,
          maxBuriedRecentWatchCount: 1,
          maxBuriedRecentPositiveWatchCount: 0,
          maxItemsPerColumn: 5,
          maxItemsTotal: 15,
        },
      },
      localRank: seq,
      score: 1,
      generatedAt: now,
    };
  }

  function windowEvidence(windowDays) {
    return {
      windowDays,
      startedAt: 0,
      endedAt: 0,
      watchedCount: 0,
      positiveWatchCount: 0,
      totalWatchTimeSeconds: 0,
      avgCompletion: 0,
      lastWatchedAt: 0,
    };
  }

  async function handleMessage(message) {
    const state = loadState();
    finalizeIfNeeded(state);
    let data;
    switch (message.action) {
      case 'GET_SYNC_STATUS':
        data = { lastSyncTime: Date.now(), totalRecords: 0, syncing: false, backfillComplete: false, syncProgress: null };
        break;
      case 'GET_CONFIG':
        data = config;
        break;
      case 'GET_DYNAMIC_BILL_OVERVIEW':
        data = {
          syncState: { status: 'success', stage: 'complete', lastStartedAt: Date.now() - 1000, lastFinishedAt: Date.now() - 500, lastSuccessAt: Date.now() - 500 },
          followedCreatorCount: 1,
          activeFollowedCreatorCount: 1,
          followAgeKnownCount: 0,
          followAgeUnknownCount: 1,
          recentVideoUpdateCount: 1,
          lastVideoDynamicTime: Math.floor(Date.now() / 1000),
          updateWindowDays: 7,
        };
        break;
      case 'GET_DYNAMIC_BILL_FILTER':
        data = { status: 'active', updatedAt: Date.now() };
        break;
      case 'UPDATE_DYNAMIC_BILL_FILTER':
        data = { status: message.params?.status || 'active', updatedAt: Date.now() };
        break;
      case 'GET_DYNAMIC_BILL_ITEMS':
        data = [state.item];
        break;
      case 'GET_DYNAMIC_BILL_FEEDBACK_STATE':
        data = {
          pendingActions: state.pendingAction ? [state.pendingAction] : [],
          reviewPrompts: state.prompt && state.prompt.state === 'pending'
            ? [{ creatorMid: state.prompt.creatorMid, creatorName: state.prompt.creatorName, effectiveCount: state.prompt.effectiveCount, createdAt: state.prompt.createdAt }]
            : [],
        };
        break;
      case 'APPLY_DYNAMIC_BILL_CREATOR_LESS_REMINDER':
        data = applyLessReminder(state);
        break;
      case 'UNDO_DYNAMIC_BILL_CREATOR_LESS_REMINDER':
        data = undoLessReminder(state, message.params?.undoToken);
        state.undoRequestCount += 1;
        state.lastUndoStatuses.push(data.status);
        break;
      case 'OPEN_DYNAMIC_BILL_CREATOR_REVIEW_PROMPT':
        data = resolvePrompt(state, 'open_space');
        await new Promise(resolve => setTimeout(resolve, 180));
        break;
      case 'DISMISS_DYNAMIC_BILL_CREATOR_REVIEW_PROMPT':
        data = resolvePrompt(state, 'dismiss');
        await new Promise(resolve => setTimeout(resolve, 180));
        break;
      case 'GET_LOCAL_DATA_PRIVACY_SUMMARY':
        data = localDataSummary(state);
        break;
      case 'RESTORE_DYNAMIC_BILL_CREATOR_REMINDER':
        if (!state.pause) {
          data = { status: 'not_found' };
        } else if (pauseVersion(state.pause) !== message.params?.pauseVersion) {
          data = { status: 'stale', currentPause: toPauseView(state.pause) };
        } else {
          const pause = toPauseView(state.pause);
          state.pause = null;
          state.restoreCount += 1;
          data = { status: 'restored', pause };
        }
        break;
      default:
        data = {};
    }
    saveState(state);
    return { success: true, data };
  }

  window.chrome = {
    runtime: {
      sendMessage: handleMessage,
      getURL: path => path,
    },
    storage: {
      onChanged: { addListener() {}, removeListener() {} },
      local: { get: async () => ({}), set: async () => {} },
    },
    permissions: {
      contains(_options, callback) { callback(true); },
      request(_options, callback) { callback(true); },
    },
  };

  window.__BiliBillDynamicBillQa = {
    state() {
      const state = loadState();
      finalizeIfNeeded(state);
      saveState(state);
      return state;
    },
    expirePending() {
      const state = loadState();
      if (state.pendingAction) state.pendingAction.undoDeadlineAt = Date.now() - 1;
      finalizeIfNeeded(state);
      saveState(state);
      return state;
    },
    reset() {
      const state = initialState();
      saveState(state);
      return state;
    },
  };

  if (!localStorage.getItem(STORE_KEY)) {
    saveState(initialState());
  }
})();
`;
}
