import { readFile } from 'node:fs/promises';
import path from 'node:path';

const targetPath = path.join(process.cwd(), 'dist', 'types', 'ipc.channels.js');

function hasEsModuleExportSyntax(content) {
  return /\bexport\s+const\s+IPC_CHANNELS\b/.test(content);
}

async function checkDistModuleFormat() {
  const content = await readFile(targetPath, 'utf8');
  if (hasEsModuleExportSyntax(content)) {
    throw new Error(
      `Invalid module format at ${targetPath}: expected CommonJS output for main process compatibility.`
    );
  }
}

try {
  await checkDistModuleFormat();
} catch (error) {
  console.error(error);
  process.exit(1);
}
