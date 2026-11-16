/** Same application contract, versioned evidence and explicit browser-local persistence. */
import { ENGINE_VERSION, LANGUAGE_VERSION, evaluateScalar, FIELDS, jsonSafe, marketFrames, normalizePublicConfig, publicOperators, publicSeeds, publicWarnings, runBrowserResearch, validateCode, type PublicMarket, type Row } from './browserEngine';

import { OPERATOR_CATALOG } from './operatorCatalog';

const STORAGE_KEY = 'singularityx.public.research.v1';
const DATABASE_NAME = 'singularityx-public-research';
const OBJECT_STORE = 'state';
const TAB_KEY = 'singularityx.public.tab.v1';
type State = { schema: number; created_at: string; factors: Row[]; strategies: Row[]; runs: Row[]; reports: Row[]; datasets: Record<string, PublicMarket>; notices: string[]; operator_definitions?: Row[]; catalog_revision?: string };
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const base = () => (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
export class PublicApiError extends Error { constructor(message: string, public status = 422) { super(message); } }
const fail = (message: string, status = 422): never => { throw new PublicApiError(message, status); };
export async function hashText(text: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join(''); }
let dataPromise: Promise<{ data: PublicMarket; sha256: string }> | undefined;
const unsavedFailures = new Map<string, string>();
let storageMode: 'IndexedDB' | 'localStorage' = 'localStorage';
let storageFallbackReason = '';
let database: IDBDatabase | undefined;
let cachedState: State | undefined;
let localLock: Promise<unknown> = Promise.resolve();

function checkedState(value: any): State {
  if (!value || value.schema !== 1 || !['factors', 'strategies', 'runs', 'reports', 'notices'].every(key => Array.isArray(value[key])) || !value.datasets) return fail('本机研究记录格式不匹配；请先导出备份，未自动删除旧内容', 503);
  return value;
}
async function storageLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(STORAGE_KEY, operation);
  const result = localLock.then(operation, operation);
  localLock = result.then(() => undefined, () => undefined);
  return result;
}
async function chooseStorage() {
  if (database) { storageMode = 'IndexedDB'; return; }
  if (typeof indexedDB === 'undefined') { storageFallbackReason = '此环境没有 IndexedDB，兼容使用容量较小的 localStorage；实际配额由浏览器决定，满额会明确报错。'; return; }
  try {
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('打开 IndexedDB 超时')); } }, 5000);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE); };
      request.onsuccess = () => { clearTimeout(timer); if (settled) { request.result.close(); return; } settled = true; resolve(request.result); };
      const rejected = () => { clearTimeout(timer); if (!settled) { settled = true; reject(request.error || new Error('IndexedDB 被浏览器阻止或其他标签页占用')); } };
      request.onerror = rejected; request.onblocked = rejected;
    });
    database.onversionchange = () => { database?.close(); database = undefined; };
    storageMode = 'IndexedDB'; storageFallbackReason = '';
  } catch (error) {
    storageMode = 'localStorage';
    storageFallbackReason = 'IndexedDB 不可用，兼容使用容量较小的 localStorage；未删除旧数据。原因：' + (error instanceof Error ? error.message : String(error));
  }
}
function localState(): State | undefined {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? checkedState(JSON.parse(raw)) : undefined; }
  catch (error) { if (error instanceof PublicApiError) throw error; return fail('浏览器无法读取原本机存储；没有自动清空旧记录。', 503); }
}
async function loadStored(): Promise<State | undefined> {
  if (storageMode === 'localStorage') return localState();
  if (!database) return fail('IndexedDB 连接已关闭，请刷新页面后重试；已保存记录未删除。', 503);
  return new Promise((resolve, reject) => {
    let value: State | undefined;
    try {
      const transaction = database!.transaction(OBJECT_STORE, 'readonly');
      const request = transaction.objectStore(OBJECT_STORE).get(STORAGE_KEY);
      request.onsuccess = () => { value = request.result; };
      transaction.oncomplete = () => { try { resolve(value === undefined ? undefined : checkedState(value)); } catch (error) { reject(error); } };
      transaction.onabort = transaction.onerror = () => reject(new PublicApiError('IndexedDB 读取失败；原记录未删除。', 503));
    } catch (error) { reject(new PublicApiError('IndexedDB 无法读取：' + (error instanceof Error ? error.message : String(error)), 503)); }
  });
}
async function persist(state: State): Promise<void> {
  const value = jsonSafe(state);
  if (storageMode === 'localStorage') {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
    catch { fail('localStorage 兼容存储写入失败或容量已满。原记录没有被清空，请导出研究快照；可启用 IndexedDB 后迁移完整记录。', 507); }
    return;
  }
  if (!database) return fail('IndexedDB 连接已关闭，请刷新后重试；原记录未删除。', 503);
  await new Promise<void>((resolve, reject) => {
    try {
      const transaction = database!.transaction(OBJECT_STORE, 'readwrite');
      transaction.objectStore(OBJECT_STORE).put(value, STORAGE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(new PublicApiError('IndexedDB 写入失败或站点存储配额已满；事务未提交，旧记录和完整结果保持不变。请导出快照后检查浏览器存储。', 507));
    } catch (error) { reject(new PublicApiError('IndexedDB 无法写入；旧记录保持不变：' + (error instanceof Error ? error.message : String(error)), 507)); }
  });
}
async function hydrate() {
  await storageLock(async () => { const latest = await loadStored(); if (!latest) return fail('本机研究记录不存在；未自动以新数据覆盖。', 503); cachedState = clone(latest); });
}
function storageInfo() {
  return { storage: storageMode, storage_label: storageMode + (storageMode === 'IndexedDB' ? ' · 本机数据库' : ' · 小容量兼容存储'), storage_fallback_reason: storageFallbackReason || null,
    storage_quota: storageMode === 'IndexedDB' ? '由浏览器按站点动态分配；不会自动删除旧结果，仍建议导出备份。' : 'localStorage 配额较小（常见约 5 MiB，实际由浏览器决定）；满额会报错，不自动删旧结果。',
    storage_database: storageMode === 'IndexedDB' ? DATABASE_NAME : null, storage_object_store: storageMode === 'IndexedDB' ? OBJECT_STORE : null };
}
export function publicMarket(): Promise<{ data: PublicMarket; sha256: string }> {
  if (!dataPromise) dataPromise = (async () => {
    const response = await fetch(base() + 'research/public-market.json', { cache: 'no-cache' });
    if (!response.ok) throw new PublicApiError(`公开行情文件读取失败（${response.status}）`, 503);
    const text = await response.text(); let data: PublicMarket;
    try { data = JSON.parse(text); marketFrames(data); } catch (e) { throw new PublicApiError('公开行情校验失败：' + (e instanceof Error ? e.message : String(e)), 503); }
    return { data, sha256: await hashText(text) };
  })().catch(e => { dataPromise = undefined; throw e; });
  return dataPromise;
}

let publishedRuns: Row[] = [];
let catalogIndex: Row | undefined;
const assetCache = new Map<string, Promise<any>>();
async function asset(name: string) {
  if (!assetCache.has(name)) assetCache.set(name, (async () => {
    const response = await fetch(base() + 'research/' + name, { cache: 'no-cache' });
    if (!response.ok) throw new PublicApiError(`研究资源 ${name} 读取失败（${response.status}）`, 503);
    const raw = await response.text(); const value = JSON.parse(raw); Object.defineProperty(value, '__file_sha256', { value: await hashText(raw), enumerable: false }); return value;
  })().catch(error => { assetCache.delete(name); throw error; }));
  return assetCache.get(name)!;
}
async function syncCatalogs() {
  const index = await asset('catalog-index.json');
  if (index.schema !== 'quant.public.catalog-index' || index.version !== 1 || !Array.isArray(index.factors) || index.factors.length !== 221 || new Set(index.factors.map((f: Row) => f.id)).size !== 221 || !Array.isArray(index.runs) || !index.sources) return fail('轻量目录数量/格式校验失败，原记录未修改', 503);
  catalogIndex = index; publishedRuns = index.runs;
  const revision = await hashText(JSON.stringify([index.__file_sha256, OPERATOR_CATALOG]));
  await storageLock(async () => {
    const state = await loadStored(); if (!state) return;
    if (state.catalog_revision === revision && state.operator_definitions) { cachedState = clone(state); return; }
    for (const original of index.factors) {
      // Deleted records remain as tombstones; shipped updates never overwrite a user's revision.
      const existing = state.factors.find(f => f.id === original.id);
      if (existing) {
        const metadata = Object.fromEntries(['has_history','history_url','history_sha256','legacy_metrics','published_run_id','published_run_url','published_run_code_hash','published_run_status','published_run_file_sha256','definition_asset','definition_asset_sha256'].filter(key => key in original).map(key => [key, original[key]]));
        Object.assign(existing, metadata, { original_code_hash: original.code_hash });
        if (existing.version === 1 && existing.code_hash === original.code_hash) Object.assign(existing, Object.fromEntries(['category', 'capability', 'implementation_notes', 'definition_origin'].filter(key => key in original).map(key => [key, original[key]])));
        continue;
      }
      const f = { ...original, original_code_hash: original.code_hash, catalog_origin: original.source_kind === 'legacy' ? 'work120' : 'alpha101', version: original.version || 1, created_at: original.created_at || now(), updated_at: now() };
      state.factors.push({ ...f, versions: [] });
    }
    state.operator_definitions ||= [];
    for (const original of OPERATOR_CATALOG) if (!state.operator_definitions.some(o => o.id === original.id)) {
      const value = { ...original, version: 1, custom: false, deleted: false, created_at: now(), updated_at: now() };
      state.operator_definitions.push({ ...value, versions: [{ ...value }] });
    }
    for (const report of index.reports || []) if (!state.reports.some(r => r.id === report.id)) state.reports.push({ ...report, source_kind: 'published_public_run', versions: [report] });
    state.catalog_revision = revision;
    await persist(state); cachedState = clone(state);
  });
}

function read(): State {
  if (!cachedState) return fail('本机研究记录尚未初始化', 503);
  const value = clone(cachedState);
  for (const run of value.runs) if (unsavedFailures.has(run.id)) Object.assign(run, { status: 'failed', message: unsavedFailures.get(run.id), error: unsavedFailures.get(run.id), persistence_warning: '失败状态当前仅在页面内存中，浏览器数据库仍保留上次成功内容' });
  return value;
}
let initializing: Promise<void> | undefined;
let tabId = '';
const running = new Map<string, { cancelled: boolean }>();
async function initialize() {
  if (!initializing) initializing = (async () => {
    try { tabId = sessionStorage.getItem(TAB_KEY) || id('tab'); sessionStorage.setItem(TAB_KEY, tabId); }
    catch { fail('公开研究版需要浏览器本机存储；请允许本站数据库与 sessionStorage。', 503); }
    await chooseStorage();
    const found = await storageLock(async () => {
      const stored = await loadStored();
      const legacy = !stored && storageMode === 'IndexedDB' ? localState() : undefined;
      const state = stored ? clone(stored) : legacy ? clone(legacy) : undefined;
      if (!state) return false;
      let changed = false;
      for (const run of state.runs) if (['queued', 'running'].includes(run.status) && run.owner_tab === tabId) { run.status = 'interrupted'; run.message = '页面上次关闭或刷新，计算已中断；冻结配置仍保留，可重新提交'; run.finished_at = now(); changed = true; }
      if (legacy) state.notices.push('完整研究记录已从 localStorage 迁移至 IndexedDB，历史版本和运行结果全部保留。');
      if (changed || legacy) await persist(state);
      cachedState = clone(state);
      // Remove the legacy key only after the IndexedDB transaction completed.
      if (legacy) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* Migration is committed; leaving a legacy backup is safe. */ } }
      return true;
    });
    if (found) { await syncCatalogs(); return; }
    const factors = await Promise.all(publicSeeds().map(async f => { const value = { ...f, code_hash: await hashText(f.code) }; return { ...value, versions: [{ ...value }] }; }));
    const state: State = { schema: 1, created_at: now(), factors, strategies: [], runs: [], reports: [], datasets: {}, notices: [] };
    await storageLock(async () => {
      const existing = await loadStored();
      if (existing) { cachedState = clone(existing); return; }
      // A different tab may have written an older-format record while sources loaded.
      const legacy = storageMode === 'IndexedDB' ? localState() : undefined;
      const value = legacy || state;
      await persist(value); cachedState = clone(value);
      if (legacy) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* Keep the backup if its removal is denied. */ } }
    });
    await syncCatalogs();
  })().catch(e => { initializing = undefined; throw e; });
  return initializing;
}
async function mutate<T>(operation: (state: State) => T): Promise<T> {
  await initialize();
  return storageLock(async () => {
    const latest = await loadStored(); if (!latest) return fail('本机研究记录不存在，未自动覆盖。', 503);
    const state = clone(latest), result = operation(state);
    await persist(state);
    cachedState = clone(state);
    return clone(result);
  });
}
const evidenceFields = ['has_history', 'history_url', 'history_sha256', 'legacy_metrics', 'derived_legacy_metrics', 'output_metadata', 'source_bundle', 'dependency_audit', 'migration', 'native_code', 'published_run_id', 'published_run_url', 'published_run_code_hash', 'published_run_status', 'published_run_file_sha256'];
async function materializeFactor(factor: Row): Promise<Row> {
  const index = catalogIndex?.factors.find((f: Row) => f.id === factor.id);
  if (!index || !factor._catalog_stub && factor.definition_loaded_sha256 === index.definition_asset_sha256) return factor;
  if (!['work-catalog.json', 'alpha101.json'].includes(index.definition_asset)) return fail('因子定义来源不在已发布清单内', 503);
  const bundle = await asset(index.definition_asset);
  if (bundle.__file_sha256 !== index.definition_asset_sha256 || bundle.__file_sha256 !== catalogIndex?.sources[index.definition_asset]?.sha256) return fail('因子定义文件指纹不匹配，原记录未修改', 503);
  const original = bundle.factors?.find((f: Row) => f.id === factor.id);
  if (!original || original.code_hash !== index.code_hash || typeof original.code !== 'string' || await hashText(original.code) !== original.code_hash) return fail('因子原始代码指纹不匹配，原记录未修改', 503);
  const metadata = { ...Object.fromEntries(evidenceFields.filter(key => key in original).map(key => [key, original[key]])), original_code_hash: original.code_hash, definition_asset: index.definition_asset, definition_asset_sha256: index.definition_asset_sha256, definition_loaded_sha256: index.definition_asset_sha256 };
  if (!factor._catalog_stub) return { ...factor, ...metadata }; // Preserve every local revision, AST, name and tombstone.
  if (factor.version !== (original.version || 1) || factor.code !== undefined || factor.versions?.length) return fail('因子占位记录存在未能确认的本机修改，未用公开定义覆盖', 409);
  const value = { ...original, ...metadata, catalog_origin: index.catalog_origin, version: factor.version, created_at: factor.created_at, updated_at: factor.updated_at, deleted: !!factor.deleted };
  return { ...value, versions: [clone(value)] };
}
async function ensureDefinitions(identifiers: string[]) {
  const before = read();
  const pending = [...new Set(identifiers)].map(identifier => lookup(before.factors, identifier));
  const resolved = await Promise.all(pending.map(materializeFactor));
  const changed = resolved.filter((factor, i) => factor !== pending[i]);
  if (!changed.length) return;
  await mutate(state => {
    for (const factor of changed) {
      const original = lookup(before.factors, factor.id), current = lookup(state.factors, factor.id);
      // A different tab may have edited the factor while the published asset loaded.
      if (current.version === original.version && current.code_hash === original.code_hash && !!current._catalog_stub === !!original._catalog_stub)
        state.factors[state.factors.indexOf(current)] = factor;
    }
    return null;
  });
}
function selectedIds(config: Row): string[] {
  const selected = config?.factors || [{ factor_id: config?.factor_id }];
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 8 || selected.some(entry => !entry || typeof entry.factor_id !== 'string')) return fail('请选择1–8个不重复的因子定义');
  return selected.map(entry => entry.factor_id);
}
async function publishedRun(identifier: string): Promise<Row> {
  const index = publishedRuns.find(r => r.id === identifier);
  if (!index || !/^research\/(public-runs\.json|alpha101-results\/alpha101_\d{3}\.json)$/.test(index.published_run_url)) return fail('研究任务不存在', 404);
  const bundle = await asset(index.published_run_url.slice('research/'.length));
  if (bundle.__file_sha256 !== index.file_sha256 || bundle.data_sha256 !== catalogIndex?.data_sha256) return fail('已发布研究文件或行情指纹不匹配', 503);
  const run = bundle.run || bundle.runs?.find((r: Row) => r.id === identifier);
  if (!run || run.id !== identifier || !Array.isArray(run.factor_specs) || !run.factor_specs.length || !run.result?.curves?.length) return fail('已发布研究缺少原始冻结定义或结果', 503);
  for (const f of run.factor_specs) {
    const parsed = validateCode(f.code);
    if (!parsed.valid || JSON.stringify(parsed.ast) !== JSON.stringify(f.ast) || await hashText(f.code) !== f.code_hash) return fail('已发布研究的代码与AST指纹不匹配', 503);
  }
  if (index.code_hash && run.factor_specs[0].code_hash !== index.code_hash) return fail('已发布研究的因子定义与索引不符', 503);
  return { ...clone(run), market_sha256: bundle.data_sha256 };
}
async function completeSnapshot() {
  const state = read();
  state.factors = await Promise.all(state.factors.map(materializeFactor));
  // Published evidence remains external until this explicit complete-export action.
  const additional = await Promise.all(publishedRuns.filter(r => !state.runs.some(s => s.id === r.id)).map(r => publishedRun(r.id)));
  state.runs.push(...additional);
  if (state.runs.some(r => r.market_sha256 && !state.datasets[r.market_sha256])) {
    const current = await publicMarket(); state.datasets[current.sha256] = current.data;
    if (state.runs.some(r => r.market_sha256 && !state.datasets[r.market_sha256])) return fail('部分历史任务缺少冻结行情，未用当前行情替代；请逐项导出并检查原记录', 409);
  }
  return { schema: 'quant.public.snapshot', version: 1, exported_at: now(), ...storageInfo(), storage_scope: '浏览器本机；包含全部历史版本、行情快照和运行结果', state };
}
function lookup(items: Row[], identifier: string) { return items.find(x => x.id === identifier) || fail('记录不存在', 404); }
function text(value: any, label: string, limit: number, required = true) { if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) fail(`${label}须为${required ? '非空' : ''}文本，最多${limit}字`); return value; }
function record(items: Row[], payload: Row, prefix: string, identifier?: string, expected?: number): Row {
  const old = identifier ? lookup(items, identifier) : undefined;
  if (old && (typeof expected !== 'number' || old.version !== expected)) return fail('版本已更新，请刷新后合并修改；旧版本仍保留', 409);
  const stamp = now(), value = { ...payload, id: identifier || id(prefix), version: old ? old.version + 1 : 1, created_at: old?.created_at || stamp, updated_at: stamp };
  const saved = { ...value, versions: [...(old?.versions || []), clone(value)] };
  if (old) items[items.indexOf(old)] = saved; else items.push(saved);
  return saved;
}
function factorSummary(factor: Row, state: State) {
  const latest = [...state.runs, ...publishedRuns].filter(r => r.status === 'completed' && r.kind === 'factor' && r.config?.factor_versions?.length === 1 && r.config.factor_versions[0].id === factor.id && r.config.factor_versions[0].version === factor.version && (!r.config.factor_versions[0].code_hash || r.config.factor_versions[0].code_hash === factor.code_hash)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const { versions: _versions, ...value } = factor;
  return { ...value, metrics: latest?.metrics || (factor.version === 1 ? factor.legacy_metrics : null) || null, latest_metrics: latest?.metrics || null, latest_run_id: latest?.id || null, latest_run_source: latest?.source_kind || null, status: factor.deleted ? 'deleted' : latest ? 'evaluated' : factor.status || 'ready' };
}
const PUBLIC_UNIVERSE_ID = 'public_sample';
const PUBLIC_BENCHMARK_ID = 'index:000300.SH';
const SIGNAL_WEIGHT_DEFINITION = '信号权重无量纲，不是资金或持仓比例；0权重不参与。1个非零因子保留原值并按符号定向；多个非零因子各自在当日有效截面做百分位排名，再按w/Σ|w|相加，合成只保留共同有效样本。';
function selectionConfig(given: unknown): Row {
  if (!given || typeof given !== 'object' || Array.isArray(given)) return fail('研究配置须为对象');
  const config = { ...(given as Row), universe_id: (given as Row).universe_id ?? PUBLIC_UNIVERSE_ID, benchmark_id: (given as Row).benchmark_id ?? PUBLIC_BENCHMARK_ID };
  if (config.universe_id !== PUBLIC_UNIVERSE_ID) return fail('公开引擎仅支持 public_sample 固定股票样本；其它股票池请连接本地引擎。');
  if (config.benchmark_id !== PUBLIC_BENCHMARK_ID) return fail('公开引擎仅接入 index:000300.SH 沪深300价格指数；不使用其他数据冒充所选基准。');
  return config;
}
function benchmarkMetadata(data: PublicMarket, marketHash?: string): Row {
  return { id: PUBLIC_BENCHMARK_ID, name: data.source.benchmark || '沪深300价格指数 000300.SH', basis: '价格指数收盘收益，不含分红；按策略净值日期对齐，首个研究日收盘归一为 1。',
    provenance: { code: '000300.SH', field: 'close', provider: data.source.provider, url: data.source.url, market_sha256: marketHash, source_benchmark: data.source.benchmark, normalization: 'benchmark_close[t] / benchmark_close[first_strategy_date]', return_basis: '价格指数，不含分红，不是ETF或全收益指数' } };
}
function publicResearchOptions(data: PublicMarket): Row {
  const parsed = marketFrames(data), available_fields = Object.entries(parsed.frames).filter(([, rows]) => rows.some(row => row.some(Number.isFinite))).map(([field]) => field);
  const start = parsed.dates[0], end = parsed.dates.at(-1), benchmark = benchmarkMetadata(data);
  const benchmarkDates = data.benchmark.map(row => row.date).sort();
  return { data_mode: 'public', available_fields, start_date: start, end_date: end, default_universe_id: PUBLIC_UNIVERSE_ID, default_benchmark_id: PUBLIC_BENCHMARK_ID,
    universes: [{ id: PUBLIC_UNIVERSE_ID, name: `公开固定 ${parsed.symbols.length} 股样本`, description: '固定存续证券，存在事后选样和幸存者偏差，不代表全A股或官方指数成份。', basis: '实际公开未复权行情；仅按已提供证券和日期研究。', available: true, start_date: start, end_date: end, stock_count: parsed.symbols.length, dates_count: parsed.dates.length }],
    benchmarks: [{ ...benchmark, available: benchmarkDates.length > 0, start_date: benchmarkDates[0] || null, end_date: benchmarkDates.at(-1) || null, dates_count: benchmarkDates.length }],
    limits: { max_factors: 8 }, note: '只列出当前真实接入的数据。更多股票池、指数与原work股票级因子值需连接本地引擎。' };
}
function selectedDefinitions(config: Row, state: State): Row[] {
  const selected = config.factors || [{ factor_id: config.factor_id, weight: 1 }];
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 8 || selected.some(entry => !entry || typeof entry !== 'object' || typeof entry.factor_id !== 'string') || new Set(selected.map(entry => entry.factor_id)).size !== selected.length) return fail('请选择1–8个不重复的因子定义');
  const result = selected.map(entry => { const factor = lookup(state.factors, entry.factor_id), weight = entry.weight ?? 1; if (factor.deleted) return fail('此因子已删除，请先恢复'); if (typeof weight !== 'number' || !Number.isFinite(weight) || Math.abs(weight) > 100) return fail('信号权重须为 −100 至 100 的有限数（无量纲）'); const { versions: _, ...snapshot } = factor; return { ...snapshot, weight }; });
  if (result.every(factor => factor.weight === 0)) return fail('因子权重不能全部为零');
  return result;
}
function checkPublicResearch(config: Row, state: State, data: PublicMarket): Row {
  const options = publicResearchOptions(data), errors: string[] = [], factors: Row[] = [];
  for (const factor of selectedDefinitions(config, state)) {
    let reason = ''; let missing_fields: string[] = [];
    if (factor.weight === 0) { factors.push({ id: factor.id, ready: true, missing_fields, reason: '0权重，不参与计算' }); continue; }
    if (factor.source_kind !== 'native_ast') reason = '公开版没有股票级work原值快照；请连接有原Parquet的本地引擎。历史净值不能拼成新的组合。';
    else {
      const parsed = validateCode(factor.code);
      if (!parsed.valid) reason = parsed.errors.join('；');
      else if (JSON.stringify(parsed.ast) !== JSON.stringify(factor.ast)) reason = '持久化因子代码与AST不一致，请重新校验并保存。';
      else { missing_fields = parsed.dependencies.filter((field: string) => !options.available_fields.includes(field)); if (missing_fields.length) reason = '当前真实行情缺少已验证字段：' + missing_fields.join('、') + '。请选择其他因子或连接具备字段的本地引擎。'; }
    }
    factors.push({ id: factor.id, ready: !reason, missing_fields, reason });
    if (reason) errors.push(factor.name + '：' + reason);
  }
  return { ready: !errors.length, errors, factors, data_mode: 'public', note: '字段预检后，计算仍检查真实预热与共同有效样本；无效因子不会悄悄跳过。' };
}
function entries(config: Row, state: State, data: PublicMarket): Row[] {
  const check = checkPublicResearch(config, state, data);
  if (!check.ready) return fail(check.errors.join('\n'));
  return selectedDefinitions(config, state).filter(factor => factor.weight !== 0);
}
async function comparePublicBenchmark(run: Row, state: State, identifier: string | null): Promise<Row> {
  if (run.status !== 'completed' || !run.result?.curves?.length) return fail('任务尚未产生完整净值，不能计算对比基准');
  if (identifier !== PUBLIC_BENCHMARK_ID) return fail('公开引擎只提供 index:000300.SH 沪深300价格指数对比');
  let data = state.datasets[run.market_sha256];
  if (!data) { const current = await publicMarket(); if (current.sha256 !== run.market_sha256) return fail('该任务的冻结行情快照不可用；不会使用新行情覆盖历史对比', 409); data = current.data; }
  marketFrames(data);
  const dates: string[] = run.result.curves.map((row: Row) => row.date), prices = new Map(data.benchmark.map(row => [row.date, row.close]));
  const missing = dates.filter(date => !Number.isFinite(prices.get(date)) || prices.get(date)! <= 0);
  if (missing.length) return fail(`冻结行情缺少 ${missing.length} 个净值日期的真实基准报价（如 ${missing[0]}）；未填充或改用别的价格。`);
  const anchor = prices.get(dates[0])!, curves = dates.map(date => ({ date, benchmark: prices.get(date)! / anchor })), last = curves.at(-1)!.benchmark;
  const strategyNav = run.result.curves.at(-1)?.nav;
  return { benchmark: benchmarkMetadata(data, run.market_sha256), curves, metrics: { benchmark_return: last - 1, excess_return: Number.isFinite(strategyNav) ? strategyNav - last : null }, comparison_only: true, run_id: run.id };
}
async function calculate(runId: string) {
  const control = { cancelled: false }; running.set(runId, control);
  let persistenceError: unknown;
  try {
    const state = read(), run = lookup(state.runs, runId), data = state.datasets[run.market_sha256];
    if (!data || run.status === 'cancelled') return;
    await mutate(s => { const r = lookup(s.runs, runId); if (r.status === 'cancelled') return r; Object.assign(r, { status: 'running', progress: 1, message: '浏览器正在计算公开行情', updated_at: now() }); return r; });
    let pending: Promise<unknown> = Promise.resolve();
    const result = await runBrowserResearch(data, run.config, run.factor_specs, (progress, message) => { pending = pending.then(() => mutate(s => { const r = lookup(s.runs, runId); if (r.status !== 'cancelled') Object.assign(r, { progress, message, updated_at: now() }); return r; })).catch(e => { persistenceError = e; control.cancelled = true; }); }, () => control.cancelled || read().runs.find(r => r.id === runId)?.status === 'cancelled');
    await pending;
    if (persistenceError) throw persistenceError;
    result.benchmark = benchmarkMetadata(data, run.market_sha256);
    result.provenance.benchmark = result.benchmark;
    result.provenance.signal_weight_definition = SIGNAL_WEIGHT_DEFINITION;
    result.provenance.market_sha256 = run.market_sha256;
    result.provenance.storage = storageMode + '，仅保存在当前浏览器，不自动同步其他设备';
    await mutate(s => { const r = lookup(s.runs, runId); if (r.status !== 'cancelled') Object.assign(r, { status: 'completed', progress: 100, message: '公开行情真实计算完成 · 本机保存', result, metrics: result.metrics, finished_at: now(), updated_at: now() }); return r; });
  } catch (e) {
    const cause = persistenceError || e, message = cause instanceof Error ? cause.message : String(cause);
    try { await mutate(s => { const r = lookup(s.runs, runId); if (r.status !== 'cancelled') Object.assign(r, { status: 'failed', message, error: message, finished_at: now() }); return r; }); } catch (storageError) { unsavedFailures.set(runId, message + '；' + (storageError instanceof Error ? storageError.message : String(storageError))); }
  } finally { running.delete(runId); }
}

