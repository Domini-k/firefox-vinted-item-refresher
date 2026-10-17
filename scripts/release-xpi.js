#!/usr/bin/env node
'use strict';

const { buildXpi } = require('./build-xpi');
const { getVersion, nextPatch, setVersion } = require('./version');

function usage() {
  [
    'Usage: node scripts/release-xpi.js [<version>] [--bump-only]',
    '',
    '  <version>      Explicit version (e.g. 1.4.6). Default: bump the patch version.',
    '  --bump-only    Update version files but do not build the XPI (used by CI).',
    '',
    'Examples:',
    '  npm run release',
    '  npm run release -- 1.4.6',
    '  node scripts/release-xpi.js --bump-only'
  ].forEach(function (line) { console.log(line); });
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const bumpOnly = args.includes('--bump-only');
  const explicitVersion = args.find(function (arg) { return !arg.startsWith('-'); });
  const target = explicitVersion || nextPatch(getVersion());
  const result = setVersion(target);

  console.log('Version: ' + result.previous + ' -> ' + result.version);

  if (bumpOnly) {
    console.log('Version files updated (bump-only).');
    return;
  }

  const output = buildXpi();
  console.log('Release XPI ready: ' + output);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('Release failed: ' + err.message);
    process.exit(1);
  }
}
