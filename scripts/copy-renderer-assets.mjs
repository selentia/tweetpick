import { cp, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const srcRendererDir = path.join(rootDir, 'src', 'renderer');
const distRendererDir = path.join(rootDir, 'dist', 'renderer');
const srcAssetsDir = path.join(srcRendererDir, 'assets');
const srcStylesDir = path.join(srcRendererDir, 'styles');
const distAssetsDir = path.join(distRendererDir, 'assets');
const distStylesDir = path.join(distRendererDir, 'styles');

const assets = [
  { from: 'index.html', to: 'index.html' },
  { from: 'info.html', to: 'info.html' },
  { from: 'legal.html', to: 'legal.html' },
];

await mkdir(distRendererDir, { recursive: true });

for (const asset of assets) {
  const fromPath = path.join(srcRendererDir, asset.from);
  const toPath = path.join(distRendererDir, asset.to);
  await copyFile(fromPath, toPath);
}

await cp(srcAssetsDir, distAssetsDir, { recursive: true, force: true });
await cp(srcStylesDir, distStylesDir, { recursive: true, force: true });
