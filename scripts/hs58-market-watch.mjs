#!/usr/bin/env node
/**
 * hs58-market-watch.mjs
 *
 * Track live Handshake58 marketplace state over time.
 * Captures:
 * - provider counts/protocol/tier/category distributions
 * - skills totals + top page metrics
 * - homepage docs fingerprint drift
 * - deltas vs previous snapshot
 *
 * Usage:
 *   node scripts/hs58-market-watch.mjs
 *   node scripts/hs58-market-watch.mjs --marketplace-url https://handshake58.com
 *   node scripts/hs58-market-watch.mjs --out-dir analysis/hs58_market_watch
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_MARKETPLACE_URL = 'https://handshake58.com';
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_OUT_DIR = 'analysis/hs58_market_watch';

function parseArgs(argv) {
  const options = {
    marketplaceUrl: process.env.MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL,
    timeoutMs: Number(process.env.TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    outDir: process.env.OUT_DIR || DEFAULT_OUT_DIR,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--marketplace-url') options.marketplaceUrl = argv[++i];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--out-dir') options.outDir = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    options.timeoutMs = DEFAULT_TIMEOUT_MS;
  }
  return options;
}

function printHelp() {
  console.log(`hs58-market-watch.mjs

Track Handshake58 marketplace changes and write timestamped snapshots.

Options:
  --marketplace-url <url>  Base URL (default: https://handshake58.com)
  --timeout-ms <n>         Request timeout (default: 12000)
  --out-dir <path>         Output directory (default: analysis/hs58_market_watch)
  --help, -h               Show this help
`);
}

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function nowIso() {
  return new Date().toISOString();
}

function shortDateStamp(iso) {
  return iso.replace(/[:.]/g, '-');
}

function hashText(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function counter(rows, keyFn) {
  const map = {};
  for (const row of rows || []) {
    const key = keyFn(row) || 'unknown';
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

function sortObjectByValueDesc(obj) {
  return Object.fromEntries(
    Object.entries(obj || {}).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
  );
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs) {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text);
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

function diffNumeric(prevValue, curValue) {
  const a = Number(prevValue || 0);
  const b = Number(curValue || 0);
  return b - a;
}

function diffMap(prevMap, curMap) {
  const keys = new Set([
    ...Object.keys(prevMap || {}),
    ...Object.keys(curMap || {}),
  ]);
  const diff = {};
  for (const key of keys) {
    const d = diffNumeric(prevMap?.[key], curMap?.[key]);
    if (d !== 0) diff[key] = d;
  }
  return sortObjectByValueDesc(diff);
}

function topSkillsByView(skills, limit = 5) {
  return [...(skills || [])]
    .sort((a, b) => {
      const vb = Number(b?.viewCount || 0);
      const va = Number(a?.viewCount || 0);
      if (vb !== va) return vb - va;
      return String(a?.slug || '').localeCompare(String(b?.slug || ''));
    })
    .slice(0, limit)
    .map((s) => ({
      slug: s.slug,
      viewCount: Number(s.viewCount || 0),
      worksCount: Number(s.worksCount || 0),
      costEstimate: Number(s.costEstimate || 0),
      health: s.health || 'unknown',
    }));
}

function summarizeProviders(providerPayload) {
  const providers = providerPayload?.providers || [];
  return {
    count: Number(providerPayload?.count || providers.length || 0),
    totalBeforeProfileFilter: Number(providerPayload?.totalBeforeProfileFilter || 0),
    timestamp: providerPayload?.timestamp || null,
    protocolCounts: sortObjectByValueDesc(counter(providers, (p) => p?.protocol || 'unknown')),
    tierCounts: sortObjectByValueDesc(counter(providers, (p) => p?.tier || 'unknown')),
    categoryCounts: sortObjectByValueDesc(counter(providers, (p) => p?.category || 'unknown')),
    onlineCount: providers.filter((p) => p?.status?.online === true).length,
    providersWithModels: providers.filter((p) => Array.isArray(p?.models) && p.models.length > 0).length,
  };
}

function summarizeSkills(skillPayload) {
  const skills = skillPayload?.skills || [];
  return {
    total: Number(skillPayload?.total || 0),
    pageCount: Number(skillPayload?.count || skills.length || 0),
    page: Number(skillPayload?.page || 1),
    pages: Number(skillPayload?.pages || 1),
    zeroWorksOnPage: skills.filter((s) => Number(s?.worksCount || 0) === 0).length,
    healthyOnPage: skills.filter((s) => s?.health === 'healthy').length,
    topByViewOnPage: topSkillsByView(skills, 5),
  };
}

function makeMarkdown(snapshot, previousSnapshot) {
  const lines = [];
  lines.push(`# HS58 Market Watch Snapshot`);
  lines.push('');
  lines.push(`- Generated: ${snapshot.generatedAt}`);
  lines.push(`- Marketplace: ${snapshot.marketplaceUrl}`);
  lines.push('');
  lines.push(`## Providers`);
  lines.push(`- Count: **${snapshot.providers.count}**`);
  lines.push(`- Online: **${snapshot.providers.onlineCount}**`);
  lines.push(`- With models: **${snapshot.providers.providersWithModels}**`);
  lines.push(`- Protocol mix: \`${JSON.stringify(snapshot.providers.protocolCounts)}\``);
  lines.push(`- Tier mix: \`${JSON.stringify(snapshot.providers.tierCounts)}\``);
  lines.push('');
  lines.push(`## Skills`);
  lines.push(`- Published total: **${snapshot.skills.total}**`);
  lines.push(`- Page ${snapshot.skills.page}/${snapshot.skills.pages} count: **${snapshot.skills.pageCount}**`);
  lines.push(`- Zero works on sampled page: **${snapshot.skills.zeroWorksOnPage}**`);
  lines.push(`- Healthy on sampled page: **${snapshot.skills.healthyOnPage}**`);
  lines.push('');
  lines.push(`### Top viewed skills on sampled page`);
  lines.push(`| slug | views | works | cost | health |`);
  lines.push(`|---|---:|---:|---:|---|`);
  for (const skill of snapshot.skills.topByViewOnPage) {
    lines.push(`| ${skill.slug} | ${skill.viewCount} | ${skill.worksCount} | ${skill.costEstimate} | ${skill.health} |`);
  }
  lines.push('');
  lines.push(`## Homepage fingerprint`);
  lines.push(`- Content SHA256: \`${snapshot.homepage.hash}\``);
  lines.push(`- Length: ${snapshot.homepage.length} chars`);
  lines.push('');

  if (previousSnapshot) {
    lines.push(`## Delta vs previous snapshot`);
    lines.push(`- Provider count delta: **${snapshot.deltas.providersCountDelta >= 0 ? '+' : ''}${snapshot.deltas.providersCountDelta}**`);
    lines.push(`- Skills total delta: **${snapshot.deltas.skillsTotalDelta >= 0 ? '+' : ''}${snapshot.deltas.skillsTotalDelta}**`);
    lines.push(`- Homepage changed: **${snapshot.deltas.homepageChanged ? 'yes' : 'no'}**`);
    lines.push(`- Protocol deltas: \`${JSON.stringify(snapshot.deltas.protocolCountsDelta)}\``);
    lines.push(`- Tier deltas: \`${JSON.stringify(snapshot.deltas.tierCountsDelta)}\``);
    lines.push(`- Category deltas: \`${JSON.stringify(snapshot.deltas.categoryCountsDelta)}\``);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const marketplace = trimSlash(options.marketplaceUrl);
  const generatedAt = nowIso();

  const providersUrl = `${marketplace}/api/mcp/providers`;
  const skillsUrl = `${marketplace}/api/skills?status=published`;
  const homepageUrl = `${marketplace}/`;

  const [providerPayload, skillPayload, homepageText] = await Promise.all([
    fetchJson(providersUrl, options.timeoutMs),
    fetchJson(skillsUrl, options.timeoutMs),
    fetchText(homepageUrl, options.timeoutMs),
  ]);

  const providers = summarizeProviders(providerPayload);
  const skills = summarizeSkills(skillPayload);
  const homepage = {
    hash: hashText(homepageText),
    length: homepageText.length,
  };

  const outDir = options.outDir;
  ensureDir(outDir);

  const prevPath = latestSnapshotPath(outDir);
  const previous = prevPath ? parseJsonFile(prevPath) : null;

  const deltas = previous
    ? {
        providersCountDelta: diffNumeric(previous.providers?.count, providers.count),
        skillsTotalDelta: diffNumeric(previous.skills?.total, skills.total),
        homepageChanged: previous.homepage?.hash !== homepage.hash,
        protocolCountsDelta: diffMap(previous.providers?.protocolCounts || {}, providers.protocolCounts),
        tierCountsDelta: diffMap(previous.providers?.tierCounts || {}, providers.tierCounts),
        categoryCountsDelta: diffMap(previous.providers?.categoryCounts || {}, providers.categoryCounts),
      }
    : {
        providersCountDelta: 0,
        skillsTotalDelta: 0,
        homepageChanged: false,
        protocolCountsDelta: {},
        tierCountsDelta: {},
        categoryCountsDelta: {},
      };

  const snapshot = {
    generatedAt,
    marketplaceUrl: marketplace,
    endpoints: { providersUrl, skillsUrl, homepageUrl },
    providers,
    skills,
    homepage,
    deltas,
    previousSnapshot: prevPath ? prevPath : null,
  };

  const stamp = shortDateStamp(generatedAt);
  const jsonPath = join(outDir, `snapshot-${stamp}.json`);
  const latestJsonPath = join(outDir, 'latest.json');
  const latestMdPath = join(outDir, 'latest.md');

  writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  writeFileSync(latestJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  writeFileSync(latestMdPath, makeMarkdown(snapshot, previous), 'utf8');

  console.log(JSON.stringify({
    ok: true,
    generatedAt,
    outDir,
    jsonPath,
    latestJsonPath,
    latestMdPath,
    providersCount: providers.count,
    skillsTotal: skills.total,
    providersCountDelta: deltas.providersCountDelta,
    skillsTotalDelta: deltas.skillsTotalDelta,
    homepageChanged: deltas.homepageChanged,
  }));
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

