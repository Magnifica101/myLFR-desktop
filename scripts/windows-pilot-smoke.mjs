#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { win32 as path } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const port = Number(process.env.MYLFR_CDP_PORT ?? '9223');
const backupDirectory = process.env.MYLFR_SMOKE_BACKUP_DIRECTORY;
/**
 * Opt-in. When set, each verified screen is captured as a PNG in this
 * directory, rendered by the real WebView2 engine against real pilot data.
 * Unset, this script behaves exactly as it did before screenshots existed.
 */
const screenshotDirectory = process.env.MYLFR_SMOKE_SCREENSHOT_DIR;
/**
 * Screens are captured at a fixed size so two runs can be compared. 1440x900 is
 * above the 1000px breakpoint at which the sidebar collapses to icons, so the
 * captures show the full navigation rather than the narrow layout.
 */
const SCREENSHOT_WIDTH = 1440;
const SCREENSHOT_HEIGHT = 900;
const expectedVersion = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).version;

if (!backupDirectory) {
  throw new Error('Set MYLFR_SMOKE_BACKUP_DIRECTORY to an existing Windows directory.');
}

/**
 * The dialog automation below drives native file pickers through the clipboard
 * and synthetic keystrokes. Windows denies both to every process while the lock
 * screen is up, so a locked session fails partway through with a wall of
 * clipboard exceptions that never mentions the lock screen. Fail here instead,
 * saying what is actually wrong.
 *
 * LogonUI runs at the lock and login screens and exits once the desktop is
 * unlocked. It is a heuristic, but a reliable one, and a false positive costs
 * only a clear error message.
 */
const { stdout: lockState } = await execFileAsync('powershell.exe', [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  "if (Get-Process LogonUI -ErrorAction SilentlyContinue) { 'locked' } else { 'unlocked' }",
], { windowsHide: true });
assert.equal(
  lockState.trim(),
  'unlocked',
  'The Windows session is locked. This script needs an unlocked, interactive desktop: while the lock screen is up Windows refuses clipboard and keystroke access, which the native dialog steps depend on. Unlock the machine and run it again. Running it from WSL fails the same way, because a process launched there has no interactive desktop.',
);

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('http://tauri.localhost'));
assert(target, 'The myLFR WebView CDP target was not found.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return;
    } catch (error) {
      // The page may be reloading. Keep trying until the deadline, then report
      // the last error so a real fault is not hidden.
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  let body;
  try { body = await evaluate('document.body.innerText'); } catch (error) { body = `(unreadable: ${error.message})`; }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError.message}.` : ''} Visible text:\n${body}`);
}

async function acknowledgeNotice() {
  assert.ok(
    await evaluate("(() => { const button = [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === 'I understand'); if (!button) return false; button.click(); return true; })()"),
    'The responsibilities notice had no I understand button.',
  );
  await waitFor("!document.body.innerText.includes('Before you start')", 'the responsibilities notice to close');
}

let captureSequence = 0;
const captured = [];

/**
 * Captures the current screen. Called only after the assertion for that screen
 * has already passed, so an image always corresponds to a verified state rather
 * than to whatever happened to be on screen.
 *
 * `fullPage` takes the whole scrollable page, so a long screen is reviewable
 * without scrolling the image. Pass `fullPage: false` for anything overlaying
 * the page: `captureBeyondViewport` paints a `position: fixed` element once, at
 * the top, and renders the rest of the page beneath it untouched — so a
 * full-page capture of a modal shows the backdrop covering only the first
 * screenful, which is not what the user sees. Verified against Chromium rather
 * than assumed.
 *
 * The images come back slightly narrower than the override width because the
 * scrollbar is excluded: a 1440 override yields a 1425-wide PNG. That is
 * expected, not a fault.
 */
async function capture(name, { fullPage = true } = {}) {
  if (!screenshotDirectory) return;
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: fullPage,
  });
  const fileName = `${String(++captureSequence).padStart(2, '0')}-${name}.png`;
  await writeFile(path.join(screenshotDirectory, fileName), Buffer.from(data, 'base64'));
  captured.push(fileName);
}

