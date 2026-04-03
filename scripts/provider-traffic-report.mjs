#!/usr/bin/env node
/**
 * provider-traffic-report.mjs
 *
 * Rank HS58 providers by paid traffic using /v1/admin/stats.
 *
 * Usage:
 *   node scripts/provider-traffic-report.mjs
 *   node scripts/provider-traffic-report.mjs --provider-url https://foo.up.railway.app
 *   node scripts/provider-traffic-report.mjs --providers-file providers.txt
 *
 * Optional env:
 *   ADMIN_PASSWORD=...  (used for Authorization: Bearer ...)
 */

import { readFileSync, writeFileSync } from 'fs';

const DEFAULT_MARKETPLACE_URL = 'https://handshake58.com';
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TOP = 50;
const DEFAULT_WATCH_SECONDS = 60;

function parseArgs(argv) {
  const options = {
    marketplaceUrl: process.env.MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL,
    timeoutMs: Number(process.env.TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    concurrency: Number(process.env.CONCURRENCY || DEFAULT_CONCURRENCY),
    top: Number(process.env.TOP || DEFAULT_TOP),
    adminPassword: process.env.ADMIN_PASSWORD || '',
    includeVouchers: true,
    onlyTraffic: false,
    json: false,
    format: 'table',
    outputPath: '',
    detectAuth: false,
    watchSeconds: Number(process.env.WATCH_SECONDS || 0),
    providerUrls: [],
    providersFile: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--marketplace-url') options.marketplaceUrl = argv[++i];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--concurrency') options.concurrency = Number(argv[++i]);
    else if (arg === '--top') options.top = Number(argv[++i]);
    else if (arg === '--admin-password') options.adminPassword = argv[++i];
    else if (arg === '--provider-url') options.providerUrls.push(argv[++i]);
    else if (arg === '--providers-file') options.providersFile = argv[++i];
    else if (arg === '--no-vouchers') options.includeVouchers = false;
    else if (arg === '--only-traffic') options.onlyTraffic = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--format') options.format = String(argv[++i] || '').toLowerCase();
    else if (arg === '--output') options.outputPath = argv[++i];
    else if (arg === '--detect-auth') options.detectAuth = true;
    else if (arg === '--watch') options.watchSeconds = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) options.timeoutMs = DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(options.concurrency) || options.concurrency <= 0) options.concurrency = DEFAULT_CONCURRENCY;
  if (!Number.isFinite(options.top) || options.top <= 0) options.top = DEFAULT_TOP;
  if (!Number.isFinite(options.watchSeconds) || options.watchSeconds < 0) options.watchSeconds = 0;
  if (options.json) options.format = 'json';
  if (!['table', 'json', 'csv', 'markdown'].includes(options.format)) options.format = 'table';
  return options;
}

