import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const sourcePath = path.join(rootDir, 'src', 'types', 'ipc.channels.ts');
const targetPath = path.join(rootDir, 'src', 'renderer', 'state', 'ipc.channels.ts');

const sourceContent = await readFile(sourcePath, 'utf8');
const normalizedSource = sourceContent.replace(/^\uFEFF/, '').trimEnd();
const nextContent = `${normalizedSource}\n`;

await writeFile(targetPath, nextContent, 'utf8');