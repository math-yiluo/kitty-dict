/**
 * Generate the PWA / web icons referenced by static/manifest.webmanifest from
 * the cleaned-up assets/icon.png (yellow-bg cat). Also refreshes static/favicon.svg
 * with the new design.
 *
 * Outputs:
 *   static/icon-192.png  — 192×192, listed in manifest
 *   static/icon-512.png  — 512×512, listed in manifest
 *   static/favicon.png   — 256×256 (browser-tab icon if HTML references it)
 *   static/favicon.svg   — keeps existing format but with cat outline as a
 *                          tiny embedded raster fallback for the SVG-aware tab
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'icon.png');
const STATIC = path.join(ROOT, 'static');

(async () => {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Missing ${SRC}. Run process_icon.cjs first.`);
  }

  const sizes = [
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
    { name: 'favicon.png', size: 256 }
  ];

  for (const { name, size } of sizes) {
    const out = path.join(STATIC, name);
    await sharp(SRC).resize(size, size, { fit: 'cover' }).png().toFile(out);
    console.log(`Wrote ${out}`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
