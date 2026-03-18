import { readFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const sourcePath = path.join(rootDir, 'src', 'types', 'ipc.channels.ts');
const targetPath = path.join(rootDir, 'src', 'renderer', 'state', 'ipc.channels.ts');

function stripGeneratedHeader(content) {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  return normalized.replace(/^\/\/ AUTO-GENERATED:[^\n]*\n\n/, '').trimEnd();
}

const [sourceContent, targetContent] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(targetPath, 'utf8')]);

if (stripGeneratedHeader(sourceContent) !== stripGeneratedHeader(targetContent)) {
  console.error('IPC channel files are out of sync.');
  console.error('Run `node scripts/sync-ipc-channels.mjs` (or `npm run build`) and commit the updated renderer IPC channels file.');
  process.exit(1);
}
