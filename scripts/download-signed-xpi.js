#!/usr/bin/env node
'use strict';

const {
  currentVersion,
  waitForSignedXpi
} = require('./amo-signing');

const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_INTERVAL_SECONDS = 5;

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('Invalid ' + name + ' value');
  }
  return number;
}

function envIntervalSeconds() {
  const raw = process.env.WEB_EXT_APPROVAL_CHECK_INTERVAL_MS;
  if (raw == null || raw === '') return DEFAULT_INTERVAL_SECONDS;
  return positiveNumber(raw) / 1000;
}

function usage() {
  [
    'Usage: node scripts/download-signed-xpi.js [<version>] [--wait] [--timeout <seconds>] [--interval <seconds>] [--if-signed]',
    '',
    '  <version>            Version to download. Default: current manifest version.',
    '  --wait               Wait for AMO approval before downloading.',
    '  --timeout <seconds>  Maximum wait time with --wait. Default: 900.',
    '  --interval <seconds> Poll interval with --wait. Default: 5 (or WEB_EXT_APPROVAL_CHECK_INTERVAL_MS).',
    '  --if-signed          Exit 2 when the version is not signed yet (for CI checks).',
    '',
    'Examples:',
    '  npm run download:signed',
    '  npm run download:signed -- 1.4.6',
    '  npm run download:signed -- 1.4.6 --wait',
    '  npm run download:signed -- 1.4.6 --wait --interval 10',
    '  npm run download:signed -- 1.4.6 --if-signed'
  ].forEach(function (line) { console.log(line); });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const wait = args.includes('--wait');
  const ifSigned = args.includes('--if-signed');

  const timeoutIndex = args.indexOf('--timeout');
  const timeoutSeconds = timeoutIndex === -1
    ? DEFAULT_TIMEOUT_SECONDS
    : positiveNumber(args[timeoutIndex + 1], '--timeout');

  const intervalIndex = args.indexOf('--interval');
  const intervalSeconds = intervalIndex === -1
    ? envIntervalSeconds()
    : positiveNumber(args[intervalIndex + 1], '--interval');

  const versionArg = args.find(function (arg, index) {
    if (arg.startsWith('-')) return false;
    if (index > 0 && (args[index - 1] === '--timeout' || args[index - 1] === '--interval')) return false;
    return true;
  });

  const version = String(versionArg || currentVersion()).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Invalid version "' + version + '". Expected format: 1.2.3');
  }

  const output = await waitForSignedXpi({
    version: version,
    timeoutMs: timeoutSeconds * 1000,
    intervalMs: intervalSeconds * 1000,
    wait: wait,
    ifSigned: ifSigned
  });
  if (output === null) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(function (err) {
    console.error('Download failed: ' + err.message);
    process.exit(1);
  });
}
