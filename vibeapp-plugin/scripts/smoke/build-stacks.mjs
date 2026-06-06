#!/usr/bin/env node
// scripts/smoke/build-stacks.mjs — scaffold each stack into a temp dir and build it.
// Network/npm/python unavailable => SKIPPED (not FAILED), so CI stays deterministic.
import { mkdtempSync, cpSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = (s) => path.join(root, 'skills/vibeapp-scaffolding/templates', s);
let failed = false;
const log = (s) => console.log(s);

function sh(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'pipe' });
}
function has(cmd) {
  try { execFileSync(cmd, ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

// --- static-html: structural sanity ---
{
  const d = mkdtempSync(path.join(tmpdir(), 'vibe-static-'));
  cpSync(T('static-html'), d, { recursive: true });
  const html = readFileSync(path.join(d, 'index.html'), 'utf8');
  if (existsSync(path.join(d, 'api.js')) && /<html/i.test(html) && /fetch\(/.test(html)) log('static-html: PASS');
  else { log('static-html: FAIL'); failed = true; }
  rmSync(d, { recursive: true, force: true });
}

// --- python-api: py_compile ---
{
  if (!has('python3')) { log('python-api: SKIPPED (no python3)'); }
  else {
    const d = mkdtempSync(path.join(tmpdir(), 'vibe-py-'));
    cpSync(T('python-api'), d, { recursive: true });
    try { sh('python3', ['-m', 'py_compile', 'main.py'], d); log('python-api: PASS'); }
    catch (e) { log('python-api: FAIL\n' + (e.stderr || e.message)); failed = true; }
    rmSync(d, { recursive: true, force: true });
  }
}

// --- react-ts: scaffold (apply rename map) + npm build ---
{
  if (!has('npm')) { log('react-ts: SKIPPED (no npm)'); }
  else {
    const d = mkdtempSync(path.join(tmpdir(), 'vibe-rt-'));
    const src = path.join(d, 'src');
    mkdirSync(src, { recursive: true });
    for (const f of ['index.html', 'package.json', 'vite.config.ts', 'tsconfig.json', 'README.md']) {
      cpSync(path.join(T('react-ts'), f), path.join(d, f));
    }
    cpSync(path.join(T('react-ts'), 'src-App.tsx'), path.join(src, 'App.tsx'));
    cpSync(path.join(T('react-ts'), 'src-main.tsx'), path.join(src, 'main.tsx'));
    cpSync(path.join(T('react-ts'), 'api-handler.ts'), path.join(src, 'api.ts'));
    try {
      sh('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], d);
      sh('npm', ['run', 'build'], d);
      log('react-ts: PASS');
    } catch (e) {
      const msg = (e.stderr || e.stdout || e.message || '').toString();
      if (/ENOTFOUND|ETIMEDOUT|network|getaddrinfo|EAI_AGAIN|registry/i.test(msg)) log('react-ts: SKIPPED (no network for npm install)');
      else { log('react-ts: FAIL\n' + msg.slice(0, 1200)); failed = true; }
    }
    rmSync(d, { recursive: true, force: true });
  }
}

if (failed) { console.error('\nSMOKE: FAILURES present'); process.exit(1); }
console.log('\nSMOKE: ok (passes + skips, no failures)');
