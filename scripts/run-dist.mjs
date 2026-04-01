import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

function run(command, { allowFailure = false } = {}) {
  try {
    execSync(command, {
      stdio: 'inherit',
      shell: true,
    });
    return true;
  } catch (error) {
    if (allowFailure) {
      return false;
    }
    throw error;
  }
}

function runQuiet(command) {
  const result = spawnSync(command, {
    stdio: 'pipe',
    shell: true,
    encoding: 'utf8',
  });

  return {
    success: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function sleepMs(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function isWindowsLockError(text) {
  return /EBUSY|EPERM|ENOTEMPTY/i.test(text);
}

function cleanReleaseDirectory() {
  const releaseDir = resolve('release');
  if (!existsSync(releaseDir)) {
    return { success: true, errorText: '' };
  }

  try {
    rmSync(releaseDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 250,
    });
    return { success: true, errorText: '' };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    return { success: false, errorText };
  }
}

function releaseWindowsLocks() {
  if (process.platform !== 'win32') {
    return;
  }

  runQuiet('taskkill /F /IM "TweetPick.exe"');
  runQuiet('taskkill /F /IM "TweetPick*.exe"');
}

function cleanReleaseWithRetry() {
  if (process.platform !== 'win32') {
    const result = cleanReleaseDirectory();
    if (!result.success) {
      throw new Error(`Failed to clean release directory: ${result.errorText}`);
    }
    return true;
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = cleanReleaseDirectory();
    if (result.success) {
      return true;
    }

    const lockError = isWindowsLockError(result.errorText);
    if (!lockError) {
      throw new Error(`Failed to clean release directory: ${result.errorText}`);
    }

    console.warn(`release cleanup locked (attempt ${attempt}/${maxAttempts}). Retrying...`);
    releaseWindowsLocks();
    sleepMs(1200);
  }

  return false;
}

function ensureWindowsIcon() {
  const iconPath = resolve('build', 'icon.ico');
  if (!existsSync(iconPath)) {
    throw new Error(`Windows icon is missing: ${iconPath}`);
  }
}

function ensureBakedTwitterConfig() {
  const configPath = resolve('build', 'twitter-config.json');
  if (!existsSync(configPath)) {
    throw new Error(`Build-time Twitter config is missing: ${configPath}. Run npm run build first.`);
  }

  const requiredFields = [
    'bearerToken',
    'retweetersOperationId',
    'searchTimelineOperationId',
    'tweetDetailOperationId',
  ];

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error(`Failed to parse build-time Twitter config: ${configPath}`);
  }

  const twitter = parsed && typeof parsed === 'object' ? parsed.twitter : null;
  const missing = requiredFields.filter((field) => {
    const value = twitter && typeof twitter === 'object' ? twitter[field] : null;
    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(
      `Build-time Twitter config has empty required fields: ${missing.join(', ')}. ` +
        'Set TWITTER_BEARER, TWITTER_RETWEETERS_OP_ID, TWITTER_SEARCH_TIMELINE_OP_ID, TWITTER_TWEET_DETAIL_OP_ID in .env (local) or GitHub Actions env/secrets. TWITTER_FAVORITERS_OP_ID is optional and falls back to TWITTER_RETWEETERS_OP_ID.'
    );
  }
}

function runDist() {
  if (process.platform !== 'win32') {
    throw new Error('npm run dist is currently supported only on Windows hosts.');
  }

  const cleaned = cleanReleaseWithRetry();
  run('npm run build');
  ensureWindowsIcon();
  ensureBakedTwitterConfig();

  if (!cleaned) {
    const fallbackOutputDir = `release-fallback-${Date.now()}`;
    console.warn(`release directory is still locked. Building to ${fallbackOutputDir} instead.`);
    run(`electron-builder --config.directories.output=${fallbackOutputDir}`);
    return;
  }

  run('electron-builder');
}

try {
  runDist();
} catch (error) {
  console.error(error);
  process.exit(1);
}
