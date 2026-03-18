import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const repoRoot = process.cwd();
const sourceSvgPath = path.join(repoRoot, 'src', 'renderer', 'assets', 'icons', 'app-icon.svg');
const buildDir = path.join(repoRoot, 'build');
const outputIcoPath = path.join(buildDir, 'icon.ico');
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

function assertSourceExists() {
  if (!existsSync(sourceSvgPath)) {
    throw new Error(`App icon source not found: ${sourceSvgPath}`);
  }
}

async function renderPng(svgBuffer, size) {
  return await sharp(svgBuffer, { density: 1024 }).resize(size, size, { fit: 'contain' }).png().toBuffer();
}

async function generateWindowsIcon() {
  assertSourceExists();
  await mkdir(buildDir, { recursive: true });

  const svgBuffer = await readFile(sourceSvgPath);
  const icoPngBuffers = await Promise.all(icoSizes.map((size) => renderPng(svgBuffer, size)));
  const icoBuffer = await pngToIco(icoPngBuffers);
  await writeFile(outputIcoPath, icoBuffer);

  console.log(`Generated icon file: ${outputIcoPath}`);
}

try {
  await generateWindowsIcon();
} catch (error) {
  console.error(error);
  process.exit(1);
}