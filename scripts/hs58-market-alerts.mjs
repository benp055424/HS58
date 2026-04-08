#!/usr/bin/env node
/**
 * hs58-market-alerts.mjs
 *
 * Evaluate hs58-market-watch snapshots and emit alert-grade summary.
 *
 * Usage:
 *   node scripts/hs58-market-alerts.mjs
 *   node scripts/hs58-market-alerts.mjs --snapshot analysis/hs58_market_watch/latest.json
 *   node scripts/hs58-market-alerts.mjs --providers-delta-threshold 3 --skills-delta-threshold 2
 */

import { existsSync, readFileSync } from 'fs';

const DEFAULT_SNAPSHOT_PATH = 'analysis/hs58_market_watch/latest.json';

function parseArgs(argv) {
  const options = {
    snapshotPath: process.env.SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH,
    providersDeltaThreshold: Number(process.env.PROVIDERS_DELTA_THRESHOLD || 3),
    skillsDeltaThreshold: Number(process.env.SKILLS_DELTA_THRESHOLD || 2),
    homepageChangeIsRed: String(process.env.HOMEPAGE_CHANGE_IS_RED || 'true').toLowerCase() !== 'false',
    newProtocolThreshold: Number(process.env.NEW_PROTOCOL_THRESHOLD || 1),
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--snapshot') options.snapshotPath = argv[++i];
    else if (arg === '--providers-delta-threshold') options.providersDeltaThreshold = Number(argv[++i]);
    else if (arg === '--skills-delta-threshold') options.skillsDeltaThreshold = Number(argv[++i]);
    else if (arg === '--homepage-change-is-red') options.homepageChangeIsRed = String(argv[++i]).toLowerCase() !== 'false';
    else if (arg === '--new-protocol-threshold') options.newProtocolThreshold = Number(argv[++i]);
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.providersDeltaThreshold) || options.providersDeltaThreshold < 0) options.providersDeltaThreshold = 3;
  if (!Number.isFinite(options.skillsDeltaThreshold) || options.skillsDeltaThreshold < 0) options.skillsDeltaThreshold = 2;
  if (!Number.isFinite(options.newProtocolThreshold) || options.newProtocolThreshold < 0) options.newProtocolThreshold = 1;
  return options;
}

function printHelp() {
  console.log(`hs58-market-alerts.mjs

Evaluate latest HS58 market snapshot and emit RED/YELLOW/GREEN summary.

Options:
  --snapshot <path>                    Snapshot JSON path (default: analysis/hs58_market_watch/latest.json)
  --providers-delta-threshold <n>      RED threshold for provider-count delta (default: 3)
  --skills-delta-threshold <n>         RED threshold for skills-total delta (default: 2)
  --homepage-change-is-red <bool>      Treat homepage hash change as RED (default: true)
  --new-protocol-threshold <n>         YELLOW threshold for protocol-mix deltas (default: 1)
  --json                               Emit machine-readable JSON
  --help, -h                           Show this help
`);
}

function readSnapshot(path) {
  if (!existsSync(path)) {
    throw new Error(`Snapshot not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function abs(n) {
  return Math.abs(Number(n || 0));
}

function classify(snapshot, options) {
  const deltas = snapshot?.deltas || {};
  const providersDelta = Number(deltas.providersCountDelta || 0);
  const skillsDelta = Number(deltas.skillsTotalDelta || 0);
  const homepageChanged = Boolean(deltas.homepageChanged);
  const protocolCountsDelta = deltas.protocolCountsDelta || {};

  const findings = [];
  let color = 'GREEN';

  if (abs(providersDelta) >= options.providersDeltaThreshold) {
    color = 'RED';
    findings.push(`provider_count_delta=${providersDelta} (threshold=${options.providersDeltaThreshold})`);
  }

  if (abs(skillsDelta) >= options.skillsDeltaThreshold) {
    color = 'RED';
    findings.push(`skills_total_delta=${skillsDelta} (threshold=${options.skillsDeltaThreshold})`);
  }

  if (homepageChanged) {
    if (options.homepageChangeIsRed) {
      color = 'RED';
      findings.push('homepage_fingerprint_changed');
    } else if (color === 'GREEN') {
      color = 'YELLOW';
      findings.push('homepage_fingerprint_changed');
    }
  }

  const protocolDeltaMagnitude = Object.values(protocolCountsDelta).reduce(
    (sum, val) => sum + abs(val),
    0
  );
  if (protocolDeltaMagnitude >= options.newProtocolThreshold && color === 'GREEN') {
    color = 'YELLOW';
    findings.push(`protocol_mix_delta_magnitude=${protocolDeltaMagnitude}`);
  }

  if (findings.length === 0) {
    findings.push('no_material_change_detected');
  }

  return {
    generatedAt: snapshot?.generatedAt || null,
    snapshotPath: options.snapshotPath,
    color,
    findings,
    metrics: {
      providersCount: snapshot?.providers?.count ?? null,
      skillsTotal: snapshot?.skills?.total ?? null,
      providersCountDelta: providersDelta,
      skillsTotalDelta: skillsDelta,
      homepageChanged,
      protocolCountsDelta,
      tierCountsDelta: deltas.tierCountsDelta || {},
      categoryCountsDelta: deltas.categoryCountsDelta || {},
    },
  };
}

function toText(alert) {
  const lines = [];
  lines.push(`HS58 Market Alert: ${alert.color}`);
  lines.push(`Generated: ${alert.generatedAt || 'unknown'}`);
  lines.push(`Snapshot: ${alert.snapshotPath}`);
  lines.push('');
  lines.push('Findings:');
  for (const finding of alert.findings) {
    lines.push(`- ${finding}`);
  }
  lines.push('');
  lines.push('Metrics:');
  lines.push(`- providers_count: ${alert.metrics.providersCount}`);
  lines.push(`- skills_total: ${alert.metrics.skillsTotal}`);
  lines.push(`- providers_count_delta: ${alert.metrics.providersCountDelta}`);
  lines.push(`- skills_total_delta: ${alert.metrics.skillsTotalDelta}`);
  lines.push(`- homepage_changed: ${alert.metrics.homepageChanged}`);
  lines.push(`- protocol_delta: ${JSON.stringify(alert.metrics.protocolCountsDelta)}`);
  lines.push(`- tier_delta: ${JSON.stringify(alert.metrics.tierCountsDelta)}`);
  lines.push(`- category_delta: ${JSON.stringify(alert.metrics.categoryCountsDelta)}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = readSnapshot(options.snapshotPath);
  const alert = classify(snapshot, options);
  if (options.json) {
    console.log(JSON.stringify(alert, null, 2));
    return;
  }
  process.stdout.write(toText(alert));
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

