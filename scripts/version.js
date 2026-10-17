'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function getVersion() {
  return readJson('manifest.json').version;
}

function normalizeVersion(value) {
  const version = String(value || '').trim().replace(/^v/, '');
  if (!VERSION_RE.test(version)) {
    throw new Error('Invalid version "' + value + '". Expected format: 1.2.3');
  }
  return version;
}

function nextPatch(version) {
  const match = normalizeVersion(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match[1] + '.' + match[2] + '.' + (Number(match[3]) + 1);
}

function replaceOccurrences(file, previous, next, expectedCount) {
  const absolute = path.join(ROOT, file);
  const source = fs.readFileSync(absolute, 'utf8');
  const needle = '"version": "' + previous + '"';
  const replacement = '"version": "' + next + '"';

  let output = source;
  let searchFrom = 0;
  let replaced = 0;

  while (replaced < expectedCount) {
    const position = output.indexOf(needle, searchFrom);
    if (position === -1) break;
    output = output.slice(0, position) + replacement + output.slice(position + needle.length);
    searchFrom = position + replacement.length;
    replaced++;
  }

  if (replaced !== expectedCount) {
    throw new Error(
      'Could not update version in ' + file + ': expected ' + expectedCount +
      ' occurrence(s), found ' + replaced
    );
  }

  fs.writeFileSync(absolute, output);
}

function verifyVersion(version) {
  const manifest = readJson('manifest.json');
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const lockRoot = lock.packages && lock.packages[''];

  if (manifest.version !== version) throw new Error('manifest.json version is ' + manifest.version);
  if (pkg.version !== version) throw new Error('package.json version is ' + pkg.version);
  if (lock.version !== version) throw new Error('package-lock.json root version is ' + lock.version);
  if (!lockRoot || lockRoot.version !== version) {
    throw new Error('package-lock.json packages[""] version is not ' + version);
  }
}

function setVersion(value) {
  const version = normalizeVersion(value);
  const previous = getVersion();

  replaceOccurrences('manifest.json', previous, version, 1);
  replaceOccurrences('package.json', previous, version, 1);
  replaceOccurrences('package-lock.json', previous, version, 2);
  verifyVersion(version);

  return { previous: previous, version: version };
}

module.exports = {
  ROOT,
  normalizeVersion,
  nextPatch,
  getVersion,
  setVersion
};

if (require.main === module) {
  try {
    const requested = process.argv[2];
    const result = setVersion(requested ? requested : nextPatch(getVersion()));
    console.log(result.previous + ' -> ' + result.version);
  } catch (err) {
    console.error('Version update failed: ' + err.message);
    process.exit(1);
  }
}
