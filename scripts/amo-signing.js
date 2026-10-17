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
    const error = new Error('Version ' + version + ' was not found on AMO');
    error.status = 404;
    throw error;
  }
  if (!response.ok) {
    const error = new Error('AMO version lookup failed: HTTP ' + response.status + ' ' + response.statusText);
    error.status = response.status;
    throw error;
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

function requireCredentials() {
  const apiKey = process.env.WEB_EXT_API_KEY;
  const apiSecret = process.env.WEB_EXT_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET first (or use .env)');
  }
  return { apiKey: apiKey, apiSecret: apiSecret };
}

async function saveSignedXpi(version, buffer, file) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(
    OUTPUT_DIR,
    'firefox-vinted-item-refresher-' + version + '-signed.xpi'
  );
  fs.writeFileSync(outputPath, buffer);
  const hash = verifyHash(buffer, file.hash);

  console.log('Downloaded signed XPI: ' + path.relative(ROOT, outputPath));
  console.log('  size: ' + (buffer.length / 1024).toFixed(1) + ' KB');
  if (hash) console.log('  sha256: ' + hash);
  return outputPath;
}

async function waitForSignedXpi(options) {
  const version = String(options.version);
  const timeoutMs = options.timeoutMs;
  const intervalMs = options.intervalMs;
  const wait = options.wait !== false;
  const ifSigned = options.ifSigned === true;

  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('timeoutMs must be a non-negative number');
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('intervalMs must be a positive number');
  }

  const credentials = requireCredentials();
  const token = makeJwt(credentials.apiKey, credentials.apiSecret);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    let detail;
    try {
      detail = await fetchVersion(version, token);
    } catch (err) {
      if (err.status === 404) {
        console.log('AMO version ' + version + ': not submitted yet.');
        if (!wait) {
          if (ifSigned) return null;
          throw new Error('Version ' + version + ' was not found on AMO');
        }
      } else {
        throw err;
      }
    }

    if (detail) {
      const file = detail.file || {};
      const status = file.status || 'unknown';
      console.log('AMO version ' + version + ': ' + status);

      if (status === 'public' && file.url) {
        const buffer = await downloadFile(file.url, token);
        return saveSignedXpi(version, buffer, file);
      }

      if (!wait) {
        if (ifSigned) {
          console.log('Version ' + version + ' is not signed yet (status: ' + status + ').');
          return null;
        }
        throw new Error(
          'Version ' + version + ' is not signed yet (status: ' + status + '). ' +
          'Re-run with --wait or try again later.'
        );
      }
    }

    if (!wait) {
      if (ifSigned) return null;
      throw new Error('Version ' + version + ' is not signed yet');
    }

    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for ' + version + ' to be signed');
    }

    console.log('Waiting for approval (checking every ' + Math.round(intervalMs / 1000) + 's)...');
    await sleep(intervalMs);
  }
}

module.exports = {
  ROOT,
  OUTPUT_DIR,
  ADDON_GUID,
  API_BASE,
  readJson,
  currentVersion,
  makeJwt,
  fetchVersion,
  downloadFile,
  verifyHash,
  waitForSignedXpi
};
