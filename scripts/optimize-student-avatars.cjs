// Technical asset packaging only: preserve original composition and PNG sources.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../assets/avatars');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'generation-manifest.json'), 'utf8'));
(async () => {
  fs.mkdirSync(path.join(root, 'mobile'), { recursive: true });
  let inputBytes = 0, outputBytes = 0;
  for (const asset of manifest.assets) {
    if (!/^0[1-9]-(1|5|10)$/.test(asset.id) || !/^0[1-9]-(1|5|10)(-v2)?\.png$/.test(asset.file)) throw Error('Invalid asset');
    const input = path.join(root, asset.file), output = path.join(root, 'mobile', asset.id + '.webp');
    await sharp(input).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84, effort: 6 }).toFile(output);
    inputBytes += fs.statSync(input).size; outputBytes += fs.statSync(output).size;
  }
  console.log(JSON.stringify({ images: manifest.assets.length, inputBytes, outputBytes }));
})().catch(error => { console.error(error); process.exitCode = 1; });
