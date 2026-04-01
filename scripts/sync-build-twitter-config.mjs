import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const envFilePath = path.join(repoRoot, '.env');
const buildDir = path.join(repoRoot, 'build');
const outputPath = path.join(buildDir, 'twitter-config.json');

const REQUIRED = Object.freeze({
  bearerToken: 'TWITTER_BEARER',
  retweetersOperationId: 'TWITTER_RETWEETERS_OP_ID',
  searchTimelineOperationId: 'TWITTER_SEARCH_TIMELINE_OP_ID',
  tweetDetailOperationId: 'TWITTER_TWEET_DETAIL_OP_ID',
});

const OPTIONAL = Object.freeze({
  favoritersOperationId: 'TWITTER_FAVORITERS_OP_ID',
  featuresJson: 'TWITTER_RETWEETERS_FEATURES_JSON',
  fieldTogglesJson: 'TWITTER_TWEET_DETAIL_FIELD_TOGGLES_JSON',
});

function readNonEmptyString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function applyEnvFileText(fileText, env) {
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

async function loadBuildEnvironment() {
  const env = { ...process.env };
  if (!existsSync(envFilePath)) {
    return env;
  }

  const fileText = await readFile(envFilePath, 'utf8');
  applyEnvFileText(fileText, env);
  return env;
}

function buildTwitterConfig(env) {
  const twitter = {
    bearerToken: readNonEmptyString(env[REQUIRED.bearerToken]),
    retweetersOperationId: readNonEmptyString(env[REQUIRED.retweetersOperationId]),
    favoritersOperationId: readNonEmptyString(env[OPTIONAL.favoritersOperationId]),
    searchTimelineOperationId: readNonEmptyString(env[REQUIRED.searchTimelineOperationId]),
    tweetDetailOperationId: readNonEmptyString(env[REQUIRED.tweetDetailOperationId]),
    featuresJson: readNonEmptyString(env[OPTIONAL.featuresJson]),
    fieldTogglesJson: readNonEmptyString(env[OPTIONAL.fieldTogglesJson]),
  };

  const missing = Object.entries(REQUIRED)
    .filter(([key]) => !twitter[key])
    .map(([, envName]) => envName);

  return {
    twitter,
    missing,
  };
}

async function syncBuildTwitterConfig() {
  const env = await loadBuildEnvironment();
  const { twitter, missing } = buildTwitterConfig(env);

  await mkdir(buildDir, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: existsSync(envFilePath) ? '.env + process.env' : 'process.env',
    twitter,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  if (missing.length > 0) {
    console.warn(
      `[sync:twitter-config] Missing required values: ${missing.join(', ')}. ` +
        'build/twitter-config.json was generated with empty fields. `npm run dist` will fail until values are provided.'
    );
    return;
  }

  console.log(`[sync:twitter-config] Generated: ${outputPath}`);
}

try {
  await syncBuildTwitterConfig();
} catch (error) {
  console.error(error);
  process.exit(1);
}
