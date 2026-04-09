#!/usr/bin/env node
/**
 * agent-uniqueness-audit.mjs
 *
 * Quick local overlap audit between your candidate agent and a comparison set.
 * This is NOT guaranteed to match validator internals, but helps reduce obvious
 * copycat risk by flagging high lexical overlap before upload.
 *
 * Usage:
 *   node scripts/agent-uniqueness-audit.mjs --target agent_v12.py
 *   node scripts/agent-uniqueness-audit.mjs --target agent_v12.py --reference-glob "analysis/numinous_top10/*.py"
 *   node scripts/agent-uniqueness-audit.mjs --target agent_v12.py --report analysis/agent_uniqueness_v12.json --json
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join, normalize } from 'path';

const DEFAULT_TARGET = 'agent_v12.py';
const DEFAULT_REFERENCE_GLOBS = [
  'analysis/numinous_top10/*.py',
  'analysis/numinous_top5/*.py',
  'repos-scan/numinous/neurons/miner/agents/*.py',
  'agent_v*.py',
];
const DEFAULT_NGRAM = 6;
const DEFAULT_ALERT = 0.62;

function parseArgs(argv) {
  const options = {
    target: process.env.TARGET || DEFAULT_TARGET,
    referenceGlobs: process.env.REFERENCE_GLOBS
      ? String(process.env.REFERENCE_GLOBS)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [...DEFAULT_REFERENCE_GLOBS],
    ngram: Number(process.env.NGRAM || DEFAULT_NGRAM),
    alertThreshold: Number(process.env.ALERT_THRESHOLD || DEFAULT_ALERT),
    topN: Number(process.env.TOP_N || 10),
    minJaccard: Number(process.env.MIN_JACCARD || 0),
    reportPath: process.env.REPORT_PATH || '',
    json: false,
  };
  let hasReferenceGlobsOverride = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target' || arg === '--candidate' || arg === '--agent') options.target = argv[++i];
    else if (arg === '--reference-glob' || arg === '--compare-glob') options.referenceGlobs.push(argv[++i]);
    else if (arg === '--reference-globs') {
      hasReferenceGlobsOverride = true;
      options.referenceGlobs = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    else if (arg === '--ngram') options.ngram = Number(argv[++i]);
    else if (arg === '--alert-threshold') options.alertThreshold = Number(argv[++i]);
    else if (arg === '--top-n') options.topN = Number(argv[++i]);
    else if (arg === '--min-jaccard') options.minJaccard = Number(argv[++i]);
    else if (arg === '--report') options.reportPath = String(argv[++i] || '').trim();
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.ngram) || options.ngram < 3) options.ngram = DEFAULT_NGRAM;
  if (!Number.isFinite(options.alertThreshold) || options.alertThreshold <= 0 || options.alertThreshold >= 1) {
    options.alertThreshold = DEFAULT_ALERT;
  }
  if (!Number.isFinite(options.topN) || options.topN < 1) options.topN = 10;
  if (!Number.isFinite(options.minJaccard) || options.minJaccard < 0 || options.minJaccard >= 1) options.minJaccard = 0;
  if (hasReferenceGlobsOverride && options.referenceGlobs.length === 0) {
    throw new Error('--reference-globs provided but empty.');
  }
  options.referenceGlobs = [...new Set(options.referenceGlobs.filter(Boolean))];
  if (options.referenceGlobs.length === 0) options.referenceGlobs = [...DEFAULT_REFERENCE_GLOBS];
  return options;
}

function printHelp() {
  console.log(`agent-uniqueness-audit.mjs

Local overlap audit for candidate Numinous agent code.

Options:
  --target <path>             Candidate agent file (default: agent_v12.py)
  --agent <path>              Alias of --target
  --reference-glob <glob>     Add comparison glob (repeatable)
  --reference-globs <csv>     Add comparison globs (comma-separated)
  --ngram <n>                 Token n-gram size (default: 6)
  --alert-threshold <0..1>    Red flag threshold (default: 0.62)
  --top-n <n>                 Number of top overlap rows to print (default: 10)
  --min-jaccard <0..1>        Filter printed rows below threshold (default: 0)
  --report <path>             Write JSON report to file
  --json                      Emit machine-readable JSON
  --help, -h                  Show this help
`);
}

function expandSimpleGlob(globPattern) {
  // Supports "dir/*.ext" style patterns used in our workflow.
  const normalized = normalize(globPattern).replace(/\\/g, '/');
  const starIdx = normalized.indexOf('*');
  if (starIdx < 0) return existsSync(normalized) ? [normalized] : [];
  const slashIdx = normalized.lastIndexOf('/', starIdx);
  const dir = slashIdx >= 0 ? normalized.slice(0, slashIdx) : '.';
  const pattern = normalized.slice(slashIdx + 1);
  if (!existsSync(dir)) return [];
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
  );
  return readdirSync(dir)
    .filter((name) => regex.test(name))
    .map((name) => join(dir, name))
    .filter((path) => extname(path) === '.py');
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function normalizeCode(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/#[^\n]*/g, ' ') // strip comments
    .replace(/"""[\s\S]*?"""/g, ' ') // strip docstrings
    .replace(/'''[\s\S]*?'''/g, ' ')
    .replace(/"[^"\n]{0,120}"/g, '"STR"')
    .replace(/'[^'\n]{0,120}'/g, "'STR'")
    .replace(/\b\d+(?:\.\d+)?\b/g, 'NUM')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenize(text) {
  return (text.match(/[a-z_][a-z0-9_]*/g) || []).filter(Boolean);
}

