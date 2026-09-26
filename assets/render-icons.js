'use strict';

// Renders the PNG icons from the SVG sources with the Chromium that Playwright uses (a dev
// tool only: the app has no runtime dependency on it). Run: node assets/render-icons.js
// (with playwright resolvable, e.g. NODE_PATH pointing to a global install).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'public', 'icons');
const TARGETS = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-512-maskable.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180], // iOS rounds the corners itself
  ['icon.svg', 'favicon-32.png', 32],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [source, name, size] of TARGETS) {
    const svg = fs.readFileSync(path.join(__dirname, source), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(OUT, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  fs.copyFileSync(path.join(__dirname, 'icon.svg'), path.join(OUT, 'favicon.svg'));
  await browser.close();
  console.log(`icons written to ${OUT}`);
})();
