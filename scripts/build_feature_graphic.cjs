/**
 * Generate the 1024×500 Play Store feature graphic.
 *
 * Layout: icon on left, title + subtitle + tagline on right.
 * Background: cream (#FFF8D6) matching the app theme.
 * Text rendered via SVG composite — sharp's librsvg/pango pulls Windows
 * system fonts for Chinese glyphs.
 *
 * Output: assets/feature-graphic.png (no alpha, ready for Play Console upload).
 *
 * Usage: node scripts/build_feature_graphic.cjs
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const WIDTH = 1024;
const HEIGHT = 500;
// icon-source.png has the editor's transparency checkerboard baked into
// its pixels (see process_icon.cjs comment block). icon-foreground.png is
// the cleaned-up version with a real alpha channel — composite-safe.
const ICON_PATH = path.resolve(__dirname, '..', 'assets', 'icon-foreground.png');
const OUT_PATH = path.resolve(__dirname, '..', 'assets', 'feature-graphic.png');

// Palette — matches the app's cream / dark-green identity.
const BG_COLOR = { r: 0xff, g: 0xf8, b: 0xd6 }; // #FFF8D6
const TITLE_COLOR = '#1F5C3C';
const SUBTITLE_COLOR = '#4A6657';
const TAGLINE_COLOR = '#6B7F73';

async function main() {
  // 1. Icon: resize, keep transparency so it composites cleanly onto bg.
  const ICON_SIZE = 340;
  const iconBuf = await sharp(ICON_PATH)
    .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // 2. Text overlay as SVG. Font stack tries Taiwan-flavored fonts first.
  //    librsvg/pango falls back through the list if a font isn't installed.
  const fontFamily =
    '"Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC", "PMingLiU", sans-serif';
  const textX = 440;
  // Subtitle and tagline are centered (text-anchor="middle") under the title.
  // Title is left-aligned at x=textX; estimated rendered width ~460px, so its
  // visual center sits around x=670 — that's where we center the lower lines.
  const centerX = 670;
  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <text x="${textX}" y="210" font-family='${fontFamily}' font-weight="800"
          font-size="118" fill="${TITLE_COLOR}">貓咪辭典</text>
    <text x="${centerX}" y="285" font-family='${fontFamily}' font-weight="500"
          font-size="44" fill="${SUBTITLE_COLOR}" text-anchor="middle">為台語學習者打造</text>
    <text x="${centerX}" y="370" font-family='${fontFamily}' font-weight="400"
          font-size="26" fill="${TAGLINE_COLOR}" text-anchor="middle">教育部音檔 · 完全離線 · 開源免費</text>
  </svg>`;

  // 3. Compose: cream bg → icon → text overlay. channels:3 forces no alpha
  //    in the OUTPUT (Play Store rejects alpha on feature graphics).
  const result = await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: BG_COLOR
    }
  })
    .composite([
      {
        input: iconBuf,
        top: Math.round((HEIGHT - ICON_SIZE) / 2),
        left: 80
      },
      {
        input: Buffer.from(svg),
        top: 0,
        left: 0
      }
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();

  await fs.promises.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.promises.writeFile(OUT_PATH, result);
  console.log(`Wrote ${OUT_PATH} (${(result.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
