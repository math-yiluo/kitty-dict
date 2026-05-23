/**
 * Process the user-provided icon-source.png into two clean variants:
 *   assets/icon-foreground.png — transparent bg + cat outline (adaptive icon
 *                                 foreground layer)
 *   assets/icon.png            — #FFF8D6 yellow bg + cat outline (legacy
 *                                 Android, PWA, iOS, favicon)
 *
 * Source-PNG quirks:
 *   - Color type 2 (RGB, no alpha). The editor's transparency-indicator
 *     checkerboard (light-gray 206 ↔ white 252 cells) was baked into the
 *     pixel data both OUTSIDE the cat AND INSIDE the cat (the design is pure
 *     line-art; the cat body is "transparent" too).
 *   - The only real foreground is the dark-green outline (~25,90,60) plus
 *     its anti-aliased edges.
 *
 * Algorithm: keep ONLY greenish pixels (the outline + AA halo). Everything
 * else is background. We use a per-pixel "greenness" score (0..1) so the AA
 * halo gets a partial alpha for smooth edges — looks much better than a
 * hard threshold at icon scale.
 *
 *   greenness = clamp01( min(G-R, G-B) / 50 )
 *   alpha = greenness * 255
 *
 * Outline pure green: G-R = 65, G-B = 30 → min/50 = 0.6 → alpha ≈ 153.
 * To keep solid lines we boost: anything with min(G-R, G-B) > 8 gets alpha
 * = 255 in the interior, with a smooth taper for very edge pixels.
 */
const sharp = require('sharp');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'icon-source.png');
const OUT_FG = path.join(ROOT, 'assets', 'icon-foreground.png');
const OUT_FULL = path.join(ROOT, 'assets', 'icon.png');

const BG_R = 0xff, BG_G = 0xf8, BG_B = 0xd6; // #FFF8D6

// The outline's representative color (sampled from the source). We snap fg
// pixels to this so AA edges don't carry traces of the gray bg they used to
// blend with.
const OUT_R = 25, OUT_G = 90, OUT_B = 60;

function greenAlpha(r, g, b) {
  // How "green-dominant" is this pixel?
  const gr = g - r;
  const gb = g - b;
  const score = Math.min(gr, gb);
  if (score <= 0) return 0;
  if (score >= 25) return 255; // solid outline interior
  // Smooth ramp from 0 to 255 over the AA range.
  return Math.round((score / 25) * 255);
}