function ngrams(tokens, n) {
  const out = new Set();
  if (!tokens || tokens.length < n) return out;
  for (let i = 0; i <= tokens.length - n; i += 1) {
    out.add(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

function jaccardSet(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function grade(score, threshold) {
  if (score >= threshold) return 'RED';
  if (score >= threshold * 0.75) return 'YELLOW';
  return 'GREEN';
}

function isInternalVersionPath(path) {
  const p = String(path || '').replace(/\\/g, '/');
  return /^agent_v\d+\.py$/i.test(p);
}

function containmentRatio(targetNgrams, refNgrams) {
  if (targetNgrams.size === 0 || refNgrams.size === 0) return 0;
  let inter = 0;
  for (const x of targetNgrams) if (refNgrams.has(x)) inter += 1;
  return inter / targetNgrams.size;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.target)) {
    throw new Error(`Target file not found: ${options.target}`);
  }
  const compareFiles = [];
  for (const g of options.referenceGlobs) {
    for (const f of expandSimpleGlob(g)) {
      if (!compareFiles.includes(f)) compareFiles.push(f);
    }
  }
  const filteredCompareFiles = compareFiles.filter((p) => p !== options.target);
  if (filteredCompareFiles.length === 0) {
    throw new Error(`No comparison files found for globs: ${options.referenceGlobs.join(', ')}`);
  }

  const targetNorm = normalizeCode(readText(options.target));
  const targetTokens = tokenize(targetNorm);
  const targetNgrams = ngrams(targetTokens, options.ngram);

  const overlaps = [];
  for (const path of filteredCompareFiles) {
    const txt = normalizeCode(readText(path));
    const toks = tokenize(txt);
    const grams = ngrams(toks, options.ngram);
    const score = jaccardSet(targetNgrams, grams);
    const containment = containmentRatio(targetNgrams, grams);
    overlaps.push({
      path,
      file: basename(path),
      overlapScore: Number(score.toFixed(4)),
      containmentRatio: Number(containment.toFixed(4)),
      grade: grade(score, options.alertThreshold),
      isInternalVersion: isInternalVersionPath(path),
      compareTokenCount: toks.length,
      compareNgramCount: grams.size,
    });
  }

  overlaps.sort((a, b) => b.overlapScore - a.overlapScore || a.file.localeCompare(b.file));
  const top = overlaps[0];
  const externalRows = overlaps.filter((r) => !r.isInternalVersion);
  const externalTop = externalRows[0];
  const shown = overlaps.filter((r) => r.overlapScore >= options.minJaccard).slice(0, options.topN);
  const report = {
    ok: true,
    target: options.target,
    referenceGlobs: options.referenceGlobs,
    ngram: options.ngram,
    alertThreshold: options.alertThreshold,
    targetTokenCount: targetTokens.length,
    targetNgramCount: targetNgrams.size,
    compareFileCount: filteredCompareFiles.length,
    maxOverlapScore: top?.overlapScore ?? 0,
    maxOverlapFile: top?.file ?? null,
    maxOverlapGrade: top?.grade ?? 'GREEN',
    maxExternalOverlapScore: externalTop?.overlapScore ?? 0,
    maxExternalOverlapFile: externalTop?.file ?? null,
    maxExternalOverlapGrade: externalTop?.grade ?? 'GREEN',
    overlapsTop: shown,
  };

  if (options.reportPath) {
    mkdirSync(dirname(options.reportPath), { recursive: true });
    writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Target: ${report.target}`);
  console.log(`Reference globs: ${report.referenceGlobs.join(', ')}`);
  console.log(`Comparison files: ${report.compareFileCount}`);
  console.log(`N-gram size: ${report.ngram}`);
  console.log(`Alert threshold: ${report.alertThreshold}`);
  console.log(`Min jaccard shown: ${options.minJaccard}`);
  if (options.reportPath) console.log(`Report: ${options.reportPath}`);
  console.log('');
  console.log(`Max overlap: ${report.maxOverlapScore} (${report.maxOverlapGrade}) vs ${report.maxOverlapFile}`);
  console.log(
    `Max external overlap: ${report.maxExternalOverlapScore} (${report.maxExternalOverlapGrade}) vs ${report.maxExternalOverlapFile}`
  );
  console.log('');
  console.log('Top overlaps:');
  for (const row of report.overlapsTop) {
    console.log(
      `- ${row.path}: score=${row.overlapScore} containment=${row.containmentRatio} grade=${row.grade}` +
        (row.isInternalVersion ? ' [internal-version]' : '')
    );
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

