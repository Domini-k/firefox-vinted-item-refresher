# Building and Installing the XPI

This document covers local XPI builds, unsigned permanent installs, and optional
AMO unlisted signing.

## Prerequisites

- Node.js 22.9 or newer (the signing script uses `--env-file-if-exists`)
- npm
- `zip` and `unzip` on your `PATH` (on Debian/Ubuntu: `sudo apt install zip unzip`)
- Firefox Developer Edition, Nightly, or ESR for unsigned permanent installs
- An AMO developer account only if you want a signed XPI

Install dependencies once:

```bash
npm install
```

## Release commands

Two commands cover the normal workflow:

```bash
npm run release
npm run release:sign
```

- `npm run release` — bumps the patch version, updates all version files, and
  builds the unsigned XPI. It never signs.
- `npm run release -- 1.4.6` — uses an explicit version instead of auto-bumping.
- `npm run release:sign` — signs the current version. It never bumps.
  `npm run release-sign` is an alias.
- `npm run build:xpi` and `npm run sign:xpi` remain available as lower-level
  commands.

`npm run release` does **not** commit, tag, or push. Git stays under your control.

### Version files

The version is stored in three places and must stay aligned:

- `manifest.json` — source of truth for Firefox and the XPI filename
- `package.json` — validated by the build script
- `package-lock.json` — root version updated alongside `package.json`

`npm run release` updates all three files. Running it repeatedly before committing
moves the patch version forward each time; only the final version you commit matters.

The build script fails if `manifest.json` and `package.json` disagree.

## Build the unsigned XPI

For a release, prefer `npm run release`. To rebuild the current version without
bumping it:

```bash
npm run build:xpi
```

Output:

```
firefox-permanent-addon-file-build/firefox-vinted-item-refresher-<version>.xpi
```

For version `1.4.5` that is:

```
firefox-permanent-addon-file-build/firefox-vinted-item-refresher-1.4.5.xpi
```

The package contains only runtime files:

- `manifest.json`
- `background.js`
- `content.js`
- `content-main.js`
- `content.css`
- `photo-selection.js`
- `job-delay.js`
- `popup.html`, `popup.js`, `popup.css`
- `icons/`

Tests, `learning-sources/`, `node_modules/`, and previous XPI builds are excluded.
Older versioned XPIs are kept; the current version is overwritten.

Inspect the archive if needed:

```bash
unzip -l firefox-permanent-addon-file-build/firefox-vinted-item-refresher-1.4.5.xpi
```

The old unversioned `firefox-vinted-item-refresher.xpi`, if still present locally,
is not produced by this task and is ignored by git.

## Install permanently — unsigned

Unsigned XPIs install permanently in **Firefox Developer Edition, Nightly, or ESR**.
Regular Firefox and Beta reject unsigned add-ons.

1. Open `about:config`.
2. Set `xpinstall.signatures.required` to `false`.
3. Open `about:addons`.
4. Click the gear icon and choose **Install Add-on From File**.
5. Select `firefox-permanent-addon-file-build/firefox-vinted-item-refresher-<version>.xpi`.
6. Restart Firefox.

The add-on keeps its ID and stored settings across restarts.

## Sign for regular Firefox — AMO unlisted

Unlisted (self-distributed) signing makes the XPI installable on regular Firefox
without creating a public store listing. AMO still processes the submission.

### 1. Create AMO API credentials

Open <https://addons.mozilla.org/developers/addon/api/key/> and generate an API key
and secret.

### 2. Put the credentials in `.env`

Create `.env` in the repository root:

```bash
WEB_EXT_API_KEY=your-api-key
WEB_EXT_API_SECRET=your-api-secret
```

Or copy the template:

```bash
cp .env.example .env
```

`.env` is gitignored. Never commit it or paste the values into logs, issues, or chat.
Shell-exported variables also work and take precedence over `.env`:

```bash
export WEB_EXT_API_KEY="..."
export WEB_EXT_API_SECRET="..."
```

### 3. Make sure the version is new

AMO rejects a version that was already submitted. `npm run release:sign` signs the
current version without bumping it. If that version was already signed, prepare a
new one first:

```bash
npm run release
```

This bumps the patch version and builds the unsigned XPI. Commit the version files
before signing if you want the signed source and the release to match.

### 4. Sign

> Running this command immediately uploads the current version to AMO and consumes
> that version. There is no confirmation prompt and no dry-run.

```bash
npm run release:sign
```

The script waits up to **30 minutes** for AMO approval by default, then downloads
the signed XPI automatically. Override the wait with:

```bash
WEB_EXT_APPROVAL_TIMEOUT_MS=3600000 npm run release:sign
```

Set `WEB_EXT_APPROVAL_TIMEOUT_MS=0` to submit without waiting; use
`npm run download:signed -- <version> --wait` later to fetch the signed file.

Output:

