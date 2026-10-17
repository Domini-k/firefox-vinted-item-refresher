#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ROOT,
  readJson,
  getVersion,
  validateManifest,
  stageExtension
} = require('./build-xpi');
const { waitForSignedXpi } = require('./amo-signing');

const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_VALIDATION_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_APPROVAL_INTERVAL_MS = 5 * 1000;

function webExtBinary() {
  const name = process.platform === 'win32' ? 'web-ext.cmd' : 'web-ext';
  return path.join(ROOT, 'node_modules', '.bin', name);
}

function envNumber(name, defaultValue, allowZero) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;

  const value = Number(raw);
  const invalid = !Number.isFinite(value) || value < 0 || (!allowZero && value === 0);
  if (invalid) {
    throw new Error(name + ' must be a ' + (allowZero ? 'non-negative' : 'positive') + ' number');
  }
  return Math.floor(value);
}

function approvalTimeoutMs() {
  return envNumber('WEB_EXT_APPROVAL_TIMEOUT_MS', DEFAULT_APPROVAL_TIMEOUT_MS, true);
}

function validationTimeoutMs() {
  return envNumber('WEB_EXT_VALIDATION_TIMEOUT_MS', DEFAULT_VALIDATION_TIMEOUT_MS, false);
}

function approvalIntervalMs() {
  return envNumber('WEB_EXT_APPROVAL_CHECK_INTERVAL_MS', DEFAULT_APPROVAL_INTERVAL_MS, false);
}

async function main() {
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

  const approvalWaitMs = approvalTimeoutMs();
  const validationWaitMs = validationTimeoutMs();
  const checkIntervalMs = approvalIntervalMs();

  console.log('Submitting version ' + version + ' to AMO...');
  if (approvalWaitMs > 0) {
    console.log(
      'After submission, waiting up to ' + Math.round(approvalWaitMs / 60000) +
      ' minute(s) for approval, checking every ' + Math.round(checkIntervalMs / 1000) + 's.'
    );
  } else {
    console.log('Approval wait disabled (WEB_EXT_APPROVAL_TIMEOUT_MS=0); submission only.');
  }

  const staged = stageExtension();
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinted-sign-'));

  try {
    const result = spawnSync(
      bin,
      [
        'sign',
        '--source-dir', staged.stageDir,
        '--artifacts-dir', artifactsDir,
        '--channel', 'unlisted',
        '--timeout', String(validationWaitMs),
        '--approval-timeout', '0',
        '--api-key', apiKey,
        '--api-secret', apiSecret
      ],
      { cwd: ROOT, stdio: 'inherit' }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('web-ext sign failed');

    if (approvalWaitMs === 0) {
      console.log(
        'Submitted to AMO. Use "npm run download:signed -- ' + version +
        ' --wait" to fetch the signed XPI later.'
      );
      return null;
    }

    const outputPath = await waitForSignedXpi({
      version: version,
      timeoutMs: approvalWaitMs,
      intervalMs: checkIntervalMs,
      wait: true
    });

    console.log('Signed XPI: ' + path.relative(ROOT, outputPath));
    console.log('  version: ' + version);
    console.log('  channel: unlisted (not publicly listed on AMO)');
    return outputPath;
  } finally {
    fs.rmSync(staged.stageDir, { recursive: true, force: true });
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(function (err) {
    console.error('Signing failed: ' + err.message);
    process.exit(1);
  });
}
