#!/usr/bin/env node
/**
 * numinous-policy-watch.mjs
 *
 * Track Numinous policy/scoring drift over time with focus on:
 * - code similarity / copycat enforcement language
 * - reasoning scoring layer updates
 * - scoring mechanism changes in docs/changelog/PR feed
 *
 * Usage:
 *   node scripts/numinous-policy-watch.mjs
 *   node scripts/numinous-policy-watch.mjs --repo numinouslabs/numinous
 *   node scripts/numinous-policy-watch.mjs --keywords "similarity,copycat,plagiarism,reasoning,brier"
 *   node scripts/numinous-policy-watch.mjs --out-dir analysis/numinous_policy_watch
 *   node scripts/numinous-policy-watch.mjs --json
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_REPO = 'numinouslabs/numinous';
const DEFAULT_BRANCH = 'main';
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_OUT_DIR = 'analysis/numinous_policy_watch';
const DEFAULT_MAX_PULLS = 30;
const DEFAULT_KEYWORDS = [
  'similarity',
  'copycat',
  'copied',
  'plagiarism',
  'reasoning',
  'scoring layer',
  'llm as judge',
  'evidence quality',
  'analytical rigor',
  'event specificity',
  'information breadth',
  'brier',
  'supervisor prior',
];

function parseArgs(argv) {
  const opts = {
    repo: process.env.NUMINOUS_REPO || DEFAULT_REPO,
    branch: process.env.NUMINOUS_BRANCH || DEFAULT_BRANCH,
    timeoutMs: Number(process.env.TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    outDir: process.env.OUT_DIR || DEFAULT_OUT_DIR,
    maxPulls: Number(process.env.MAX_PULLS || DEFAULT_MAX_PULLS),
    keywords: [...DEFAULT_KEYWORDS],
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') opts.repo = String(argv[++i] || '').trim();
    else if (arg === '--branch') opts.branch = String(argv[++i] || '').trim();
    else if (arg === '--timeout-ms') opts.timeoutMs = Number(argv[++i]);
    else if (arg === '--out-dir') opts.outDir = String(argv[++i] || '').trim();
    else if (arg === '--max-pulls') opts.maxPulls = Number(argv[++i]);
    else if (arg === '--keywords') {
      opts.keywords = String(argv[++i] || '')
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) opts.timeoutMs = DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(opts.maxPulls) || opts.maxPulls < 1 || opts.maxPulls > 100) opts.maxPulls = DEFAULT_MAX_PULLS;
  if (!opts.repo.includes('/')) throw new Error(`Invalid --repo "${opts.repo}". Expected owner/repo.`);
  if (!opts.branch) opts.branch = DEFAULT_BRANCH;
  if (!opts.outDir) opts.outDir = DEFAULT_OUT_DIR;
  if (!Array.isArray(opts.keywords) || opts.keywords.length === 0) opts.keywords = [...DEFAULT_KEYWORDS];
  return opts;
}

function printHelp() {
  console.log(`numinous-policy-watch.mjs

Track Numinous scoring/similarity policy changes over time.

Options:
  --repo <owner/repo>      GitHub repo (default: numinouslabs/numinous)
  --branch <name>          Branch for docs/changelog fetch (default: main)
  --timeout-ms <n>         HTTP timeout in ms (default: 12000)
  --max-pulls <n>          Number of recent PRs to inspect (default: 30, max: 100)
  --keywords <csv>         Keyword list (default includes similarity/plagiarism/reasoning terms)
  --out-dir <path>         Snapshot output dir (default: analysis/numinous_policy_watch)
  --json                   Emit machine-readable JSON summary
  --help, -h               Show this help
`);
}

function nowIso() {
  return new Date().toISOString();
}

function stamp(iso) {
  return iso.replace(/[:.]/g, '-');
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function latestSnapshotPath(outDir) {
  if (!existsSync(outDir)) return null;
  const files = readdirSync(outDir)
    .filter((f) => /^snapshot-\d{4}-\d{2}-\d{2}T.*\.json$/.test(f))
    .sort();
  if (files.length === 0) return null;
  return join(outDir, files[files.length - 1]);
}

function parseJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function fetchText(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs, headers = {}) {
  const text = await fetchText(url, timeoutMs, headers);
  return JSON.parse(text);
}

function normalizeLines(text) {
  return String(text || '')
    .split('\n')
    .map((line, idx) => ({ lineNo: idx + 1, text: line }));
}

function extractKeywordHits(text, keywords, maxHits = 40) {
  const lines = normalizeLines(text);
  const hits = [];
  for (const row of lines) {
    const lc = row.text.toLowerCase();
    const matched = keywords.filter((kw) => lc.includes(kw));
    if (matched.length === 0) continue;
    hits.push({
      lineNo: row.lineNo,
      keywords: matched,
      snippet: row.text.trim().slice(0, 280),
    });
    if (hits.length >= maxHits) break;
  }
  return hits;
}

function summarizeDoc(name, url, text, keywords, error = null) {
  if (error) {
    return {
      name,
      url,
      ok: false,
      error,
      hash: null,
      length: 0,
      keywordHits: [],
      counts: {},
    };
  }
  const keywordHits = extractKeywordHits(text, keywords);
  const counts = {};
  for (const kw of keywords) counts[kw] = 0;
  for (const hit of keywordHits) {
    for (const kw of hit.keywords) counts[kw] = (counts[kw] || 0) + 1;
  }
  return {
    name,
    url,
    ok: true,
    error: null,
    hash: sha256(text),
    length: String(text || '').length,
    keywordHits,
    counts,
  };
}

function summarizePulls(repo, pulls, keywords) {
  const hits = [];
  const normalizedKeywords = keywords.map((k) => k.toLowerCase());
  for (const pr of pulls || []) {
    const title = String(pr.title || '');
    const body = String(pr.body || '');
    const mergedText = `${title}\n${body}`.toLowerCase();
    const matched = normalizedKeywords.filter((kw) => mergedText.includes(kw));
    if (matched.length === 0) continue;
    hits.push({
      number: pr.number,
      state: pr.state,
      title: title.slice(0, 220),
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at || null,
      htmlUrl: pr.html_url,
      keywords: matched,
    });
  }
  return {
    repo,
    inspectedCount: pulls?.length || 0,
    hitCount: hits.length,
    hits: hits.slice(0, 30),
  };
}

function diffDocHashes(prevDocs, curDocs) {
  const prev = Object.fromEntries((prevDocs || []).map((d) => [d.name, d.hash || null]));
  const cur = Object.fromEntries((curDocs || []).map((d) => [d.name, d.hash || null]));
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur)]);
  const out = {};
  for (const key of keys) {
    out[key] = prev[key] !== cur[key];
  }
  return out;
}

function diffPullHitIds(prevPulls, curPulls) {
  const prev = new Set((prevPulls?.hits || []).map((h) => Number(h.number)));
  const cur = new Set((curPulls?.hits || []).map((h) => Number(h.number)));
  const added = [];
  const removed = [];
  for (const id of cur) if (!prev.has(id)) added.push(id);
  for (const id of prev) if (!cur.has(id)) removed.push(id);
  return { added: added.sort((a, b) => a - b), removed: removed.sort((a, b) => a - b) };
}

function grade(snapshot) {
  const docChangedCount = Object.values(snapshot.deltas.docHashChanged || {}).filter(Boolean).length;
  const newPolicyPRHits = (snapshot.deltas.pullHitDelta?.added || []).length;
  const keywordHitTotal = snapshot.docs.reduce((acc, d) => acc + (d.keywordHits?.length || 0), 0);
  const hasSimilarityLanguage = snapshot.docs.some((d) =>
    (d.keywordHits || []).some((h) =>
      h.keywords.some((k) => ['similarity', 'copycat', 'copied', 'plagiarism'].includes(k))
    )
  );

  if (newPolicyPRHits >= 1 || (docChangedCount >= 2 && hasSimilarityLanguage)) return 'RED';
  if (docChangedCount >= 1 || keywordHitTotal >= 5) return 'YELLOW';
  return 'GREEN';
}

function makeMarkdown(snapshot) {
  const lines = [];
  lines.push('# Numinous Policy Watch Snapshot');
  lines.push('');
  lines.push(`- Generated: ${snapshot.generatedAt}`);
  lines.push(`- Repo: ${snapshot.repo}@${snapshot.branch}`);
  lines.push(`- Alert grade: **${snapshot.alertGrade}**`);
  lines.push('');
  lines.push('## Document status');
  for (const doc of snapshot.docs) {
    lines.push(`- ${doc.name}: ${doc.ok ? 'ok' : `error (${doc.error})`}`);
    if (doc.ok) {
      lines.push(`  - hash: \`${doc.hash}\``);
      lines.push(`  - keyword hits: ${doc.keywordHits.length}`);
    }
  }
  lines.push('');
  lines.push('## PR keyword hits');
  lines.push(`- inspected: ${snapshot.pullSummary.inspectedCount}`);
  lines.push(`- matching hits: ${snapshot.pullSummary.hitCount}`);
  for (const hit of snapshot.pullSummary.hits.slice(0, 10)) {
    lines.push(`  - #${hit.number} [${hit.state}] ${hit.title} | keywords=${hit.keywords.join(',')}`);
  }
  lines.push('');
  lines.push('## Delta vs previous snapshot');
  lines.push(`- doc hash changed: \`${JSON.stringify(snapshot.deltas.docHashChanged)}\``);
  lines.push(`- new PR hit IDs: \`${JSON.stringify(snapshot.deltas.pullHitDelta.added)}\``);
  lines.push(`- removed PR hit IDs: \`${JSON.stringify(snapshot.deltas.pullHitDelta.removed)}\``);
  lines.push('');
  lines.push('## Action');
  if (snapshot.alertGrade === 'RED') {
    lines.push('- Review updated docs/PRs immediately before next upload.');
  } else if (snapshot.alertGrade === 'YELLOW') {
    lines.push('- Review changes within 24h and refresh agent uniqueness audit.');
  } else {
    lines.push('- No material policy drift detected.');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const generatedAt = nowIso();
  const [owner, repoName] = opts.repo.split('/');

  const docs = [
    {
      name: 'changelog',
      url: `https://raw.githubusercontent.com/${opts.repo}/${opts.branch}/CHANGELOG.md`,
    },
    {
      name: 'subnet-rules',
      url: `https://raw.githubusercontent.com/${opts.repo}/${opts.branch}/docs/subnet-rules.md`,
    },
    {
      name: 'gateway-guide',
      url: `https://raw.githubusercontent.com/${opts.repo}/${opts.branch}/docs/gateway-guide.md`,
    },
    {
      name: 'scoring-system',
      url: `https://raw.githubusercontent.com/${opts.repo}/${opts.branch}/docs/scoring-system.md`,
    },
  ];

  const docSummaries = [];
  for (const doc of docs) {
    try {
      const text = await fetchText(doc.url, opts.timeoutMs, { 'user-agent': 'policy-watch-script' });
      docSummaries.push(summarizeDoc(doc.name, doc.url, text, opts.keywords));
    } catch (error) {
      docSummaries.push(summarizeDoc(doc.name, doc.url, '', opts.keywords, String(error.message || error)));
    }
  }

  let pullSummary;
  try {
    const pullsUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls?state=all&per_page=${opts.maxPulls}&sort=updated&direction=desc`;
    const pulls = await fetchJson(pullsUrl, opts.timeoutMs, {
      accept: 'application/vnd.github+json',
      'user-agent': 'policy-watch-script',
    });
    pullSummary = summarizePulls(opts.repo, pulls, opts.keywords);
  } catch (error) {
    pullSummary = {
      repo: opts.repo,
      inspectedCount: 0,
      hitCount: 0,
      hits: [],
      error: String(error.message || error),
    };
  }

  ensureDir(opts.outDir);
  const prevPath = latestSnapshotPath(opts.outDir);
  const previous = prevPath ? parseJsonFile(prevPath) : null;

  const snapshot = {
    generatedAt,
    repo: opts.repo,
    branch: opts.branch,
    keywords: opts.keywords,
    docs: docSummaries,
    pullSummary,
    deltas: previous
      ? {
          docHashChanged: diffDocHashes(previous.docs || [], docSummaries),
          pullHitDelta: diffPullHitIds(previous.pullSummary || {}, pullSummary),
        }
      : {
          docHashChanged: Object.fromEntries(docSummaries.map((d) => [d.name, false])),
          pullHitDelta: { added: [], removed: [] },
        },
    previousSnapshot: prevPath || null,
  };
  snapshot.alertGrade = grade(snapshot);

  const snapshotName = `snapshot-${stamp(generatedAt)}.json`;
  const snapshotPath = join(opts.outDir, snapshotName);
  const latestJsonPath = join(opts.outDir, 'latest.json');
  const latestMdPath = join(opts.outDir, 'latest.md');

  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  writeFileSync(latestJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  writeFileSync(latestMdPath, makeMarkdown(snapshot), 'utf8');

  const summary = {
    ok: true,
    generatedAt,
    repo: opts.repo,
    alertGrade: snapshot.alertGrade,
    docsOk: snapshot.docs.filter((d) => d.ok).length,
    docsTotal: snapshot.docs.length,
    prHits: snapshot.pullSummary.hitCount,
    snapshotPath,
    latestJsonPath,
    latestMdPath,
  };
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

