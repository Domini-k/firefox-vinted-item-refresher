#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ROOT,
  OUTPUT_DIR,
  readJson,
  getVersion,
  validateManifest,
  stageExtension
} = require('./build-xpi');

const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

function webExtBinary() {
  const name = process.platform === 'win32' ? 'web-ext.cmd' : 'web-ext';
  return path.join(ROOT, 'node_modules', '.bin', name);
}

function approvalTimeoutMs() {
  const raw = process.env.WEB_EXT_APPROVAL_TIMEOUT_MS;
  if (raw == null || raw === '') return DEFAULT_APPROVAL_TIMEOUT_MS;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('WEB_EXT_APPROVAL_TIMEOUT_MS must be a non-negative number');
  }
  return Math.floor(value);
}

function main() {
  const apiKey = process.env.WEB_EXT_API_KEY;
  const apiSecret = process.env.WEB_EXT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      'Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET first. ' +
      'Create them at https://addons.mozilla.org/developers/addon/api/key/'
    );
  }

  const version = getVersion();
  validateManifest(readJson('manifest.json'));

  const bin = webExtBinary();
  if (!fs.existsSync(bin)) {
    throw new Error('web-ext is not installed. Run "npm install" first.');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(
    OUTPUT_DIR,
    'firefox-vinted-item-refresher-' + version + '-signed.xpi'
  );

  const staged = stageExtension();
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinted-sign-'));
  const waitMs = approvalTimeoutMs();

  if (waitMs > 0) {
    console.log('Waiting up to ' + Math.round(waitMs / 60000) + ' minute(s) for AMO approval...');
  } else {
    console.log('AMO approval wait disabled (WEB_EXT_APPROVAL_TIMEOUT_MS=0).');
  }

  try {
    const result = spawnSync(
      bin,
      [
        'sign',
        '--source-dir', staged.stageDir,
        '--artifacts-dir', artifactsDir,
        '--channel', 'unlisted',
        '--approval-timeout', String(waitMs),
        '--api-key', apiKey,
        '--api-secret', apiSecret
      ],
      { cwd: ROOT, stdio: 'inherit' }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('web-ext sign failed');

    const signed = fs.readdirSync(artifactsDir)
      .filter(function (name) { return name.endsWith('.xpi'); })
      .map(function (name) {
        const full = path.join(artifactsDir, name);
        return { name: name, full: full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort(function (a, b) { return b.mtime - a.mtime; });

    if (!signed.length) {
      throw new Error('web-ext did not produce a signed XPI');
    }

    fs.copyFileSync(signed[0].full, outputPath);
    const stat = fs.statSync(outputPath);
    console.log('Signed XPI: ' + path.relative(ROOT, outputPath));
    console.log('  version: ' + version);
    console.log('  size: ' + (stat.size / 1024).toFixed(1) + ' KB');
    console.log('  channel: unlisted (not publicly listed on AMO)');

    return outputPath;
  } finally {
    fs.rmSync(staged.stageDir, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('Signing failed: ' + err.message);
    process.exit(1);
  }
}
