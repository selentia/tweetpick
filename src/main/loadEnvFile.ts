import { existsSync, readFileSync } from 'node:fs';

export function applyEnvFileText(fileText: string, env: NodeJS.ProcessEnv = process.env): void {
  for (const rawLine of fileText.split(/\r?\n/u)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const line = trimmedLine.startsWith('export ') ? trimmedLine.slice(7).trim() : trimmedLine;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    const hasWrappingDoubleQuotes = value.startsWith('"') && value.endsWith('"');
    const hasWrappingSingleQuotes = value.startsWith("'") && value.endsWith("'");
    if ((hasWrappingDoubleQuotes || hasWrappingSingleQuotes) && value.length >= 2) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }
}

export function loadEnvFileIfPresent(envFilePath: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(envFilePath)) {
    return;
  }

  const fileText = readFileSync(envFilePath, 'utf8');
  applyEnvFileText(fileText, env);
}
