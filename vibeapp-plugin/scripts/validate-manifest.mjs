#!/usr/bin/env node
// scripts/validate-manifest.mjs — validate an app.yaml, print plain-language results.
import { readFileSync } from 'node:fs';
import { parseYaml } from './yaml.mjs';
import { validateManifest } from './lib/manifest-rules.mjs';

const file = process.argv[2] || 'app.yaml';
let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error(`Could not read ${file}. Is the path right?`);
  process.exit(2);
}
let manifest;
try {
  manifest = parseYaml(text);
} catch (err) {
  console.error(`${file}: could not parse YAML — ${err.message}`);
  process.exit(2);
}
const errors = validateManifest(manifest);
if (errors.length === 0) {
  console.log(`${file} is valid. Ready to push.`);
  process.exit(0);
}
console.error(`${file} has ${errors.length} issue(s):\n`);
for (const e of errors) console.error(`  - ${e}`);
console.error('\nFix these, then re-run the check.');
process.exit(1);