export async function publicRequest(path: string, method = 'GET', body: any = undefined, signal?: AbortSignal): Promise<any> {
  const parts = path.split('?')[0].split('/').filter(Boolean), [collection, identifier, action] = parts;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (collection === 'session' && method === 'GET') return { mode: 'public', authenticated: true, username: '本机研究员', role: 'researcher', storage_initialization: 'on_demand', note: '公开研究版 · 本机保存；无账号服务器或跨设备同步；发布目录与本机研究记录分开保存' };
  await initialize(); await hydrate(); if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (collection === 'login' || collection === 'logout') return fail('公开研究版没有账号服务器；本机记录通过浏览器存储保存');
  if (collection === 'research' && identifier === 'options' && method === 'GET') return publicResearchOptions((await publicMarket()).data);
  if (collection === 'research' && identifier === 'preflight' && method === 'POST') {
    const { data } = await publicMarket();
    try { const config = normalizePublicConfig({ ...selectionConfig(body?.config), kind: body?.kind }, data); await ensureDefinitions(selectedIds(config)); return checkPublicResearch(config, read(), data); }
    catch (error) { return { ready: false, errors: [error instanceof Error ? error.message : String(error)], factors: [], data_mode: 'public' }; }
  }
  if (collection === 'operators') return publicOperators();
  if (collection === 'data' && identifier === 'benchmark-0933') return asset('work-benchmark-0933.json');
  if (collection === 'data' && identifier === 'catalog') return asset('data-catalog.json');
  if (collection === 'data' && identifier === 'preview') return fail('源数据保存在本地 data 目录；请在本地后台查看，GitHub 页面未上传此表。');
  if (collection === 'operator-definitions') {
    if (method === 'GET') return read().operator_definitions || [];
    if (method === 'DELETE' || method === 'PUT' && body?.deleted === false && !body?.name) return mutate(state => {
      const items = state.operator_definitions || [], old = lookup(items, identifier), { versions: _, ...value } = old;
      return record(items, { ...value, deleted: method === 'DELETE' }, 'operator', identifier, body?.base_version);
    });
    if (method === 'POST' || method === 'PUT') {
      const payload: Row = {};
      for (const key of ['name', 'category', 'formula', 'description', 'fields', 'window', 'timing', 'source', 'sourceLabel']) payload[key] = text(body?.[key] ?? '', key, key === 'description' ? 8000 : 2000, ['name', 'category', 'formula'].includes(key));
      if (payload.source && !/^https?:\/\//i.test(payload.source)) return fail('来源地址须为 HTTP(S) 链接或留空');
      if (body?.code) { const check = validateCode(text(body.code, '算子模板', 12000)); if (!check.valid) return fail(check.errors.join('；')); payload.code = check.code; }
      if (body?.manual) {
        const manual = body.manual;
        if (!Array.isArray(manual.inputs) || manual.inputs.length < 1 || manual.inputs.length > 20 || !manual.inputs.every((i: Row) => typeof i.key === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(i.key) && typeof i.label === 'string')) return fail('手填输入定义无效');
        if (new Set(manual.inputs.map((i: Row) => i.key)).size !== manual.inputs.length) return fail('手填输入变量不可重名');
        text(manual.expression, '手填表达式', 4000); evaluateScalar(manual.expression, Object.fromEntries(manual.inputs.map((i: Row) => [i.key, 1]))); payload.manual = clone(manual);
      }
      if (body?.parameters) { if (!Array.isArray(body.parameters) || body.parameters.length > 20) return fail('参数定义无效'); payload.parameters = clone(body.parameters); }
      if (!payload.code && !payload.manual) return fail('算子需提供可校验代码模板或手填表达式');
      return mutate(state => { state.operator_definitions ||= []; const old = method === 'PUT' ? lookup(state.operator_definitions, identifier) : undefined; return record(state.operator_definitions, { ...payload, custom: old?.custom ?? true, deleted: body?.deleted === false ? false : old?.deleted || false }, 'operator', method === 'PUT' ? identifier : undefined, body?.base_version); });
    }
  }
  if (collection === 'factors' && identifier === 'validate' && method === 'POST') return body?.language === 'python' ? (await import('./sourceEditor')).validatePythonSource(text(body?.code, 'Python代码', 100000)) : validateCode(text(body?.code, '代码', 12000));
  if (collection === 'factors') {
    if (identifier) await ensureDefinitions([identifier]);
    if (method === 'GET') {
      const state = read(); if (!identifier) return state.factors.map(f => factorSummary(f, state));
      const factor = lookup(state.factors, identifier);
      if (action === 'history') {
        if (!factor.history_url || !/^research\/work-history\/[A-Za-z0-9_]+\.json$/.test(factor.history_url)) return fail('该因子没有原始历史研究', 404);
        const history = await asset(factor.history_url.slice('research/'.length)); if (factor.history_sha256 && history.__file_sha256 !== factor.history_sha256) return fail('原始历史研究指纹不匹配，请重新载入目录', 503); return history;
      }
      if (action === 'sources') { const work = await asset('work-catalog.json'); return Object.fromEntries((factor.source_bundle || []).map((key: string) => [key, work.source_modules[key]])); }
      return { ...factorSummary(factor, state), versions: factor.versions };
    }
    if (method === 'DELETE' || method === 'PUT' && body?.deleted === false && !body?.name) return mutate(state => {
      const old = lookup(state.factors, identifier), { versions: _, ...value } = old;
      return record(state.factors, { ...value, deleted: method === 'DELETE' }, 'factor', identifier, body?.base_version);
    });
    if (method === 'POST' || method === 'PUT') {
      const old = method === 'PUT' ? lookup(read().factors, identifier) : undefined;
      const python = body?.language === 'python' || old?.source_kind === 'legacy' && body?.language !== 'restricted';
      const name = text(body?.name, '名称', 160), category = text(body?.category || '自定义', '分类', 80), description = text(body?.description || '', '说明', 5000, false);
      const code = text(body?.code, '代码', python ? 100000 : 12000), parsed = python ? (await import('./sourceEditor')).validatePythonSource(code) : validateCode(code);
      if (!parsed.valid) return fail(parsed.errors.join('；')); const code_hash = await hashText(parsed.code!);
      return mutate(state => {
        const previous = method === 'PUT' ? lookup(state.factors, identifier) : undefined, { versions: _, ...kept } = previous || {};
        const unchangedCode = previous?.code === code;
        return record(state.factors, { ...kept, name, category, description, ...parsed, ...(python && unchangedCode && previous ? { ast: previous.ast, steps: previous.steps, dependencies: previous.dependencies } : {}), code_hash,
          source_kind: python ? 'legacy' : 'native_ast', deleted: false, status: python ? 'source_draft' : 'ready',
          source_path: previous?.source_path || 'web/editor', latest_metrics: null, metrics: null,
          source_edit_note: python ? 'Python 源码修订只保存和解析，不自动执行。旧历史结果属于原始版本。' : undefined,
          limitations: previous?.limitations || publicWarnings.slice(0, 2) }, 'factor', method === 'PUT' ? identifier : undefined, body.base_version);
      });
    }
  }
  if (collection === 'strategies') {
    if (method === 'GET') return read().strategies;
    if (method === 'POST' || method === 'PUT') { const config = { ...selectionConfig(body?.config), kind: 'strategy' }; await ensureDefinitions(selectedIds(config)); return mutate(state => { selectedDefinitions(config, state); return record(state.strategies, { name: text(body?.name, '名称', 160), description: text(body?.description || '', '说明', 5000, false), config }, 'strategy', method === 'PUT' ? identifier : undefined, body.base_version); }); }
  }
  if (collection === 'runs') {
    if (method === 'GET') {
      const state = read(); if (!identifier) return [...state.runs.map(({ result: _, factor_specs: __, ...run }) => run), ...publishedRuns.filter(r => !state.runs.some(s => s.id === r.id))].sort((a, b) => b.created_at.localeCompare(a.created_at));
      let run = state.runs.find(r => r.id === identifier);
      if (!run) run = await publishedRun(identifier);
      if (!run) return fail('研究任务不存在', 404);
      if (action === 'benchmark') return comparePublicBenchmark(run, state, new URLSearchParams(path.split('?')[1] || '').get('benchmark_id'));
      if (action === 'export') {
        if (run.status !== 'completed') return fail('任务尚未完成', 409);
        let data = state.datasets[run.market_sha256];
        if (!data) { const current = await publicMarket(); if (current.sha256 !== run.market_sha256) return fail('该任务的冻结行情不可用，未用当前行情替代', 409); data = current.data; }
        return { schema: 'quant.public.run', version: 1, exported_at: now(), run, data };
      } return run;
    }
    if (action === 'cancel' && method === 'POST') { const control = running.get(identifier); if (control) control.cancelled = true; return mutate(state => { const run = lookup(state.runs, identifier); if (!['queued', 'running'].includes(run.status)) return fail('任务已经结束', 409); Object.assign(run, { status: 'cancelled', message: '用户取消', finished_at: now() }); return run; }); }
    if (method === 'POST' && !identifier) {
      await ensureDefinitions(selectedIds(selectionConfig(body?.config)));
      const { data, sha256 } = await publicMarket(), config = normalizePublicConfig({ ...selectionConfig(body?.config), kind: body?.kind }, data), name = text(body?.name, '任务名称', 160), specs = entries(config, read(), data);
      const factor_versions = await Promise.all(specs.map(async f => ({ id: f.id, version: f.version, weight: f.weight, code_hash: await hashText(f.code) })));
      const run = await mutate(state => { if (state.runs.filter(r => ['queued', 'running'].includes(r.status)).length >= 3) return fail('最多同时排队3个浏览器任务，请等待或取消', 429); const latest = entries(config, state, data); if (latest.some((f, i) => f.version !== specs[i].version)) return fail('因子刚被修改，请重新提交', 409); state.datasets[sha256] = data; const stamp = now(); const value: Row = { id: id('run'), name, kind: config.kind, status: 'queued', progress: 0, message: '已冻结参数，等待浏览器计算', created_at: stamp, updated_at: stamp, finished_at: null, source_kind: 'browser_public_run', owner_tab: tabId, market_sha256: sha256, config: { ...config, factor_versions, signal_weight_definition: SIGNAL_WEIGHT_DEFINITION, language_version: LANGUAGE_VERSION, engine_version: ENGINE_VERSION, sample_status: '固定公开小样本探索；非独立样本外验证' }, factor_specs: clone(specs), metrics: null, result: null }; state.runs.push(value); return value; });
      setTimeout(() => { void calculate(run.id); }, 0); return run;
    }
  }
  if (collection === 'reports') {
    if (method === 'GET') return read().reports;
    if (method === 'POST' || method === 'PUT') return mutate(state => { const old = method === 'PUT' ? lookup(state.reports, identifier) : undefined, runId = old?.run_id || body?.run_id; if ((state.runs.find(r => r.id === runId) || publishedRuns.find(r => r.id === runId))?.status !== 'completed') return fail('报告必须关联一项已完成的真实研究'); return record(state.reports, { title: text(body?.title, '标题', 160), body: text(body?.body || '', '正文', 50000, false), run_id: runId, author: '本机研究员', source_kind: 'browser_public_report' }, 'report', method === 'PUT' ? identifier : undefined, body.base_version); });
  }
  if (collection === 'overview' || collection === 'data' || collection === 'system') {
    const { data, sha256 } = await publicMarket(), parsed = marketFrames(data), state = read();
    const allRuns = [...state.runs, ...publishedRuns.filter(r => !state.runs.some(s => s.id === r.id))];
    const issues = publicWarnings.map((detail, i) => ({ severity: 'warning', title: ['固定公开小样本', '未复权价格收益', '历史状态字段缺失', '成交与容量假设', '成本假设', '统计与交易口径'][i], detail }));
    issues.push({ severity: 'warning', title: '成交额缺失', detail: '公开源 amount 为 null；公式依赖它会拒绝计算，参与率仅使用前日真实成交量。' });
    if (storageFallbackReason) issues.push({ severity: 'warning', title: '本机存储兼容模式', detail: storageFallbackReason });
    state.notices.forEach(detail => issues.push({ severity: 'warning', title: '初始化信息', detail }));
    if (collection === 'overview') return { factor_count: state.factors.filter(f => !f.deleted).length, native_count: state.factors.filter(f => !f.deleted && f.source_kind === 'native_ast').length, legacy_count: state.factors.filter(f => !f.deleted && f.source_kind === 'legacy').length, run_count: allRuns.length, data_start: parsed.dates[0], data_end: parsed.dates.at(-1), latest_runs: allRuns.sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,5).map(({ result: _, ...r }) => r), health: { api: 'browser', database: storageMode, mode: 'public' }, issues };
    if (collection === 'system') return { mode: 'public', engine: ENGINE_VERSION, ...storageInfo(), running: state.runs.filter(r => r.status === 'running').length, queued: state.runs.filter(r => r.status === 'queued').length, record_count: { factors: state.factors.length, runs: state.runs.length, published_runs_on_demand: publishedRuns.length, reports: state.reports.length }, storage_bytes: new TextEncoder().encode(JSON.stringify(state)).length, storage_size_basis: '当前完整记录序列化为 UTF-8 的大小，不是数据库物理占用或浏览器配额', data_sha256: sha256, source: data.source, capabilities: { python_server: false, cloud_database: false, broker_trading: false, cross_device_sync: false, browser_calculation: true }, issues };
    return { mode: 'public', checked_at: now(), start_date: parsed.dates[0], end_date: parsed.dates.at(-1), dates_count: parsed.dates.length, stock_count: parsed.symbols.length, row_count: parsed.rows, source: data.source, data_sha256: sha256, datasets: [{ name: '公开固定股票样本 · 未复权日线', path: base() + 'research/public-market.json', start: parsed.dates[0], end: parsed.dates.at(-1), status: 'available', rows: parsed.rows, rows_scope: `实际读取全部 ${parsed.rows} 条证券日记录；固定 ${parsed.symbols.length} 股，不代表全 A 股` }], universe: data.universe, issues, sampled_checks: [parsed.dates[0], parsed.dates.at(-1)!].map(date => ({ date, rows: data.bars.filter(b => b.date === date).length, unique_codes: new Set(data.bars.filter(b => b.date === date).map(b => b.symbol)).size, duplicate_keys: 0, missing_ohlcv: 0 })), unit_policy: { open: '元，未复权', high: '元，未复权', low: '元，未复权', close: '元，未复权', volume: '股，原始手数×100', amount: '缺失（null），不参与计算' }, fields: FIELDS, ...storageInfo(), storage_scope: '公式、策略、运行与报告只保存于本浏览器，不自动跨设备同步' };
  }
  if (collection === 'snapshot' && method === 'GET') return completeSnapshot();
  if (collection === 'audit' && method === 'GET') return read().runs.map(r => ({ time: r.created_at, action: r.source_kind === 'published_public_run' ? '公开预计算导入' : '本机提交研究', target: r.id, status: r.status }));
  return fail('公开研究版不支持此接口：' + path, 404);
}
