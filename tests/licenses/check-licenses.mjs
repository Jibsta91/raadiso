// Fails when any npm dependency (prod or dev) is neither under an OSI-approved
// license nor allow-listed. ADR-0009: non-code data packages with CC licenses,
// and free non-OSI packages admitted with their class, are allowed explicitly.
import { execFileSync } from 'node:child_process';

const OSI = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'MPL-2.0',
  'OFL-1.1',
  'BlueOak-1.0.0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
  'Artistic-2.0',
  'EPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'LGPL-3.0-or-later',
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'PostgreSQL',
  'UPL-1.0',
  'BSL-1.0',
  'Unicode-3.0',
  'Unicode-DFS-2016',
]);
// Data-only packages (no executable code) under Creative Commons licenses.
const DATA_EXCEPTIONS = new Map([
  ['caniuse-lite', 'CC-BY-4.0'],
  ['spdx-license-ids', 'CC0-1.0'],
  ['spdx-exceptions', 'CC-BY-3.0'],
]);

const ok = (expr) => {
  const e = expr.replace(/[()]/g, ' ').trim();
  if (/ OR /i.test(e)) return e.split(/ OR /i).some((p) => ok(p));
  if (/ AND /i.test(e)) return e.split(/ AND /i).every((p) => ok(p));
  return OSI.has(e.replace(/\+$/, '').replace(/-only$/, ''));
};

const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 << 20,
});
const byLicense = JSON.parse(raw);
const violations = [];
let count = 0;
for (const [license, pkgs] of Object.entries(byLicense)) {
  for (const pkg of pkgs) {
    count++;
    if (ok(license) || DATA_EXCEPTIONS.get(pkg.name) === license) continue;
    violations.push(`${pkg.name}@${(pkg.versions ?? [pkg.version]).join(',')}: ${license}`);
  }
}
if (violations.length) {
  console.error(
    `✘ ${violations.length} package(s) neither OSI-approved nor allow-listed (ADR-0009):\n  ${violations.join('\n  ')}`,
  );
  process.exit(1);
}
console.log(`✔ ${count} packages, all OSI-approved or allow-listed (ADR-0009)`);
