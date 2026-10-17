#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SIGNED_RE = /^firefox-vinted-item-refresher-(\d+\.\d+\.\d+)-signed\.xpi$/;
const TAG_RE = /^v(\d+\.\d+\.\d+)$/;

function parseVersion(value) {
  const match = String(value || '').match(/^v?(\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

function gh(args, options) {
  return execFileSync('gh', args, Object.assign({ encoding: 'utf8' }, options || {}));
}

function listReleases() {
  const raw = gh(['release', 'list', '--limit', '1000', '--json', 'tagName,isDraft,isPrerelease,assets']);
  return JSON.parse(raw);
}

function signedAssets(release) {
  return (release.assets || []).map(function (asset) {
    const match = String(asset.name || '').match(SIGNED_RE);
    return match ? { name: asset.name, version: match[1] } : null;
  }).filter(Boolean);
}

function findRelease(releases, tag) {
  return releases.find(function (release) { return release.tagName === tag; }) || null;
}

function findLatestSigned(releases) {
  let latest = null;
  releases.forEach(function (release) {
    const tagVersion = parseVersion(release.tagName);
    if (!tagVersion) return;
    signedAssets(release).forEach(function (asset) {
      if (!latest || compareVersions(asset.version, latest.version) > 0) {
        latest = {
          tag: release.tagName,
          releaseVersion: tagVersion,
          version: asset.version,
          asset: asset.name
        };
      }
    });
  });
  return latest;
}

function uploadSignedToRelease(tag, file, signedVersion, dryRun) {
  const releases = listReleases();
  const release = findRelease(releases, tag);
  if (!release) throw new Error('Release not found: ' + tag);

  const existing = signedAssets(release);
  const newer = existing.find(function (asset) {
    return compareVersions(asset.version, signedVersion) > 0;
  });
  if (newer) {
    console.log('Skip ' + tag + ': newer signed asset already present (' + newer.name + ')');
    return;
  }

  const same = existing.find(function (asset) { return asset.version === signedVersion; });
  if (same) {
    console.log('Skip ' + tag + ': signed asset already present (' + same.name + ')');
    return;
  }

  existing.filter(function (asset) {
    return compareVersions(asset.version, signedVersion) < 0;
  }).forEach(function (asset) {
    const args = ['release', 'delete-asset', tag, asset.name, '--yes'];
    console.log('Remove old signed asset: gh ' + args.join(' '));
    if (!dryRun) gh(args);
  });

  const uploadArgs = ['release', 'upload', tag, file, '--clobber'];
  console.log('Upload signed asset: gh ' + uploadArgs.join(' '));
  if (!dryRun) gh(uploadArgs, { stdio: 'inherit' });
}

function carryForward(tag, dryRun) {
  const targetVersion = parseVersion(tag);
  if (!targetVersion) throw new Error('Invalid target tag: ' + tag);

  const releases = listReleases();
  const latest = findLatestSigned(releases);
  if (!latest) {
    console.log('No signed XPI found in any release; nothing to carry forward.');
    return;
  }

  console.log('Latest signed XPI: ' + latest.asset + ' from ' + latest.tag);
  if (compareVersions(latest.version, targetVersion) > 0) {
    console.log('Skip carry-forward: target ' + targetVersion + ' is older than signed ' + latest.version);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinted-signed-'));
  try {
    const downloadArgs = ['release', 'download', latest.tag, '--pattern', latest.asset, '--dir', tempDir, '--clobber'];
    console.log('Download: gh ' + downloadArgs.join(' '));
    if (!dryRun) gh(downloadArgs, { stdio: 'inherit' });

    const file = path.join(tempDir, latest.asset);
    if (!dryRun && !fs.existsSync(file)) throw new Error('Downloaded asset not found: ' + file);
    uploadSignedToRelease(tag, file, latest.version, dryRun);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function publishSigned(tag, version, file, dryRun) {
  const tagVersion = parseVersion(tag);
  const normalized = parseVersion(version);
  if (!tagVersion || !normalized) throw new Error('Invalid tag or version');
  if (tagVersion !== normalized) throw new Error('Tag ' + tag + ' does not match version ' + version);
  if (!fs.existsSync(file)) throw new Error('Signed XPI not found: ' + file);
  const expectedName = 'firefox-vinted-item-refresher-' + normalized + '-signed.xpi';
  if (path.basename(file) !== expectedName) {
    throw new Error('Signed XPI filename must be ' + expectedName + ' (got ' + path.basename(file) + ')');
  }

  const releases = listReleases();
  const target = findRelease(releases, tag);
  if (!target) throw new Error('Release not found: ' + tag);

  uploadSignedToRelease(tag, file, normalized, dryRun);

  releases.forEach(function (release) {
    const releaseVersion = parseVersion(release.tagName);
    if (!releaseVersion) return;
    if (compareVersions(releaseVersion, normalized) <= 0) return;
    uploadSignedToRelease(release.tagName, file, normalized, dryRun);
  });
}

function usage() {
  [
    'Usage:',
    '  node scripts/release-assets.js carry-forward --tag v1.4.6',
    '  node scripts/release-assets.js publish-signed --tag v1.4.6 --version 1.4.6 --file <signed.xpi>',
    '',
    'Requires the GitHub CLI (gh) and GH_TOKEN with contents: write.'
  ].forEach(function (line) { console.log(line); });
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const dryRun = args.includes('--dry-run');

  function option(name) {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1] || null;
  }

  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'carry-forward') {
    const tag = option('--tag');
    if (!tag) throw new Error('Missing --tag');
    carryForward(tag, dryRun);
    return;
  }

  if (command === 'publish-signed') {
    const tag = option('--tag');
    const version = option('--version');
    const file = option('--file');
    if (!tag || !version || !file) throw new Error('Missing --tag, --version, or --file');
    publishSigned(tag, version, file, dryRun);
    return;
  }

  throw new Error('Unknown command: ' + command);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('Release asset operation failed: ' + err.message);
    process.exit(1);
  }
}
