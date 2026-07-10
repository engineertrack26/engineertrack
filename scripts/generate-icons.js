/**
 * Generates app icons from an SVG source of the EngineerTrack mark:
 * an ascending track with checkpoint nodes ending in a gold star
 * (daily logs -> approved achievement). Colors come from src/theme/colors.ts.
 *
 * Usage: node scripts/generate-icons.js
 * Outputs: assets/icon.png, adaptive-icon.png, splash-icon.png, favicon.png
 */
const sharp = require('sharp');
const path = require('path');

const BLUE = '#1a73e8';
const BLUE_DARK = '#1557b0';
const GOLD = '#ffc107';

// Star path (5-point) centered at (cx, cy) with outer radius r
function starPath(cx, cy, r) {
  const inner = r * 0.4;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return pts.join(' ');
}

// The mark: track line through two checkpoint nodes up to a gold star
const mark = `
  <g stroke-linecap="round" stroke-linejoin="round">
    <polyline points="240,760 430,570 560,660 655,505" fill="none"
      stroke="#ffffff" stroke-width="64"/>
    <circle cx="240" cy="760" r="54" fill="#ffffff"/>
    <circle cx="430" cy="570" r="54" fill="#ffffff"/>
    <circle cx="560" cy="660" r="54" fill="#ffffff"/>
    <polygon points="${starPath(790, 310, 155)}" fill="${GOLD}"/>
  </g>
`;

const gradient = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BLUE}"/>
      <stop offset="1" stop-color="${BLUE_DARK}"/>
    </linearGradient>
  </defs>
`;

// Full-bleed icon (iOS masks its own corners)
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${gradient}
  <rect width="1024" height="1024" fill="url(#bg)"/>
  ${mark}
</svg>`;

// Android adaptive foreground: transparent bg, glyph scaled into the
// safe zone (center ~66%); app.json supplies the blue background color
const adaptiveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(512 512) scale(0.62) translate(-512 -512)">${mark}</g>
</svg>`;

// Splash: transparent bg glyph, resizeMode contain over blue background
const splashSvg = adaptiveSvg;

async function main() {
  const out = (f) => path.join(__dirname, '..', 'assets', f);
  await sharp(Buffer.from(iconSvg)).png().toFile(out('icon.png'));
  await sharp(Buffer.from(adaptiveSvg)).png().toFile(out('adaptive-icon.png'));
  await sharp(Buffer.from(splashSvg)).png().toFile(out('splash-icon.png'));
  await sharp(Buffer.from(iconSvg)).resize(48, 48).png().toFile(out('favicon.png'));
  console.log('Generated icon.png, adaptive-icon.png, splash-icon.png, favicon.png');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