```
firefox-permanent-addon-file-build/firefox-vinted-item-refresher-<version>-signed.xpi
```

The add-on is signed but not publicly listed on AMO. There is no confirmation
prompt; running the command is the confirmation.

### 5. Install

Open the signed XPI in Firefox, or use `about:addons` → gear →
**Install Add-on From File**.

### Recover or re-download a signed XPI

`npm run release:sign` downloads the signed XPI automatically after AMO approves it.
If the process was interrupted, or you need the file again later, download it
directly from AMO:

```bash
npm run download:signed -- 1.4.5
```

To wait for approval before downloading:

```bash
npm run download:signed -- 1.4.6 --wait
```

The command verifies the SHA-256 hash reported by AMO and writes:

```
firefox-permanent-addon-file-build/firefox-vinted-item-refresher-<version>-signed.xpi
```

### AMO signing limits

Signing is rate-limited per account:

- 3 submissions per minute
- 10 per hour
- 24 per day

File uploads also have separate limits: 6 per minute, 20 per hour, 48 per day.
Do not retry a failed signing in a loop. If you hit HTTP 429, wait before trying
again. Unsigned local builds are not rate-limited.

## GitHub Actions

Two workflows live in `.github/workflows/`:

### Automatic unsigned release

`release-unsigned.yml` runs on every push to `main` and can also be run manually.
Its Actions run name is `Unsigned release build from <commit SHA>`; the release
version is shown in the GitHub Release title and the XPI filename.

1. Runs tests.
2. Compares the pushed `manifest.json` version with the previous commit.
3. If the version already changed, uses it and does not bump again.
4. If the version is unchanged, bumps the patch, commits the version files back to
   `main` with `GITHUB_TOKEN`, and builds that version.
5. Uploads the unsigned XPI as a workflow artifact.
6. Creates/updates GitHub Release `v<version>`.
7. Copies the latest signed XPI from an older release into the new release.

Pushes made with `GITHUB_TOKEN` do not trigger another workflow run, so the automatic
bump does not loop. The workflow needs permission to push to `main`; repository
branch protection must allow the Actions bot to bypass it.

If CI bumps the version, pull the new commit before continuing local work.

### Manual signed release

`release-signed.yml` is manual (`workflow_dispatch`):

1. Choose a version, or leave it empty to use the latest release.
2. Checks out that exact release tag.
3. Runs tests.
4. Checks AMO for an existing signed file. If the version is already signed, it
   downloads and reuses that file instead of submitting again.
5. If not signed yet, runs `npm run release:sign` and waits up to **60 minutes**
   for AMO approval.
6. Uploads the signed XPI to that release.
7. Copies the signed XPI forward to newer releases, without downgrading a newer
   signed asset.

Repository secrets required:

- `WEB_EXT_API_KEY`
- `WEB_EXT_API_SECRET`

Signing never runs automatically. The workflow does not bump the version.

### Release assets

Each release contains:

- `firefox-vinted-item-refresher-X.Y.Z.xpi` — unsigned, unique to that release.
- `firefox-vinted-item-refresher-A.B.C-signed.xpi` — the newest signed XPI, which
  may be older than the unsigned one.

Example:

```
v1.4.6  unsigned 1.4.6  signed 1.4.6
v1.4.7  unsigned 1.4.7  signed 1.4.6
v1.4.8  unsigned 1.4.8  signed 1.4.6
```

## Troubleshooting

### `zip` is missing

```
Build failed: Could not run "zip". Install it first...
```

Install `zip` with your package manager.

### Version mismatch

```
Version mismatch: manifest.json is X but package.json is Y
```

Update both files to the same version, then rebuild.

### AMO reports that the version already exists

Signed submissions cannot reuse a version. Run `npm run release` to bump the patch
version, commit the version files, then run `npm run release:sign` again.

### AMO returns HTTP 429

You hit the signing rate limit (3/minute, 10/hour, 24/day per account). Wait and
retry later. Do not loop the signing command.

### CI cannot push the version bump to main

The unsigned workflow needs permission to push to `main`. Check repository branch
protection and allow the GitHub Actions bot to bypass it, or run `npm run release`
locally and commit the version bump before pushing.

### Local and GitHub versions differ

If CI bumped the version, pull the new commit. If you ran `npm run release` locally,
commit and push the version files so CI uses your version instead of bumping again.

### `web-ext is not installed`

Run `npm install`.

### Unsigned XPI is rejected on install

Use Firefox Developer Edition, Nightly, or ESR, and confirm that
`xpinstall.signatures.required` is `false` in `about:config`. Regular Firefox and
Beta do not allow unsigned add-ons.

### Check the package with web-ext

```bash
npx web-ext lint --source-dir firefox-permanent-addon-file-build/firefox-vinted-item-refresher-<version>.xpi
```

Lint warnings are not automatically build failures.
