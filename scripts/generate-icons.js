/**
 * Package the owner's official logos without redrawing or cropping them.
 * Sources are preserved. Run: node scripts/generate-icons.js
 */
const sharp = require('sharp');
const path = require('path');

const asset = (name) => path.join(__dirname, '..', 'assets', name);
const square = asset('engineertrack_logo_square.png');
const background = '#EEF0EC';

async function canvas(size, logoSize, transparent) {
  const logo = await sharp(square).resize(logoSize, logoSize, { fit: 'contain' }).png().toBuffer();
  return sharp({ create: {
    width: size, height: size, channels: 4,
    background: transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : background,
  } }).composite([{ input: logo, gravity: 'centre' }]);
}

async function main() {
  // Opaque full icon; no baked-in rounded corners.
  await (await canvas(1024, 880, false)).removeAlpha().png().toFile(asset('icon.png'));
  // A distinct asset URL avoids reusing the previous brand's icon cache in Expo Go.
  await sharp(asset('icon.png')).png().toFile(asset('engineertrack-app-icon.png'));
  // Entire artwork stays within the central safe circle, including the wordmark.
  await (await canvas(1024, 460, true)).png().toFile(asset('adaptive-icon.png'));
  await (await canvas(1024, 880, true)).png().toFile(asset('splash-icon.png'));
  await sharp(asset('icon.png')).resize(48, 48).png().toFile(asset('favicon.png'));
  console.log('Packaged official icon, adaptive icon, splash and favicon; source logos unchanged.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