function printHelp() {
  console.log(`provider-traffic-report.mjs

Rank providers by paid traffic using /v1/admin/stats.

Options:
  --marketplace-url <url>   Marketplace base URL (default: https://handshake58.com)
  --provider-url <url>      Check one provider URL (repeatable)
  --providers-file <path>   Newline-delimited provider URLs
  --admin-password <value>  Bearer token for /v1/admin/*
  --timeout-ms <n>          HTTP timeout per request (default: 12000)
  --concurrency <n>         Parallel checks (default: 8)
  --top <n>                 Max rows to print (default: 50)
  --watch <seconds>         Refresh report continuously (default interval: 60)
  --detect-auth             Probe /v1/admin/stats auth mode (open/auth_required/unreachable)
  --format <type>           Output format: table | json | csv | markdown
  --output <path>           Save output to file (overwrites each run/refresh)
  --no-vouchers             Skip /v1/admin/vouchers lookup
  --only-traffic            Show only providers with paid traffic
  --json                    Output machine-readable JSON
  --help, -h                Show this help
`);
}

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function toBigInt(value, fallback = 0n) {
  try {
    if (value === undefined || value === null || value === '') return fallback;
    return BigInt(String(value));
  } catch {
    return fallback;
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatUsdc(raw) {
  const neg = raw < 0n;
  const val = neg ? -raw : raw;
  const whole = val / 1_000_000n;
  const frac = (val % 1_000_000n).toString().padStart(6, '0');
  return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
}

function short(text, max = 36) {
  const s = String(text || '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function parseHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, { timeoutMs, headers = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (error) {
    return { ok: false, status: 0, json: null, text: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function loadMarketplaceProviders(options) {
  const endpoint = `${trimSlash(options.marketplaceUrl)}/api/directory/providers?format=json`;
  const response = await fetchJson(endpoint, { timeoutMs: options.timeoutMs });
  if (!response.ok || !response.json) {
    throw new Error(`Failed to fetch marketplace providers (${response.status}): ${response.text?.slice(0, 200) || 'unknown error'}`);
  }
  const raw = Array.isArray(response.json) ? response.json : (response.json.providers || []);
  return raw
    .map((p) => ({
      name: p.name || '',
      apiUrl: trimSlash(p.apiUrl || ''),
      providerAddress: p.providerAddress || '',
      isOnline: p.isOnline,
      inferenceOnline: p.inferenceOnline,
    }))
    .filter((p) => !!p.apiUrl);
}

function loadProviderUrlsFromFile(path) {
  const content = readFileSync(path, 'utf8');
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(trimSlash);
}

function buildProviderList(options) {
  const byUrl = new Map();
  for (const url of options.providerUrls.map(trimSlash)) {
    if (!url) continue;
    byUrl.set(url, {
      name: parseHost(url),
      apiUrl: url,
      providerAddress: '',
      isOnline: undefined,
      inferenceOnline: undefined,
    });
  }
  if (options.providersFile) {
    for (const url of loadProviderUrlsFromFile(options.providersFile)) {
      byUrl.set(url, {
        name: parseHost(url),
        apiUrl: url,
        providerAddress: '',
        isOnline: undefined,
        inferenceOnline: undefined,
      });
    }
  }
  return [...byUrl.values()];
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = index;
      index += 1;
      if (i >= items.length) break;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchProviderTrafficRow(provider, options) {
  const base = trimSlash(provider.apiUrl);
  const statsUrl = `${base}/v1/admin/stats`;
  let unauthRes = null;
  if (options.detectAuth || !options.adminPassword) {
    unauthRes = await fetchJson(statsUrl, { timeoutMs: options.timeoutMs, headers: {} });
  }

  let authMode = 'undetermined';
  if (options.detectAuth) {
    if (unauthRes?.ok) authMode = 'open';
    else if (unauthRes?.status === 401 || unauthRes?.status === 403) authMode = 'auth_required';
    else authMode = 'unreachable';
  }

  const headers = {};
  if (options.adminPassword) headers.Authorization = `Bearer ${options.adminPassword}`;

  const statsRes = options.adminPassword
    ? await fetchJson(statsUrl, { timeoutMs: options.timeoutMs, headers })
    : (unauthRes || await fetchJson(statsUrl, { timeoutMs: options.timeoutMs, headers: {} }));

  const row = {
    name: provider.name || parseHost(base),
    url: base,
    host: parseHost(base),
    providerAddress: provider.providerAddress || '',
    marketplaceOnline: provider.isOnline,
    marketplaceInferenceOnline: provider.inferenceOnline,
    statsStatus: statsRes.status,
    statsOk: statsRes.ok,
    authMode,
    trafficStatus: 'unknown',
    totalVouchers: 0,
    unclaimedVouchers: 0,
    activeChannels: 0,
    totalEarnedRaw: '0',
    totalEarnedUsdc: '0.000000',
    lastVoucherAt: '',
    error: '',
  };

  if (!statsRes.ok || !statsRes.json) {
    row.error = statsRes.status === 401
      ? 'admin_auth_required'
      : `stats_error_${statsRes.status || 'network'}`;
    row.trafficStatus = 'unreadable';
    return row;
  }

  row.name = statsRes.json.providerName || row.name;
  row.providerAddress = statsRes.json.provider || row.providerAddress;
  row.totalVouchers = toNumber(statsRes.json.totalVouchers, 0);
  row.unclaimedVouchers = toNumber(statsRes.json.unclaimedVouchers, 0);
  row.activeChannels = toNumber(statsRes.json.activeChannels, 0);
  const earned = toBigInt(statsRes.json.totalEarned, 0n);
  row.totalEarnedRaw = earned.toString();
  row.totalEarnedUsdc = formatUsdc(earned);

  if (options.includeVouchers) {
    const vouchersUrl = `${base}/v1/admin/vouchers`;
    const vouchersRes = await fetchJson(vouchersUrl, { timeoutMs: options.timeoutMs, headers });
    if (vouchersRes.ok && vouchersRes.json && Array.isArray(vouchersRes.json.vouchers) && vouchersRes.json.vouchers.length > 0) {
      const latest = vouchersRes.json.vouchers
        .map((v) => Date.parse(v.receivedAt))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a)[0];
      if (latest) row.lastVoucherAt = new Date(latest).toISOString();
    }
  }

  const hasTraffic = row.totalVouchers > 0 || row.activeChannels > 0 || row.unclaimedVouchers > 0 || earned > 0n;
  row.trafficStatus = hasTraffic ? 'traffic' : 'no_traffic_yet';
  return row;
}

function makeTableText(summary, rows, options) {
  const lines = [];
  lines.push(`HS58 Provider Traffic Report @ ${summary.generatedAt}`);
  if (options.watchSeconds > 0) {
    const interval = options.watchSeconds > 0 ? options.watchSeconds : DEFAULT_WATCH_SECONDS;
    lines.push(`Iteration: ${summary.iteration} | Next refresh in ${interval}s`);
  }
  lines.push(`Checked: ${summary.checked} | Readable: ${summary.readable} | With traffic: ${summary.withTraffic} | Unreadable: ${summary.unreadable}`);
  lines.push('');

  const header = [
    'Rank'.padEnd(4),
    'Provider'.padEnd(28),
    'Vouchers'.padStart(8),
    'Active'.padStart(6),
    'Uncl'.padStart(5),
    'Earned USDC'.padStart(13),
    'Auth'.padEnd(13),
    'Status'.padEnd(14),
    'Host',
  ].join('  ');
  lines.push(header);
  lines.push('-'.repeat(Math.max(114, header.length)));

  rows.slice(0, options.top).forEach((r, idx) => {
    const line = [
      String(idx + 1).padEnd(4),
      short(r.name, 28).padEnd(28),
      String(r.totalVouchers).padStart(8),
      String(r.activeChannels).padStart(6),
      String(r.unclaimedVouchers).padStart(5),
      r.totalEarnedUsdc.padStart(13),
      short(r.authMode, 13).padEnd(13),
      short(r.trafficStatus, 14).padEnd(14),
      short(r.host, 44),
    ].join('  ');
    lines.push(line);
  });

  const unreadable = rows.filter((r) => !r.statsOk);
  if (unreadable.length > 0) {
    lines.push('');
    lines.push('Unreadable providers (likely admin auth required or endpoint issue):');
    unreadable.slice(0, 20).forEach((r) => {
      lines.push(`- ${r.name} (${r.host}) -> ${r.error}`);
    });
  }

  return lines.join('\n');
}

function makeMarkdownText(rows, options) {
  const lines = [];
  lines.push('| Rank | Provider | Vouchers | Active | Unclaimed | Earned_USDC | Auth | Status | Host |');
  lines.push('|---:|---|---:|---:|---:|---:|---|---|---|');
  rows.slice(0, options.top).forEach((r, idx) => {
    lines.push(`| ${idx + 1} | ${r.name} | ${r.totalVouchers} | ${r.activeChannels} | ${r.unclaimedVouchers} | ${r.totalEarnedUsdc} | ${r.authMode} | ${r.trafficStatus} | ${r.host} |`);
  });
  return lines.join('\n');
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function makeCsvText(rows, options) {
  const lines = [];
  lines.push([
    'rank',
    'provider',
    'url',
    'host',
    'providerAddress',
    'totalVouchers',
    'activeChannels',
    'unclaimedVouchers',
    'totalEarnedRaw',
    'totalEarnedUsdc',
    'authMode',
    'trafficStatus',
    'statsStatus',
    'error',
    'lastVoucherAt',
  ].join(','));
  rows.slice(0, options.top).forEach((r, idx) => {
    lines.push([
      idx + 1,
      r.name,
      r.url,
      r.host,
      r.providerAddress,
      r.totalVouchers,
      r.activeChannels,
      r.unclaimedVouchers,
      r.totalEarnedRaw,
      r.totalEarnedUsdc,
      r.authMode,
      r.trafficStatus,
      r.statsStatus,
      r.error,
      r.lastVoucherAt,
    ].map(csvEscape).join(','));
  });
  return lines.join('\n');
}

function renderOutput(summary, rows, options) {
  if (options.format === 'json') {
    return JSON.stringify({ summary, rows: rows.slice(0, options.top) }, null, options.watchSeconds > 0 ? 0 : 2);
  }
  if (options.format === 'csv') {
    return makeCsvText(rows, options);
  }
  if (options.format === 'markdown') {
    return makeMarkdownText(rows, options);
  }
  return makeTableText(summary, rows, options);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const hasExplicitProviders = options.providerUrls.length > 0 || !!options.providersFile;
  const watchSeconds = options.watchSeconds > 0 ? options.watchSeconds : 0;
  const watchIntervalMs = (watchSeconds || DEFAULT_WATCH_SECONDS) * 1000;

  for (let iteration = 1; ; iteration += 1) {
    let providers = buildProviderList(options);
    if (providers.length === 0) {
      providers = await loadMarketplaceProviders(options);
    }
    if (providers.length === 0) {
      throw new Error('No providers found to inspect');
    }

    const rows = await mapWithConcurrency(
      providers,
      options.concurrency,
      async (provider) => fetchProviderTrafficRow(provider, options),
    );

    const filtered = options.onlyTraffic ? rows.filter((r) => r.trafficStatus === 'traffic') : rows;
    filtered.sort((a, b) => {
      if (b.totalVouchers !== a.totalVouchers) return b.totalVouchers - a.totalVouchers;
      if (b.activeChannels !== a.activeChannels) return b.activeChannels - a.activeChannels;
      if (b.unclaimedVouchers !== a.unclaimedVouchers) return b.unclaimedVouchers - a.unclaimedVouchers;
      const be = toBigInt(b.totalEarnedRaw, 0n);
      const ae = toBigInt(a.totalEarnedRaw, 0n);
      if (be !== ae) return be > ae ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    const summary = {
      generatedAt: nowIso(),
      checked: rows.length,
      readable: rows.filter((r) => r.statsOk).length,
      withTraffic: rows.filter((r) => r.trafficStatus === 'traffic').length,
      unreadable: rows.filter((r) => !r.statsOk).length,
      iteration,
    };

    const output = renderOutput(summary, filtered, options);
    if (options.outputPath) {
      writeFileSync(options.outputPath, `${output}\n`, 'utf8');
      if (options.format !== 'json') {
        console.log(`Saved ${options.format} report to ${options.outputPath}`);
      }
    }
    console.log(options.format === 'table' ? `\n${output}` : output);

    if (watchSeconds === 0) {
      return;
    }

    // Reuse explicit provider targets each cycle; refresh marketplace set if auto-discovered.
    if (!hasExplicitProviders) {
      await sleep(watchIntervalMs);
      continue;
    }
    await sleep(watchIntervalMs);
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});

