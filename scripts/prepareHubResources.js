/**
 * prepareHubResources.js
 *
 * Downloads the AionHub index.json and all extension zip packages
 * into resources/hub/ so they are bundled with the app as local fallback.
 *
 * Called during the build pipeline before electron-builder runs.
 *
 * Environment variables:
 *   AIONUI_HUB_TAG    - Git tag to fetch from (default: 'dist-latest')
 *   AIONUI_HUB_SKIP   - Set to '1' to skip hub resource preparation
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { pipeline } = require('stream');
const { sha256, restoreDownload, saveDownload } = require('../packages/shared-scripts/src/build-cache');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TAG = 'dist-latest';
const BASE_URLS = [
  `https://raw.githubusercontent.com/iOfficeAI/AionHub/${process.env.AIONUI_HUB_TAG || DEFAULT_TAG}/`,
  `https://cdn.jsdelivr.net/gh/iOfficeAI/AionHub@${process.env.AIONUI_HUB_TAG || DEFAULT_TAG}/`,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Download a URL to a local file path. Tries each base URL in order.
 * Returns the base URL that succeeded.
 */
async function downloadFile(relativePath, destPath) {
  for (const base of BASE_URLS) {
    const url = new URL(relativePath, base).toString();
    try {
      await downloadUrl(url, destPath);
      return url;
    } catch (error) {
      console.warn(`  [hub] Failed from ${url}: ${error.message}`);
    }
  }
  throw new Error(`Failed to download ${relativePath} from all mirrors`);
}

function downloadUrl(url, destPath) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const get = url.startsWith('https') ? https.get : require('http').get;
      get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          follow(new URL(res.headers.location, url).toString(), redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(destPath);
        pipeline(res, file, (error) => {
          if (error) {
            fs.rmSync(destPath, { force: true });
            reject(error);
          } else {
            resolve();
          }
        });
      }).on('error', reject);
    };

    follow(url);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function prepareHubResources({
  root = PROJECT_ROOT,
  download = downloadFile,
  cacheDir = path.join(os.homedir(), '.cache', 'aionui-build', 'hub-v1'),
} = {}) {
  if (process.env.AIONUI_HUB_SKIP === '1') {
    console.log('[hub] Skipping hub resource preparation (AIONUI_HUB_SKIP=1)');
    return { skipped: true };
  }
  const tag = process.env.AIONUI_HUB_TAG || DEFAULT_TAG;
  const hubDir = path.join(root, 'resources', 'hub');
  ensureDir(path.dirname(hubDir));
  const staging = fs.mkdtempSync(path.join(path.dirname(hubDir), '.hub-'));
  const indexPath = path.join(staging, 'index.json');
  const indexSource = `https://raw.githubusercontent.com/iOfficeAI/AionHub/${tag}/index.json`;
  let offline = false;
  try {
    let indexUrl;
    try {
      indexUrl = await download('index.json', indexPath);
    } catch (error) {
      if (!restoreDownload(cacheDir, indexSource, indexPath)) throw error;
      offline = true;
      indexUrl = indexSource;
      console.log('[hub-cache] offline: using last complete cached index');
    }
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const extensions = Object.entries(index.extensions || {});
    const results = [];
    const filenames = new Set();
    for (const [name, ext] of extensions) {
      const tarball = ext.dist?.tarball;
      if (!tarball) continue;
      const filename = path.basename(tarball);
      if (filenames.has(filename)) throw new Error(`Duplicate Hub archive filename: ${filename}`);
      filenames.add(filename);
      const zipPath = path.join(staging, filename);
      const integrity = ext.dist?.integrity || '';
      const expected = /^sha256-[a-fA-F0-9]{64}$/.test(integrity) ? integrity.slice(7).toLowerCase() : null;
      // No checksum means no reuse: a mutable tag or URL alone is not a content identity.
      const source = `${indexSource}#${tarball}#${expected}`;
      try {
        const cached = expected && restoreDownload(cacheDir, source, zipPath, expected);
        if (offline && !cached) throw new Error('Incomplete offline Hub cache');
        const url = cached ? new URL(tarball, indexSource).toString() : await download(tarball, zipPath);
        if (integrity && !expected) throw new Error('Unsupported Hub integrity format');
        const digest = sha256(zipPath);
        if (expected && digest !== expected) throw new Error('Hub archive SHA256 mismatch');
        if (expected && !cached) saveDownload(cacheDir, source, zipPath);
        results.push({ name, file: filename, size: fs.statSync(zipPath).size, url, sha256: digest });
        console.log(`[hub-cache] ${cached ? 'hit' : 'miss'}: ${name}`);
      } catch (error) {
        fs.rmSync(zipPath, { force: true });
        if (offline) throw error;
        console.error(`[hub] Failed to download ${name}: ${error.message}`);
      }
    }
    const complete = results.length === extensions.length;
    fs.writeFileSync(
      path.join(staging, 'manifest.json'),
      JSON.stringify(
        {
          tag,
          generatedAt: new Date().toISOString(),
          indexUrl,
          indexSha256: sha256(indexPath),
          complete,
          extensions: results,
        },
        null,
        2
      ) + '\n'
    );
    if (complete && results.every((entry) => extensions.find(([name]) => name === entry.name)[1].dist?.integrity)) {
      saveDownload(cacheDir, indexSource, indexPath);
    }
    // Keep the previous resource set on a partial refresh. The existing
    // non-fatal online extension policy is retained, and reported explicitly.
    if (!complete && fs.existsSync(hubDir)) {
      console.warn('[hub] Partial refresh; preserving previous resources (not a cache success)');
      return { skipped: false, count: results.length, total: extensions.length, complete, published: false };
    }
    const backup = `${staging}-previous`;
    if (fs.existsSync(hubDir)) fs.renameSync(hubDir, backup);
    try {
      fs.renameSync(staging, hubDir);
    } catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, hubDir);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
    return { skipped: false, count: results.length, total: extensions.length, complete, published: true };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// Support both direct execution and require() from build-with-builder.js
if (require.main === module) {
  prepareHubResources().catch((err) => {
    console.error('[hub] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { prepareHubResources };
