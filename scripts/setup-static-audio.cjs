/**
 * Create a platform-appropriate link from static/audio/{sutiau,leku} to
 * data/{sutiau,leku}-mp3, so SvelteKit's static adapter (and the vite dev
 * server) can serve the audio files at /audio/sutiau/* and /audio/leku/*
 * URLs without duplicating ~884 MB on disk.
 *
 * Windows: NTFS junction (works without admin privileges).
 * macOS / Linux: regular symlink.
 *
 * Run once after `git clone`:
 *   node scripts/setup-static-audio.cjs
 *
 * Safe to re-run: removes existing links before recreating them.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const repoRoot = path.resolve(__dirname, '..');
const links = [
  { from: path.join(repoRoot, 'static', 'audio', 'sutiau'),
    to:   path.join(repoRoot, 'data', 'sutiau-mp3') },
  { from: path.join(repoRoot, 'static', 'audio', 'leku'),
    to:   path.join(repoRoot, 'data', 'leku-mp3') },
];

fs.mkdirSync(path.join(repoRoot, 'static', 'audio'), { recursive: true });

const isWindows = os.platform() === 'win32';
const linkType = isWindows ? 'junction' : 'dir';

for (const { from, to } of links) {
  if (!fs.existsSync(to)) {
    console.error(`ERROR: target does not exist: ${to}`);
    console.error('Did you `git clone` with LFS / large objects fully pulled?');
    process.exitCode = 1;
    continue;
  }

  // Remove existing link (lstat to avoid following the link).
  try {
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      // On Windows junctions, lstat reports isDirectory()=true. rmSync handles both.
      fs.rmSync(from, { recursive: false, force: true });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  fs.symlinkSync(to, from, linkType);
  console.log(`linked  ${path.relative(repoRoot, from)}  ->  ${path.relative(repoRoot, to)}`);
}

console.log('\nDone. You can now run `npm run dev` or `npm run build`.');
