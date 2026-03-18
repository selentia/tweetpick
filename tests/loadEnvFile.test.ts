import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';

import { applyEnvFileText, loadEnvFileIfPresent } from '@main/loadEnvFile';

function withTempDir(run: (tempDir: string) => void): void {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'load-env-file-'));
  try {
    run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test('skip missing env file', () => {
  withTempDir((tempDir) => {
    const env: NodeJS.ProcessEnv = { EXISTING_KEY: 'existing' };

    loadEnvFileIfPresent(path.join(tempDir, '.env'), env);

    assert.deepEqual(env, { EXISTING_KEY: 'existing' });
  });
});

test('parse supported lines and keep existing env values', () => {
  withTempDir((tempDir) => {
    const envFilePath = path.join(tempDir, '.env');
    writeFileSync(
      envFilePath,
      [
        '# comment',
        '   # spaced comment',
        '',
        'BASIC=alpha',
        'export EXPORTED=beta',
        'WITH_EQUALS=a=b=c',
        'EMPTY_VALUE=',
        'DOUBLE_QUOTED="hello world"',
        "SINGLE_QUOTED='hello world'",
        'SPACED = " keep inner spacing "',
        'NO_SEPARATOR',
        '=INVALID',
        'PRESET=from-file',
      ].join('\n'),
      'utf8'
    );

    const env: NodeJS.ProcessEnv = { PRESET: 'from-env' };
    loadEnvFileIfPresent(envFilePath, env);

    assert.equal(env.BASIC, 'alpha');
    assert.equal(env.EXPORTED, 'beta');
    assert.equal(env.WITH_EQUALS, 'a=b=c');
    assert.equal(env.EMPTY_VALUE, '');
    assert.equal(env.DOUBLE_QUOTED, 'hello world');
    assert.equal(env.SINGLE_QUOTED, 'hello world');
    assert.equal(env.SPACED, ' keep inner spacing ');
    assert.equal(env.PRESET, 'from-env');
    assert.equal(env.NO_SEPARATOR, undefined);
  });
});

test('strip only surrounding matching quotes', () => {
  const env: NodeJS.ProcessEnv = {};

  applyEnvFileText(
    [
      'DOUBLE_OK="value"',
      "SINGLE_OK='value'",
      'UNMATCHED_START="value',
      "UNMATCHED_END=value'",
      "MISMATCHED='value\"",
      'EMPTY_DOUBLE=""',
      "EMPTY_SINGLE=''",
    ].join('\n'),
    env
  );

  assert.equal(env.DOUBLE_OK, 'value');
  assert.equal(env.SINGLE_OK, 'value');
  assert.equal(env.UNMATCHED_START, '"value');
  assert.equal(env.UNMATCHED_END, "value'");
  assert.equal(env.MISMATCHED, "'value\"");
  assert.equal(env.EMPTY_DOUBLE, '');
  assert.equal(env.EMPTY_SINGLE, '');
});