(async () => {
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  console.log(`Source: ${w}×${h}`);

  const transparent = Buffer.alloc(w * h * 4);
  const yellow = Buffer.alloc(w * h * 4);

  // First pass: chroma-key the green outline and capture the bbox of real
  // foreground pixels (alpha ≥ a threshold). bbox + the canvas center will
  // drive the centered crop in the second pass.
  let minX = w, maxX = -1, minY = h, maxY = -1, fgCount = 0;
  for (let idx = 0; idx < w * h; idx++) {
    const i = idx * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const a = greenAlpha(r, g, b);
    if (a > 0) fgCount++;

    // Transparent variant:
    //  - For OPAQUE / AA-edge pixels (a > 0): snap to clean outline color
    //    so AA halos lose any gray residue from the original bg they
    //    blended against. Edges of the cat then render as soft green over
    //    whatever bg the adaptive icon's bg layer provides.
    //  - For FULLY-TRANSPARENT pixels (a === 0): snap RGB to the bg yellow
    //    (#FFF8D6). Sharp / @capacitor/assets downsample this 2048×2048
    //    foreground to 432, 324, 216, 162, 108, 72 px using bilinear
    //    interpolation, which AVERAGES RGB across alpha boundaries. If
    //    transparent pixels carry the green outline RGB (like the previous
    //    revision did), the resize introduces a faint green halo at the
    //    boundary between transparent strips and the cat content —
    //    visible on the rendered Android icon as a faint horizontal line
    //    along the bottom and a vertical line down the right (where the
    //    shift introduced fully-transparent strips). Carrying yellow in
    //    the RGB of transparent pixels means resize halos blend
    //    seamlessly into the yellow bg layer.
    if (a > 0) {
      transparent[i] = OUT_R;
      transparent[i + 1] = OUT_G;
      transparent[i + 2] = OUT_B;
    } else {
      transparent[i] = BG_R;
      transparent[i + 1] = BG_G;
      transparent[i + 2] = BG_B;
    }
    transparent[i + 3] = a;

    // Yellow variant: pre-blend outline over yellow bg at the same alpha.
    const alphaF = a / 255, inv = 1 - alphaF;
    yellow[i] = Math.round(OUT_R * alphaF + BG_R * inv);
    yellow[i + 1] = Math.round(OUT_G * alphaF + BG_G * inv);
    yellow[i + 2] = Math.round(OUT_B * alphaF + BG_B * inv);
    yellow[i + 3] = 255;

    // Strict bbox: only count SOLID outline pixels (alpha ≥ 200, i.e. the
    // "score >= 20" range from greenAlpha). A looser threshold sucks in faint
    // AA halos and stray near-green noise, blowing the bbox out far beyond
    // what the eye sees as the cat — and that bloated bbox would prevent the
    // canvas from cropping tight enough to actually enlarge the cat.
    if (a >= 200) {
      const x = idx % w;
      const y = (idx - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const bboxW = maxX - minX, bboxH = maxY - minY;
  const cx = ((minX + maxX) / 2) | 0;
  const cy = ((minY + maxY) / 2) | 0;
  console.log(
    `Foreground pixels: ${fgCount} / ${w * h}; bbox ${bboxW}×${bboxH}, center (${cx},${cy})`
  );

  // -- Crop / canvas sizes --
  //
  // To make the cat appear ~1.35× larger than in the previous build:
  //   * icon.png (legacy + PWA + favicon): tight-crop the source so the cat
  //     bounding box fills ~81% of the canvas (vs. ~60% before).
  //   * icon-foreground.png (adaptive): use the source AT its native 2048×2048
  //     with no extra padding. The XML 16.7% inset still creates the safe
  //     zone for adaptive masks; without our extra padding the cat occupies
  //     ~60% of the foreground PNG, so after the inset it sits at ~50% of the
  //     final adaptive composite — about 1.35× larger than the previous
  //     ~37% (which had this PNG padded out to 2800×2800).
  //
  // Crop math: square canvas centered on the cat's bbox center; side length
  // chosen so cat takes the target proportion of the canvas (driven by the
  // larger of bbox dim, so the cat is never clipped).
  const targetRatio = 0.81;
  const longerBboxSide = Math.max(bboxW, bboxH);
  const cropSize = Math.min(w, h, Math.round(longerBboxSide / targetRatio));

  // Off-center the cat slightly up-and-right (user preference).
  //   SHIFT_DX > 0 → cat shifts right in output
  //   SHIFT_DY > 0 → cat shifts up   in output
  // Applied identically (in source pixels) to both variants so the cat
  // tracks the same direction in legacy and adaptive icons. 45 source px
  // ≈ 3% of the icon.png crop (1526 px) ≈ 5–6 px in a 192-px legacy icon.
  const SHIFT_DX = 45;
  const SHIFT_DY = 45;

  // Center crop on bbox, then translate window left+down to push the cat
  // visually right+up in the output. Clamp to canvas bounds.
  const cropLeft = Math.max(
    0,
    Math.min(w - cropSize, cx - (cropSize >> 1) - SHIFT_DX)
  );
  const cropTop = Math.max(
    0,
    Math.min(h - cropSize, cy - (cropSize >> 1) + SHIFT_DY)
  );
  console.log(
    `Tight crop for icon.png: ${cropSize}×${cropSize} at (${cropLeft},${cropTop}) → cat fills ${((longerBboxSide / cropSize) * 100).toFixed(1)}%, shifted (+${SHIFT_DX},-${SHIFT_DY})`
  );

  // icon.png (yellow bg, legacy + PWA): tight crop with the shift applied.
  await sharp(yellow, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: cropLeft, top: cropTop, width: cropSize, height: cropSize })
    .png()
    .toFile(OUT_FULL);

  // icon-foreground.png (transparent, adaptive): native canvas size with the
  // cat translated right+up. We do the shift via direct raw-buffer copy —
  // sharp's extend+extract chain hits boundary issues at exactly-flush
  // extract regions, and a manual translation has no such gotchas:
  //   out(x,y) = src(x - SHIFT_DX, y + SHIFT_DY)
  // Pixels falling outside the source bounds become fully transparent.
  //
  // Pre-fill the entire shift output with TRANSPARENT YELLOW (RGB = #FFF8D6,
  // alpha = 0). The shift introduces a 45-px transparent strip along the
  // left edge (cat shifted right) and another along the bottom (cat shifted
  // up); if those strips carried RGB (0,0,0) or RGB (25,90,60), the
  // downstream resize would interpolate-blend them with the cat content
  // and produce a faint dark/green halo at the strip boundary — visible
  // as a horizontal line at the bottom edge and a vertical line at the
  // right edge of the rendered Android icon. Yellow-RGB transparent
  // pixels blend seamlessly into the icon's yellow bg layer.
  const shiftedFg = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    shiftedFg[i] = BG_R;
    shiftedFg[i + 1] = BG_G;
    shiftedFg[i + 2] = BG_B;
    // alpha left at 0
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - SHIFT_DX;
      const sy = y + SHIFT_DY;
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue; // already 0/transparent yellow
      const outI = (y * w + x) * 4;
      const srcI = (sy * w + sx) * 4;
      shiftedFg[outI] = transparent[srcI];
      shiftedFg[outI + 1] = transparent[srcI + 1];
      shiftedFg[outI + 2] = transparent[srcI + 2];
      shiftedFg[outI + 3] = transparent[srcI + 3];
    }
  }
  await sharp(shiftedFg, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(OUT_FG);

  console.log(`Wrote ${OUT_FG} (${w}×${h}, shifted +${SHIFT_DX},-${SHIFT_DY})`);
  console.log(
    `Wrote ${OUT_FULL} (${cropSize}×${cropSize} crop — cat ~81%, shifted +${SHIFT_DX},-${SHIFT_DY})`
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
