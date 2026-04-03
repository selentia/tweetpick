import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const summaryPath = path.join(repoRoot, 'coverage', 'coverage-summary.json');
const outputPath = path.join(repoRoot, 'badges', 'coverage.json');

function toCoverageColor(percent) {
  if (percent >= 95) {
    return 'brightgreen';
  }
  if (percent >= 90) {
    return 'green';
  }
  if (percent >= 80) {
    return 'yellowgreen';
  }
  if (percent >= 70) {
    return 'yellow';
  }
  if (percent >= 60) {
    return 'orange';
  }
  return 'red';
}

function readLinesCoveragePercent(summary) {
  const percent = Number(summary?.total?.lines?.pct);
  if (!Number.isFinite(percent)) {
    throw new Error('coverage-summary.json is missing total.lines.pct.');
  }
  return percent;
}

async function updateCoverageBadge() {
  const raw = await readFile(summaryPath, 'utf8');
  const summary = JSON.parse(raw);
  const percent = readLinesCoveragePercent(summary);
  const rounded = Math.round(percent * 100) / 100;
  const message = `${rounded.toFixed(2)}%`;
  const color = toCoverageColor(rounded);

  const badge = {
    schemaVersion: 1,
    label: 'coverage',
    message,
    color,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(badge, null, 2)}\n`, 'utf8');
  console.log(`[coverage-badge] Updated ${outputPath} (${message})`);
}

try {
  await updateCoverageBadge();
} catch (error) {
  console.error(error);
  process.exit(1);
}
