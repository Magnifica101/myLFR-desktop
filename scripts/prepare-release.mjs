import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const version = process.env.npm_package_version;
const releaseChannel = process.env.RELEASE_CHANNEL ?? 'unsigned';
// Only the local updater pilot serves its own feed. Every other release is a
// GitHub release tagged v<version>, where the updater finds latest.json.
const pilotBaseUrl = (process.env.MYLFR_RELEASE_BASE_URL ?? '').replace(/\/$/, '');
const repository = process.env.GITHUB_REPOSITORY ?? 'Magnifica101/myLFR-desktop';
const bundleDirectory = resolve('src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis');
const releaseDirectory = resolve('release');
const downloadDirectory = join(releaseDirectory, 'downloads');
const files = await readdir(bundleDirectory);
const installerName = files.find((name) => name.endsWith('-setup.exe'));
if (!installerName) throw new Error(`No NSIS installer found in ${bundleDirectory}.`);
const signatureName = `${installerName}.sig`;
if (!files.includes(signatureName)) throw new Error(`Updater signature ${signatureName} is missing.`);
// GitHub rewrites spaces in asset names, so a GitHub release uses hyphens.
// Renaming does not affect the updater signature, which covers the bytes.
const publishedInstallerName = pilotBaseUrl ? installerName : installerName.replace(/\s+/g, '-');
const downloadUrl = pilotBaseUrl
  ? `${pilotBaseUrl}/downloads/${basename(installerName)}`
  : `https://github.com/${repository}/releases/download/v${version}/${publishedInstallerName}`;

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(downloadDirectory, { recursive: true });
await cp(join(bundleDirectory, installerName), join(downloadDirectory, publishedInstallerName));
await cp(join(bundleDirectory, signatureName), join(downloadDirectory, `${publishedInstallerName}.sig`));
if (releaseChannel === 'pilot-self-signed') {
  await cp(resolve('distribution/pilot'), join(releaseDirectory, 'pilot'), { recursive: true });
}
const signature = (await readFile(join(bundleDirectory, signatureName), 'utf8')).trim();
const latest = {
  version,
  notes: process.env.RELEASE_NOTES ?? `myLFR Desktop ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: downloadUrl,
    },
  },
};
await writeFile(join(releaseDirectory, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
// Receivers can compare the installer against this published checksum.
const installerHash = createHash('sha256').update(await readFile(join(downloadDirectory, publishedInstallerName))).digest('hex');
await writeFile(join(releaseDirectory, 'SHA256SUMS.txt'), `${installerHash}  ${publishedInstallerName}\n`);

await mkdir(dirname(join(releaseDirectory, 'index.html')), { recursive: true });
const releaseDescription = releaseChannel === 'production'
  ? 'Production-trusted Windows installer'
  : releaseChannel === 'pilot-self-signed'
    ? 'Self-signed testing installer; trust the included pilot certificate before installation'
    : 'Unsigned Windows installer; compare its SHA-256 checksum with SHA256SUMS.txt';
await writeFile(join(releaseDirectory, 'index.html'), `<!doctype html><title>myLFR Desktop</title><h1>myLFR Desktop</h1><p>Version: ${version}</p><p>${releaseDescription}</p><p><a href="downloads/${publishedInstallerName}">Download the Windows installer</a></p>\n`);
console.log(`Prepared release ${version} in ${releaseDirectory}.`);
