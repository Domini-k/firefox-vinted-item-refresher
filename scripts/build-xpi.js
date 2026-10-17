#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'firefox-permanent-addon-file-build');

// Only these files are shipped inside the XPI. Everything else (tests,
// learning-sources, node_modules, build output) stays out of the package.
const RUNTIME_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'content-main.js',
  'content.css',
  'photo-selection.js',
  'job-delay.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'icons'
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function getVersion() {
  const manifest = readJson('manifest.json');
  const pkg = readJson('package.json');
  if (!manifest.version) throw new Error('manifest.json is missing "version"');
  if (manifest.version !== pkg.version) {
    throw new Error(
      'Version mismatch: manifest.json is ' + manifest.version +
      ' but package.json is ' + pkg.version
    );
  }
  return manifest.version;
}

function walkFiles(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error('Missing runtime file: ' + relativePath);
  }
  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) return [relativePath];

  const files = [];
  fs.readdirSync(absolute, { withFileTypes: true }).forEach(function (entry) {
    const rel = path.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push.apply(files, walkFiles(rel));
    else if (entry.isFile()) files.push(rel);
  });
  return files;
}

function collectRuntimeFiles() {
  const files = [];
  RUNTIME_FILES.forEach(function (entry) {
    files.push.apply(files, walkFiles(entry));
  });
  return files;
}

function addManifestReferences(manifest, target) {
  const background = manifest.background || {};
  (background.scripts || []).forEach(function (file) { target.add(file); });

  (manifest.content_scripts || []).forEach(function (script) {
    (script.js || []).forEach(function (file) { target.add(file); });
    (script.css || []).forEach(function (file) { target.add(file); });
  });

  const action = manifest.action || {};
  if (action.default_popup) target.add(action.default_popup);
  if (typeof action.default_icon === 'string') target.add(action.default_icon);
  else if (action.default_icon) Object.values(action.default_icon).forEach(function (file) { target.add(file); });

  if (manifest.icons) Object.values(manifest.icons).forEach(function (file) { target.add(file); });
}

function validateManifest(manifest) {
  const referenced = new Set();
  addManifestReferences(manifest, referenced);

  const missing = [];
  referenced.forEach(function (file) {
    if (!fs.existsSync(path.join(ROOT, file))) missing.push(file);
  });
  if (missing.length) {
    throw new Error('manifest.json references missing file(s): ' + missing.join(', '));
  }
  return referenced;
}

function stageExtension() {
  const files = collectRuntimeFiles();
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinted-xpi-'));

  files.forEach(function (relativePath) {
    const source = path.join(ROOT, relativePath);
    const destination = path.join(stageDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  });

  return { stageDir: stageDir, files: files };
}

function listArchiveEntries(xpiPath) {
  const result = spawnSync('unzip', ['-Z1', xpiPath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return [];
  return result.stdout.trim().split('\n').filter(Boolean);
}

function buildXpi() {
  const version = getVersion();
  const manifest = readJson('manifest.json');
  validateManifest(manifest);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(
    OUTPUT_DIR,
    'firefox-vinted-item-refresher-' + version + '.xpi'
  );

  const staged = stageExtension();
  try {
    fs.rmSync(outputPath, { force: true });

    const zip = spawnSync(
      'zip',
      ['-r', '-X', '-9', outputPath].concat(staged.files),
      { cwd: staged.stageDir, encoding: 'utf8' }
    );
    if (zip.error) {
      throw new Error('Could not run "zip". Install it first (e.g. sudo apt install zip).');
    }
    if (zip.status !== 0) {
      throw new Error('zip failed: ' + (zip.stderr || zip.stdout || 'unknown error'));
    }

    const stat = fs.statSync(outputPath);
    const entries = listArchiveEntries(outputPath);

    console.log('Built ' + path.relative(ROOT, outputPath));
    console.log('  version: ' + version);
    console.log('  size: ' + (stat.size / 1024).toFixed(1) + ' KB');
    console.log('  files: ' + entries.length);
    entries.forEach(function (entry) { console.log('    ' + entry); });

    return outputPath;
  } finally {
    fs.rmSync(staged.stageDir, { recursive: true, force: true });
  }
}

module.exports = {
  ROOT,
  OUTPUT_DIR,
  RUNTIME_FILES,
  readJson,
  getVersion,
  collectRuntimeFiles,
  validateManifest,
  stageExtension,
  buildXpi
};

if (require.main === module) {
  try {
    buildXpi();
  } catch (err) {
    console.error('Build failed: ' + err.message);
    process.exit(1);
  }
}
