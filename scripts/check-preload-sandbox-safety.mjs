import { readFile } from 'node:fs/promises';
import path from 'node:path';

const preloadPath = path.join(process.cwd(), 'dist', 'preload', 'preload.js');

function findDisallowedRequireTargets(content) {
  const matches = [...content.matchAll(/require\((['"])([^'"]+)\1\)/g)];
  return matches
    .map((match) => match[2])
    .filter((target) => typeof target === 'string' && !target.startsWith('electron'));
}

async function checkPreloadSandboxSafety() {
  const content = await readFile(preloadPath, 'utf8');
  const disallowed = findDisallowedRequireTargets(content);
  if (disallowed.length > 0) {
    throw new Error(
      `Sandbox preload safety check failed. Disallowed require targets in ${preloadPath}: ${disallowed.join(', ')}`
    );
  }
}

try {
  await checkPreloadSandboxSafety();
} catch (error) {
  console.error(error);
  process.exit(1);
}