async function invoke(command, args = {}) {
  return evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
}

async function invokeWithNativeDialog(command, args, selectedPath, mode) {
  // The helper writes the path into the dialog's own box and clicks its OK button.
  // It uses no keyboard or clipboard, so it does not need focus and cannot type
  // into another window. It starts first so it is waiting when the dialog opens.
  const automation = execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('./windows-dialog-helper.ps1', import.meta.url)),
    '-Path',
    selectedPath,
    '-Mode',
    mode,
  ], { windowsHide: true });
  // If the helper gives up, fail now rather than wait for a dialog nobody will answer.
  const helperFailed = automation.then(() => new Promise(() => {}), (error) => { throw new Error(`The file dialog helper failed: ${error.stderr || error.message}`); });
  const result = await Promise.race([invoke(command, args), helperFailed]);
  await automation;
  return result;
}

async function setDateField(label, value) {
  return evaluate(`(() => {
    const field = [...document.querySelectorAll('.field')]
      .find((entry) => entry.querySelector('label')?.textContent?.trim() === ${JSON.stringify(label)});
    const input = field?.querySelector('input[type="date"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function selectField(label, value) {
  return evaluate(`(() => {
    const field = [...document.querySelectorAll('.field')]
      .find((entry) => entry.querySelector('label')?.textContent?.trim() === ${JSON.stringify(label)});
    const select = field?.querySelector('select');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

await send('Runtime.enable');
if (screenshotDirectory) {
  await mkdir(screenshotDirectory, { recursive: true });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: SCREENSHOT_WIDTH,
    height: SCREENSHOT_HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

// The responsibilities notice comes before setup on a new installation, and
// again whenever its version rises.
if ((await evaluate('document.body.innerText')).includes('Before you start')) {
  assert.ok(
    await evaluate("(() => { const button = [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === 'I understand'); if (!button) return false; button.click(); return true; })()"),
    'The responsibilities notice had no I understand button.',
  );
  await waitFor("!document.body.innerText.includes('Before you start')", 'the responsibilities notice to close');
}

const initialText = await evaluate('document.body.innerText');
if (initialText.includes('Set up myLFR Desktop')) {
  await evaluate(`(() => {
    const values = ${JSON.stringify({
      lfrName: 'myLFR Pilot Test Limited',
      clientNumber: 'PILOT-001',
      streetNumber: '1',
      streetName: 'Test',
      streetType: 'Lane',
      suburb: 'Synthetic',
      city: 'Wellington',
      postcode: '6011',
    })};
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [id, value] of Object.entries(values)) {
      const element = document.getElementById(id);
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.querySelector('form').requestSubmit();
  })()`);
  await waitFor("document.body.innerText.includes('myLFR at a glance')", 'the dashboard after first-run setup');
}

const profile = await invoke('get_business_profile');
assert.equal(profile.clientNumber, 'PILOT-001');

let fishers = await invoke('list_fishers', { includeArchived: true });
let fisher = fishers.find((entry) => entry.permitNumber === 'PILOT-PERMIT-01');
if (!fisher) {
  fisher = await invoke('upsert_fisher', {
    input: {
      name: 'Synthetic Pilot Fisher',
      permitNumber: 'PILOT-PERMIT-01',
      vessels: [{ name: 'Test Vessel', vesselNumber: 'PILOT-VESSEL-01' }],
    },
  });
}
assert.equal(fisher.vessels.length, 1);

const stocks = await invoke('search_fishstocks', { query: 'SNA1', limit: 10 });
assert(stocks.length > 0, 'The bundled fishstock catalogue did not return SNA1.');
const stock = stocks.find((entry) => entry.code === 'SNA1') ?? stocks[0];

// Dated in the previous month, because Monthly summaries opens on the previous
// month. Computed rather than fixed, so the test works in any month.
const previousMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
const twoDigits = (value) => String(value).padStart(2, '0');
const landingMonth = `${previousMonthStart.getFullYear()}-${twoDigits(previousMonthStart.getMonth() + 1)}`;
const landingMonthLastDay = twoDigits(new Date(previousMonthStart.getFullYear(), previousMonthStart.getMonth() + 1, 0).getDate());
const landingDate = `${landingMonth}-08`;

let landings = await invoke('list_landings', { filters: { limit: 500 } });
let landing = landings.find((entry) => entry.invoiceNumber === 'PILOT-INVOICE-001');
const landingInput = {
  id: landing?.id,
  fisherId: fisher.id,
  vesselId: fisher.vessels[0].id,
  landingDate,
  invoiceNumber: 'PILOT-INVOICE-001',
  items: [{ fishstockCode: stock.code, quantity: 1234 }],
};
landing = await invoke('save_landing', { input: landingInput });
landing = await invoke('save_landing', {
  input: { ...landingInput, id: landing.id, items: [{ fishstockCode: stock.code, quantity: 2345 }] },
});

const revisionsBeforeBackup = await invoke('list_landing_revisions', { landingId: landing.id });
assert(revisionsBeforeBackup.length >= 2, 'Landing revisions were not recorded.');

const backupStatus = await invokeWithNativeDialog(
  'choose_backup_directory',
  {},
  backupDirectory,
  'folder',
);
assert.equal(backupStatus.destinationAvailable, true);
const backupPath = await invoke('backup_now');
const backupValidation = await invokeWithNativeDialog(
  'select_backup_for_restore',
  {},
  backupPath,
  'open',
);
// A backup taken a moment ago must validate at the schema version the running
// application reports, whatever that is today.
const runningSchemaVersion = (await invoke('get_app_info')).schemaVersion;
assert.equal(backupValidation.schemaVersion, runningSchemaVersion, 'The backup did not validate at the running schema version.');

await invoke('save_landing', {
  input: { ...landingInput, id: landing.id, items: [{ fishstockCode: stock.code, quantity: 3456 }] },
});
await invoke('restore_backup', { token: backupValidation.token });
const restoredLanding = await invoke('get_landing', { id: landing.id });
assert.equal(restoredLanding.items[0].quantity, 2345, 'Restore did not recover the backed-up landing value.');

// A restore clears the responsibilities-notice acknowledgement, so the notice
// comes back, as it does for a receiver restoring onto a new computer. The real
// app reloads after a restore; do the same, then acknowledge it again.
await evaluate('location.reload()').catch(() => {});
await waitFor("document.body.innerText.includes('Before you start')", 'the responsibilities notice to return after the restore');
await acknowledgeNotice();
await waitFor("document.body.innerText.includes('myLFR at a glance')", 'the dashboard after the restore');

const report = await invoke('landing_report', {
  filters: {
    fromDate: `${landingMonth}-01`,
    toDate: `${landingMonth}-${landingMonthLastDay}`,
    fisherId: fisher.id,
    vesselId: fisher.vessels[0].id,
    limit: 500,
  },
});
assert.deepEqual(report.unitTotals, [{ reportingUnit: 'greenweightKg', quantity: 2345 }]);
const exportData = await invoke('full_export');
assert(exportData.landings.some((entry) => entry.id === landing.id));
const exportPath = path.join(backupDirectory, 'pilot-full-export.json');
await invokeWithNativeDialog('save_export_file', {
  defaultName: 'pilot-full-export.json',
  fileType: 'json',
  dataBase64: Buffer.from(JSON.stringify(exportData, null, 2)).toString('base64'),
}, exportPath, 'save');
const savedExport = JSON.parse(await readFile(exportPath, 'utf8'));
assert(savedExport.landings.some((entry) => entry.id === landing.id));

const diagnosticsPath = path.join(backupDirectory, 'pilot-diagnostics.json');
await invokeWithNativeDialog('export_diagnostics', {}, diagnosticsPath, 'save');
const diagnosticsText = await readFile(diagnosticsPath, 'utf8');
const diagnostics = JSON.parse(diagnosticsText);
assert.equal(diagnostics.applicationVersion, expectedVersion);
assert.equal(diagnosticsText.includes('PILOT-001'), false, 'Diagnostics exposed the client number.');
assert.equal(diagnosticsText.includes('Synthetic Pilot Fisher'), false, 'Diagnostics exposed landing data.');

// Whether a check is due is only a read: a check is recorded once the update
// server has answered, never when it starts. A failed check must leave the
// 24-hour window open, and a successful one must close it. With nothing
// published the server answers 404 and the check fails; once something is
// published it succeeds. Either way the two have to agree.
const appUpdateWasDue = await invoke('begin_app_update_check');
assert.equal(appUpdateWasDue, true, 'A new installation was not due an update check.');
// An automatic check honours the 24-hour window; a manual one always runs.
const updateCheckFailed = await invoke('check_app_update', { manual: false }).then(() => false, () => true);
assert.equal(
  await invoke('begin_app_update_check'),
  updateCheckFailed,
  updateCheckFailed
    ? 'A failed update check was recorded and closed the 24-hour window.'
    : 'A successful update check did not close the 24-hour window.',
);

// The dashboard is already on screen and already asserted by this point.
await capture('home');

// The one modal in the application, captured because it is the only place
// backdrop-filter is used. A blurred backdrop here is the engine difference that
// a WebKitGTK development window cannot show, since compositing is disabled
// there. Read-only: opening and closing it changes nothing.
if (screenshotDirectory) {
  assert.equal(
    await evaluate("(() => { const b = document.querySelector('.backup-info-button'); if (!b) return false; b.click(); return true; })()"),
    true,
    'The backup information button was not found on Home.',
  );
  await waitFor("document.querySelector('.modal-backdrop') !== null", 'the backup information modal');
  await capture('home-modal', { fullPage: false });
  await evaluate("document.querySelector('[aria-label=\"Close backup information\"]')?.click()");
  await waitFor("document.querySelector('.modal-backdrop') === null", 'the modal to close');
}

await evaluate("location.hash = '#/fishers'");
await waitFor("document.body.innerText.includes('Synthetic Pilot Fisher')", 'the permit-holder screen');
await capture('permit-holders');
await evaluate("location.hash = '#/landings'");
await waitFor("document.body.innerText.includes('PILOT-INVOICE-001') && document.body.innerText.includes('23.45') && document.body.innerText.includes('GW (kg)')", 'the restored landing screen');
await capture('landings');
await evaluate("location.hash = '#/summaries'");
await waitFor("[...document.querySelectorAll('h1')].some((heading) => heading.textContent.trim() === 'Monthly summaries')", 'the monthly summary screen');
assert.equal(await selectField('Permit holder', fisher.id), true, 'The monthly permit-holder filter was not found.');
await waitFor("document.body.innerText.includes('23.45 GW (kg)')", 'the monthly summary');
await capture('monthly-summaries');
await evaluate("location.hash = '#/export'");
await waitFor("[...document.querySelectorAll('h1')].some((heading) => heading.textContent.trim() === 'Export data')", 'the export data screen');
assert.equal(await setDateField('From', `${landingMonth}-01`), true, 'The export From date was not found.');
assert.equal(await selectField('Permit holder', fisher.id), true, 'The export permit-holder filter was not found.');
await waitFor("document.body.innerText.includes('1 row from 1 landing.')", 'the export data row count');
await capture('export-data');
await evaluate("location.hash = '#/settings'");
await waitFor("document.body.innerText.includes('Manage your business details, data safety, and this myLFR installation.') && document.body.innerText.includes('Database backups')", 'business and backup settings');
await capture('settings');

if (screenshotDirectory) {
  await send('Emulation.clearDeviceMetricsOverride');
}

const result = {
  app: await invoke('get_app_info'),
  backupPath,
  backupValidation: {
    catalogueVersion: backupValidation.catalogueVersion,
    schemaVersion: backupValidation.schemaVersion,
  },
  catalogueResult: { code: stock.code, count: stocks.length },
  diagnosticsPath,
  exportPath,
  fisherId: fisher.id,
  landingId: landing.id,
  reportUnitTotals: report.unitTotals,
  revisionCount: revisionsBeforeBackup.length,
  appUpdateWasDue,
  uiRoute: await evaluate('location.hash'),
  screenshots: screenshotDirectory ? { directory: screenshotDirectory, files: captured } : null,
};

console.log(JSON.stringify(result, null, 2));
socket.close();
