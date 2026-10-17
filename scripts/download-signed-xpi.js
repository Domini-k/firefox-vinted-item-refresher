#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'firefox-permanent-addon-file-build');
const ADDON_GUID = 'vinted-item-refresher@djagodzki';
const API_BASE = 'https://addons.mozilla.org/api/v5';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function currentVersion() {
  return readJson('manifest.json').version;
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeJwt(apiKey, apiSecret) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({ iss: apiKey, iat: now, exp: now + 300 });
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(header + '.' + payload)
    .digest('base64url');
  return header + '.' + payload + '.' + signature;
}

async function fetchVersion(version, token) {
  const url = API_BASE + '/addons/addon/' + encodeURIComponent(ADDON_GUID) +
    '/versions/' + encodeURIComponent(version) + '/';
  const response = await fetch(url, {
    headers: {
      Authorization: 'JWT ' + token,
      Accept: 'application/json'
    }
  });

  if (response.status === 404) {
    throw new Error('Version ' + version + ' was not found on AMO');
  }
  if (!response.ok) {
    throw new Error('AMO version lookup failed: HTTP ' + response.status + ' ' + response.statusText);
  }
  return response.json();
}

async function downloadFile(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: 'JWT ' + token,
      Accept: 'application/x-xpinstall,application/octet-stream'
    }
  });
  if (!response.ok) {
    throw new Error('AMO file download failed: HTTP ' + response.status + ' ' + response.statusText);
  }
  return Buffer.from(await response.arrayBuffer());
}

function verifyHash(buffer, expectedHash) {
  const expected = String(expectedHash || '').replace(/^sha256:/, '').toLowerCase();
  if (!expected) return null;
  const actual = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actual !== expected) {
    throw new Error('Downloaded XPI hash mismatch: expected ' + expected + ', got ' + actual);
  }
  return actual;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function downloadSigned(version, wait, timeoutSeconds) {
  const apiKey = process.env.WEB_EXT_API_KEY;
  const apiSecret = process.env.WEB_EXT_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET first (or use .env)');
  }

  const token = makeJwt(apiKey, apiSecret);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (true) {
    const detail = await fetchVersion(version, token);
    const file = detail.file || {};
    const status = file.status || 'unknown';
    console.log('AMO version ' + version + ': ' + status);

    if (status === 'public' && file.url) {
      const buffer = await downloadFile(file.url, token);
      const hash = verifyHash(buffer, file.hash);

      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const outputPath = path.join(
        OUTPUT_DIR,
        'firefox-vinted-item-refresher-' + version + '-signed.xpi'
      );
      fs.writeFileSync(outputPath, buffer);

      console.log('Downloaded signed XPI: ' + path.relative(ROOT, outputPath));
      console.log('  size: ' + (buffer.length / 1024).toFixed(1) + ' KB');
      if (hash) console.log('  sha256: ' + hash);
      return outputPath;
    }

    if (!wait) {
      throw new Error(
        'Version ' + version + ' is not signed yet (status: ' + status + '). ' +
        'Re-run with --wait or try again later.'
      );
    }

    if (Date.now() >= deadline) {
      throw new Error(
        'Timed out waiting for ' + version + ' to be signed (last status: ' + status + ')'
      );
    }

    console.log('Waiting for approval...');
    await sleep(5000);
  }
}

function usage() {
  [
    'Usage: node scripts/download-signed-xpi.js [<version>] [--wait] [--timeout <seconds>]',
    '',
    '  <version>            Version to download. Default: current manifest version.',
    '  --wait               Wait for AMO approval before downloading.',
    '  --timeout <seconds>  Maximum wait time with --wait. Default: 900.',
    '',
    'Examples:',
    '  npm run download:signed',
    '  npm run download:signed -- 1.4.6',
    '  npm run download:signed -- 1.4.6 --wait'
  ].forEach(function (line) { console.log(line); });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const wait = args.includes('--wait');
  const timeoutIndex = args.indexOf('--timeout');
  const timeout = timeoutIndex === -1 ? 900 : Number(args[timeoutIndex + 1]);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('Invalid --timeout value');
  }

  const versionArg = args.find(function (arg, index) {
    if (arg.startsWith('-')) return false;
    if (index > 0 && args[index - 1] === '--timeout') return false;
    return true;
  });

  const version = String(versionArg || currentVersion()).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Invalid version "' + version + '". Expected format: 1.2.3');
  }

  await downloadSigned(version, wait, timeout);
}

if (require.main === module) {
  main().catch(function (err) {
    console.error('Download failed: ' + err.message);
    process.exit(1);
  });
}
