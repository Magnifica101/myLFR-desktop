import { X509Certificate } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';

const { GITHUB_ACTIONS, GITHUB_ENV, MYLFR_PILOT_VERSION: version, MYLFR_PILOT_UPDATE_CA: encodedCa } = process.env;
if (GITHUB_ACTIONS !== 'true' || !GITHUB_ENV || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version ?? '')
  || version.split('.').some((part) => Number(part) > 65535 || String(Number(part)) !== part)) {
  throw new Error('Prepare the updater pilot in GitHub Actions with a numeric Windows version.');
}
if (!encodedCa || encodedCa.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedCa)
  || !new X509Certificate(Buffer.from(encodedCa, 'base64')).ca) {
  throw new Error('The updater pilot requires a public test CA certificate in DER format.');
}

const name = 'myLFR Desktop Updater Pilot';
const binary = 'mylfr-updater-pilot';
const baseUrl = 'https://127.0.0.1:18743';
const read = (path) => readFile(path, 'utf8');
async function updateJson(path, edit) {
  const value = JSON.parse(await read(path));
  edit(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
async function replace(path, pattern, replacement) {
  const source = await read(path);
  if (!pattern.test(source)) throw new Error(`Expected pilot setting is missing from ${path}.`);
  await writeFile(path, source.replace(pattern, replacement));
}

await updateJson('package.json', (value) => { value.version = version; });
await updateJson('package-lock.json', (value) => {
  value.version = version;
  value.packages[''].version = version;
});
await replace('src-tauri/Cargo.toml', /^(name = "mylfr-desktop"\r?\nversion = )"[^"]+"/m,
  (_, prefix) => `${prefix}"${version}"`);
await replace('src-tauri/Cargo.lock', /^(name = "mylfr-desktop"\r?\nversion = )"[^"]+"/m,
  (_, prefix) => `${prefix}"${version}"`);
await updateJson('src-tauri/tauri.conf.json', (value) => {
  value.version = version;
  value.identifier = 'nz.co.mylfr.desktop.updater-pilot';
  value.productName = name;
  value.mainBinaryName = binary;
  value.app.windows[0].title = name;
  value.plugins.updater.endpoints = [`${baseUrl}/latest.json`];
});
await replace('src-tauri/windows/hooks.nsh', /"mylfr-desktop\.exe"/, `"${binary}.exe"`);
await appendFile(GITHUB_ENV, `MYLFR_RELEASE_BINARY=${binary}.exe\nMYLFR_PILOT_RELEASE_BASE_URL=${baseUrl}\n`);
