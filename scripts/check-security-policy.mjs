import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const read = (path) => readFile(resolve(root, path), 'utf8');

const dependabot = await read('.github/dependabot.yml');
expect(dependabot.includes('package-ecosystem: github-actions'), 'Dependabot must keep GitHub Action SHA updates controlled');

const workflowDirectory = resolve(root, '.github/workflows');
for (const name of await readdir(workflowDirectory)) {
  if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
  const workflow = await readFile(resolve(workflowDirectory, name), 'utf8');
  for (const match of workflow.matchAll(/^\s*-?\s*uses:\s*([^@\s]+)@([^\s#]+)/gm)) {
    expect(/^[a-f0-9]{40}$/.test(match[2]), `${name}: ${match[1]} must use a full immutable commit SHA`);
  }
  expect(!/\bnpx\b/.test(workflow), `${name}: runtime npx execution is forbidden`);
  expect(!/@(?:v\d+|stable|main|master)\b/.test(workflow), `${name}: mutable Action references are forbidden`);
}

const release = await read('.github/workflows/release-windows.yml');
const buildIndex = release.search(/^  build:/m);
const signingIndex = release.search(/^  sign-and-bundle:/m);
const publishIndex = release.search(/^  publish:/m);
expect(buildIndex >= 0 && signingIndex > buildIndex && publishIndex > signingIndex, 'release workflow must have distinct build, signing, and publication jobs');
const build = release.slice(buildIndex, signingIndex);
const signing = release.slice(signingIndex, publishIndex);
const publish = release.slice(publishIndex);
expect(!build.includes('secrets.'), 'build job must not receive signing or deployment secrets');
expect(!build.includes('environment:'), 'build job must not enter a protected secret environment');
expect(!/npm (?:run )?(?:test|build|desktop:build)\b/.test(signing) && !/cargo test\b/.test(signing), 'signing job must not run general tests or builds');
expect(signing.indexOf('npm ci --ignore-scripts') < signing.indexOf('secrets.'), 'dependencies must be installed before signing secrets are introduced');
expect((release.match(/TAURI_SIGNING_PRIVATE_KEY:/g) ?? []).length === 1, 'updater private key must be scoped to one bundle step');
expect(!/netlify/i.test(publish), 'publication must not deploy to Netlify');
expect(publish.includes('gh release create') && publish.includes('--draft'), 'publication must create a draft GitHub release for the maintainer to review');
expect(!publish.includes('secrets.'), 'publication must not receive signing or deployment secrets');
expect(release.includes("inputs.publish && inputs.signing_mode == 'pilot-self-signed'"), 'release workflow must reject publishing pilot-signed builds');
expect(signing.includes('actions/attest-build-provenance@'), 'signing job must attest the installer build provenance');
expect(signing.includes('environment: signing'), 'signing must use its isolated environment');
expect(publish.includes('environment: production'), 'publication must use its isolated environment');
expect(build.includes('MYLFR_WINDOWS_SIGNER_THUMBPRINT'), 'build must compile the pinned Windows update publisher identity');
expect(build.includes('MYLFR_UNSIGNED_WINDOWS_RELEASE=1') && build.includes('"${{ inputs.signing_mode }}" -eq "unsigned"'), 'only unsigned builds may opt out of the Authenticode update check');

const capability = JSON.parse(await read('src-tauri/capabilities/default.json'));
expect(Array.isArray(capability.permissions) && capability.permissions.length === 0, 'renderer capability permissions must remain empty');

const packageJson = JSON.parse(await read('package.json'));
for (const dependency of [
  '@tauri-apps/plugin-dialog',
  '@tauri-apps/plugin-process',
  '@tauri-apps/plugin-updater',
]) {
  expect(!packageJson.dependencies?.[dependency] && !packageJson.devDependencies?.[dependency], `${dependency} must not be exposed to renderer code`);
}

const desktop = await read('src/lib/desktop.ts');
expect(!desktop.includes('set_backup_directory'), 'renderer bridge must not accept a backup directory path');
expect(!desktop.includes('validate_backup'), 'renderer bridge must not validate arbitrary backup paths');
expect(desktop.includes("open_backup_folder'"), 'renderer bridge must expose only the stored backup folder opener');
expect(desktop.includes("restore_backup', { token }"), 'restore must use a single-use native selection token');

const commands = await read('src-tauri/src/commands.rs');
expect(commands.indexOf('verify_windows_update_authenticode(&bytes)?') < commands.indexOf('update.install(&bytes)'), 'Authenticode verification must occur before updater installation');
expect(commands.includes('option_env!("MYLFR_WINDOWS_SIGNER_THUMBPRINT")'), 'runtime updater must use the build-pinned Windows publisher');
expect(commands.includes('option_env!("MYLFR_UNSIGNED_WINDOWS_RELEASE")'), 'runtime updater must require an explicit build-time opt-out to skip Authenticode');
const updates = await read('src-tauri/src/updates.rs');
expect(updates.includes('(None, Some("1")) => Ok(WindowsUpdatePublisher::NotRequired)'), 'only the exact unsigned-release flag may skip Authenticode');
expect(commands.includes('&bytes[..2] != b"MZ"'), 'runtime updater must reject non-executable payloads before Authenticode verification');
expect(/fn verify_windows_update_authenticode[\s\S]*?\.creation_flags\(CREATE_NO_WINDOW\)/.test(commands), 'the update signature check must not open a console window');
expect(commands.includes('blocking_pick_folder()') && commands.includes('blocking_pick_file()') && commands.includes('blocking_save_file()'), 'filesystem destinations must be selected by native Rust dialogs');
expect(commands.includes('pub fn open_backup_folder') && commands.includes('.open_path('), 'backup folder opening must remain native and use the stored path');

const backup = await read('src-tauri/src/backup.rs');
expect(backup.includes('validate_authoritative_schema(&connection, schema_version)?'), 'backup restore must validate the authoritative SQLite schema');

if (failures.length > 0) {
  for (const failure of failures) console.error(`Security policy violation: ${failure}`);
  process.exit(1);
}

console.log('Security policy checks passed.');
