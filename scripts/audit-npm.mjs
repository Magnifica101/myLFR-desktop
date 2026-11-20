// Runs `npm audit` over every npm dependency, including development tools, and
// fails on any advisory unless it is listed in ALLOWED below with its reason.
//
// An exception is for an advisory that has no patched release and cannot reach
// the installed application. Remove it as soon as a fix ships: this script
// reports an exception that no longer matches anything, so it cannot linger.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** Advisory ID → the only package it is allowed for, and why. */
const ALLOWED = {
  // None at present. GHSA-fc5q-39xc-vjpf (picomatch) was allowed here until
  // GitHub withdrew the advisory on 2026-11-18.
};

const audit = spawnSync('npm', ['audit', '--include=dev', '--json'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error('npm audit did not return a report.');
  console.error(audit.stderr || audit.stdout);
  process.exit(1);
}
if (report.error || !report.vulnerabilities) {
  console.error('npm audit failed:', JSON.stringify(report.error ?? report, null, 2));
  process.exit(1);
}

// Packages listed only because they depend on a vulnerable package carry no
// advisory of their own; the advisories sit on the package that has the flaw.
const advisories = [];
for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
  for (const via of vulnerability.via) {
    if (typeof via === 'string') continue;
    const id = via.url?.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/)?.[0] ?? `npm-${via.source}`;
    advisories.push({ id, package: via.name ?? name, severity: via.severity, title: via.title, url: via.url });
  }
}

const allowedNow = advisories.filter((advisory) => ALLOWED[advisory.id]?.package === advisory.package);
const blocking = advisories.filter((advisory) => !allowedNow.includes(advisory));
const unused = Object.keys(ALLOWED).filter((id) => !allowedNow.some((advisory) => advisory.id === id));

for (const id of new Set(allowedNow.map((advisory) => advisory.id))) {
  console.log(`Allowed ${id} (${ALLOWED[id].package}): ${ALLOWED[id].reason}`);
  console.log('  Remove this exception from scripts/audit-npm.mjs once a patched release ships.');
}
for (const id of unused) {
  console.log(`Exception ${id} (${ALLOWED[id].package}) no longer matches any advisory. Remove it from scripts/audit-npm.mjs.`);
}

if (blocking.length) {
  console.error(`\n${blocking.length} npm advisory finding(s) not covered by an exception:`);
  for (const advisory of blocking) {
    console.error(`- ${advisory.id} ${advisory.package} (${advisory.severity}): ${advisory.title} ${advisory.url ?? ''}`);
  }
  console.error('\nRun `npm audit --include=dev` for details and fixes.');
  process.exit(1);
}

console.log(advisories.length ? 'npm audit: only allowed advisories found.' : 'npm audit: no advisories found.');
