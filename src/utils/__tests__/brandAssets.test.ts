import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('app.json', 'utf8')).expo;

test('official source logos keep their original dimensions and transparency', async () => {
  for (const [file, width, height] of [
    ['engineertrack_logo.png', 2000, 740], ['engineertrack_logo_square.png', 2000, 2000],
  ] as const) {
    const meta = await sharp(`assets/${file}`).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([width, height, true]);
  }
});

test('packaged icon is opaque and all generated assets have the intended size', async () => {
  for (const file of ['engineertrack-app-icon.png', 'icon.png', 'adaptive-icon.png', 'splash-icon.png', 'favicon.png']) {
    const meta = await sharp(`assets/${file}`).metadata();
    const size = file === 'favicon.png' ? 48 : 1024;
    expect([meta.width, meta.height]).toEqual([size, size]);
  }
  expect((await sharp('assets/icon.png').metadata()).hasAlpha).toBe(false);
  expect(config.icon).toBe('./assets/engineertrack-app-icon.png');
  expect((await sharp(config.icon).metadata()).hasAlpha).toBe(false);
});

test('adaptive foreground stays inside the central safe circle', async () => {
  const { data, info } = await sharp('assets/adaptive-icon.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const radius = info.width * 66 / 108 / 2;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      if (Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2) > radius) {
        throw new Error('Visible artwork extends beyond the adaptive icon safe circle');
      }
    }
  }
});

test('native branding uses the light background and both auth screens use the wordmark', () => {
  expect(config.android.adaptiveIcon.backgroundColor).toBe('#EEF0EC');
  const splash = config.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')[1];
  expect(splash.backgroundColor).toBe('#EEF0EC');
  expect(splash.imageWidth).toBe(200);
  for (const screen of ['login', 'register']) {
    const source = readFileSync(`app/(auth)/${screen}.tsx`, 'utf8');
    expect(source).toContain('<AuthBrand />');
    expect(source).not.toContain('styles.logo}>EngineerTrack');
  }
  const brand = readFileSync('src/components/common/AuthBrand.tsx', 'utf8');
  expect(brand).toContain('assets/engineertrack_logo.png');
  expect(brand).toContain('aspectRatio: 2000 / 740');
  expect(brand).toContain("position: 'absolute'");
  expect(brand).toContain("height: '100%'");
});
