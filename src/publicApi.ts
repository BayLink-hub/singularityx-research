/** Same application contract, public data only, with explicit browser-local persistence. */
import { ENGINE_VERSION, FIELDS, jsonSafe, marketFrames, normalizePublicConfig, publicOperators, publicSeeds, publicWarnings, runBrowserResearch, validateCode, type PublicMarket, type Row } from './browserEngine';

const STORAGE_KEY = 'singularityx.public.research.v1';
const DATABASE_NAME = 'singularityx-public-research';
const OBJECT_STORE = 'state';
const TAB_KEY = 'singularityx.public.tab.v1';
type State = { schema: number; created_at: string; factors: Row[]; strategies: Row[]; runs: Row[]; reports: Row[]; datasets: Record<string, PublicMarket>; notices: string[] };
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
    if (found) return;
    const factors = await Promise.all(publicSeeds().map(async f => { const value = { ...f, code_hash: await hashText(f.code) }; return { ...value, versions: [{ ...value }] }; }));
    const state: State = { schema: 1, created_at: now(), factors, strategies: [], runs: [], reports: [], datasets: {}, notices: [] };
    try {
      const response = await fetch(base() + 'research/public-runs.json', { cache: 'no-cache' });
      if (response.ok) {
        const bundle = await response.json(), market = await publicMarket();
        if (bundle.schema !== 'quant.public.runs' || bundle.version !== 1 || bundle.data_sha256 !== market.sha256 || !Array.isArray(bundle.runs)) throw new Error('公开预计算包版本或行情指纹不匹配');
        const seeds = new Map(state.factors.map(f => [f.id, f]));
        for (const original of bundle.runs) {
          if (original.status !== 'completed' || !original.result?.curves?.length || !original.result?.provenance || !original.id || !original.created_at || !Array.isArray(original.factor_specs) || !original.factor_specs.length) throw new Error('预计算记录缺少真实结果或冻结定义');
          for (const f of original.factor_specs) { const seed = seeds.get(f.id), validation = validateCode(f.code); if (!seed || !validation.valid || seed.code !== validation.code || JSON.stringify(seed.ast) !== JSON.stringify(f.ast)) throw new Error('预计算因子定义不匹配'); }
          state.runs.push({ ...original, progress: 100, source_kind: 'published_public_run', message: '公开数据预计算 · 非用户在本机提交', market_sha256: market.sha256, config: { ...original.config, sample_status: '公开固定样本预计算研究；非用户提交或独立样本外验证' } });
        }
        for (const report of bundle.reports || []) if (state.runs.some(r => r.id === report.run_id) && report.id && report.title) state.reports.push({ ...report, source_kind: 'published_public_run', version: report.version || 1, versions: [report] });
        state.datasets[market.sha256] = market.data;
      } else if (response.status !== 404) state.notices.push(`公开预计算包未读取（${response.status}），可自行提交真实计算。`);
    } catch (e) { state.runs = []; state.reports = []; state.datasets = {}; state.notices.push('未导入公开预计算包：' + (e instanceof Error ? e.message : String(e))); }
    await storageLock(async () => {
      const existing = await loadStored();
      if (existing) { cachedState = clone(existing); return; }
      // A different tab may have written an older-format record while sources loaded.
      const legacy = storageMode === 'IndexedDB' ? localState() : undefined;
      const value = legacy || state;
      await persist(value); cachedState = clone(value);
      if (legacy) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* Keep the backup if its removal is denied. */ } }
    });
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
  const latest = state.runs.filter(r => r.status === 'completed' && r.kind === 'factor' && r.config?.factor_versions?.length === 1 && r.config.factor_versions[0].id === factor.id && r.config.factor_versions[0].version === factor.version).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const { versions: _versions, ...value } = factor;
  return { ...value, metrics: latest?.metrics || null, latest_metrics: latest?.metrics || null, latest_run_id: latest?.id || null, latest_run_source: latest?.source_kind || null, status: latest ? 'evaluated' : 'ready' };
}
function entries(config: Row, state: State): Row[] {
  const selected = config.factors || [{ factor_id: config.factor_id, weight: 1 }];
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 8 || new Set(selected.map(x => x.factor_id)).size !== selected.length) return fail('请选择1–8个不重复的原生因子');
  const result = selected.map(entry => { const f = lookup(state.factors, entry.factor_id), weight = entry.weight ?? 1; if (typeof weight !== 'number' || !Number.isFinite(weight) || Math.abs(weight) > 100) return fail('因子权重须为 −100 至 100 的有限数'); const parsed = validateCode(f.code); if (!parsed.valid || JSON.stringify(parsed.ast) !== JSON.stringify(f.ast)) return fail('持久化因子代码与 AST 不一致'); const { versions: _, ...snapshot } = f; return { ...snapshot, weight }; });
  if (result.every(f => f.weight === 0)) return fail('因子权重不能全部为零'); return result;
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
    result.provenance.market_sha256 = run.market_sha256;
    result.provenance.storage = storageMode + '，仅保存在当前浏览器，不自动同步其他设备';
    await mutate(s => { const r = lookup(s.runs, runId); if (r.status !== 'cancelled') Object.assign(r, { status: 'completed', progress: 100, message: '公开行情真实计算完成 · 本机保存', result, metrics: result.metrics, finished_at: now(), updated_at: now() }); return r; });
  } catch (e) {
    const cause = persistenceError || e, message = cause instanceof Error ? cause.message : String(cause);
    try { await mutate(s => { const r = lookup(s.runs, runId); if (r.status !== 'cancelled') Object.assign(r, { status: 'failed', message, error: message, finished_at: now() }); return r; }); } catch (storageError) { unsavedFailures.set(runId, message + '；' + (storageError instanceof Error ? storageError.message : String(storageError))); }
  } finally { running.delete(runId); }
}

export async function publicRequest(path: string, method = 'GET', body: any = undefined, signal?: AbortSignal): Promise<any> {
  await initialize(); await hydrate(); if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const parts = path.split('?')[0].split('/').filter(Boolean), [collection, identifier, action] = parts;
  if (collection === 'session') return { mode: 'public', authenticated: true, username: '本机研究员', role: 'researcher', ...storageInfo(), note: '公开研究版 · 本机保存；无账号服务器、跨设备同步或私有研究数据' };
  if (collection === 'login' || collection === 'logout') return fail('公开研究版没有账号服务器；本机记录通过浏览器存储保存');
  if (collection === 'operators') return publicOperators();
  if (collection === 'factors' && identifier === 'validate' && method === 'POST') return validateCode(text(body?.code, '代码', 12000));
  if (collection === 'factors') {
    if (method === 'GET') { const state = read(); if (!identifier) return state.factors.map(f => factorSummary(f, state)); if (action === 'history') return fail('公开研究版没有私有历史因子或原始回测归档', 404); const factor = lookup(state.factors, identifier); return { ...factorSummary(factor, state), versions: factor.versions }; }
    if (method === 'POST' || method === 'PUT') {
      const name = text(body?.name, '名称', 160), category = text(body?.category || '自定义', '分类', 80), description = text(body?.description || '', '说明', 5000, false), parsed = validateCode(text(body?.code, '代码', 12000));
      if (!parsed.valid) return fail(parsed.errors.join('；')); const code_hash = await hashText(parsed.code);
      return mutate(state => record(state.factors, { name, category, description, ...parsed, code_hash, source_kind: 'native_ast', source_path: '公开浏览器 AST 编辑器', status: 'ready', limitations: publicWarnings.slice(0, 2), metrics: null }, 'factor', method === 'PUT' ? identifier : undefined, body.base_version));
    }
  }
  if (collection === 'strategies') {
    if (method === 'GET') return read().strategies;
    if (method === 'POST' || method === 'PUT') { const { data } = await publicMarket(); const config = normalizePublicConfig({ ...body?.config, kind: 'strategy' }, data); return mutate(state => { entries(config, state); return record(state.strategies, { name: text(body?.name, '名称', 160), description: text(body?.description || '', '说明', 5000, false), config }, 'strategy', method === 'PUT' ? identifier : undefined, body.base_version); }); }
  }
  if (collection === 'runs') {
    if (method === 'GET') {
      const state = read(); if (!identifier) return state.runs.map(({ result: _, factor_specs: __, ...run }) => run).sort((a, b) => b.created_at.localeCompare(a.created_at));
      const run = lookup(state.runs, identifier); if (action === 'export') { if (run.status !== 'completed') return fail('任务尚未完成', 409); return { schema: 'quant.public.run', version: 1, exported_at: now(), run, data: state.datasets[run.market_sha256] }; } return run;
    }
    if (action === 'cancel' && method === 'POST') { const control = running.get(identifier); if (control) control.cancelled = true; return mutate(state => { const run = lookup(state.runs, identifier); if (!['queued', 'running'].includes(run.status)) return fail('任务已经结束', 409); Object.assign(run, { status: 'cancelled', message: '用户取消', finished_at: now() }); return run; }); }
    if (method === 'POST' && !identifier) {
      const { data, sha256 } = await publicMarket(), config = normalizePublicConfig({ ...body?.config, kind: body?.kind }, data), name = text(body?.name, '任务名称', 160), specs = entries(config, read());
      const factor_versions = await Promise.all(specs.map(async f => ({ id: f.id, version: f.version, weight: f.weight, code_hash: await hashText(f.code) })));
      const run = await mutate(state => { if (state.runs.filter(r => ['queued', 'running'].includes(r.status)).length >= 3) return fail('最多同时排队3个浏览器任务，请等待或取消', 429); const latest = entries(config, state); if (latest.some((f, i) => f.version !== specs[i].version)) return fail('因子刚被修改，请重新提交', 409); state.datasets[sha256] = data; const stamp = now(); const value: Row = { id: id('run'), name, kind: config.kind, status: 'queued', progress: 0, message: '已冻结参数，等待浏览器计算', created_at: stamp, updated_at: stamp, finished_at: null, source_kind: 'browser_public_run', owner_tab: tabId, market_sha256: sha256, config: { ...config, factor_versions, sample_status: '固定公开小样本探索；非独立样本外验证' }, factor_specs: clone(specs), metrics: null, result: null }; state.runs.push(value); return value; });
      setTimeout(() => { void calculate(run.id); }, 0); return run;
    }
  }
  if (collection === 'reports') {
    if (method === 'GET') return read().reports;
    if (method === 'POST' || method === 'PUT') return mutate(state => { const old = method === 'PUT' ? lookup(state.reports, identifier) : undefined, runId = old?.run_id || body?.run_id; if (lookup(state.runs, runId).status !== 'completed') return fail('报告必须关联一项已完成的真实研究'); return record(state.reports, { title: text(body?.title, '标题', 160), body: text(body?.body || '', '正文', 50000, false), run_id: runId, author: '本机研究员', source_kind: 'browser_public_report' }, 'report', method === 'PUT' ? identifier : undefined, body.base_version); });
  }
  if (collection === 'overview' || collection === 'data' || collection === 'system') {
    const { data, sha256 } = await publicMarket(), parsed = marketFrames(data), state = read();
    const issues = publicWarnings.map((detail, i) => ({ severity: 'warning', title: ['固定公开小样本', '未复权价格收益', '历史状态字段缺失', '成交与容量假设', '成本假设', '统计与交易口径'][i], detail }));
    issues.push({ severity: 'warning', title: '成交额缺失', detail: '公开源 amount 为 null；公式依赖它会拒绝计算，参与率仅使用前日真实成交量。' });
    if (storageFallbackReason) issues.push({ severity: 'warning', title: '本机存储兼容模式', detail: storageFallbackReason });
    state.notices.forEach(detail => issues.push({ severity: 'warning', title: '初始化信息', detail }));
    if (collection === 'overview') return { factor_count: state.factors.length, native_count: state.factors.length, legacy_count: 0, run_count: state.runs.length, data_start: parsed.dates[0], data_end: parsed.dates.at(-1), latest_runs: state.runs.slice(-5).reverse().map(({ result: _, ...r }) => r), health: { api: 'browser', database: storageMode, mode: 'public' }, issues };
    if (collection === 'system') return { mode: 'public', engine: ENGINE_VERSION, ...storageInfo(), running: state.runs.filter(r => r.status === 'running').length, queued: state.runs.filter(r => r.status === 'queued').length, record_count: { factors: state.factors.length, runs: state.runs.length, reports: state.reports.length }, storage_bytes: new TextEncoder().encode(JSON.stringify(state)).length, storage_size_basis: '当前完整记录序列化为 UTF-8 的大小，不是数据库物理占用或浏览器配额', data_sha256: sha256, source: data.source, capabilities: { python_server: false, cloud_database: false, broker_trading: false, cross_device_sync: false, browser_calculation: true }, issues };
    return { mode: 'public', checked_at: now(), start_date: parsed.dates[0], end_date: parsed.dates.at(-1), dates_count: parsed.dates.length, stock_count: parsed.symbols.length, row_count: parsed.rows, source: data.source, data_sha256: sha256, datasets: [{ name: '公开固定股票样本 · 未复权日线', path: base() + 'research/public-market.json', start: parsed.dates[0], end: parsed.dates.at(-1), status: 'available', rows: parsed.rows, rows_scope: `实际读取全部 ${parsed.rows} 条证券日记录；固定 ${parsed.symbols.length} 股，不代表全 A 股` }], universe: data.universe, issues, sampled_checks: [parsed.dates[0], parsed.dates.at(-1)!].map(date => ({ date, rows: data.bars.filter(b => b.date === date).length, unique_codes: new Set(data.bars.filter(b => b.date === date).map(b => b.symbol)).size, duplicate_keys: 0, missing_ohlcv: 0 })), unit_policy: { open: '元，未复权', high: '元，未复权', low: '元，未复权', close: '元，未复权', volume: '股，原始手数×100', amount: '缺失（null），不参与计算' }, fields: FIELDS, ...storageInfo(), storage_scope: '公式、策略、运行与报告只保存于本浏览器，不自动跨设备同步' };
  }
  if (collection === 'snapshot' && method === 'GET') return { schema: 'quant.public.snapshot', version: 1, exported_at: now(), ...storageInfo(), storage_scope: '浏览器本机；包含全部历史版本、行情快照和运行结果', state: read() };
  if (collection === 'audit' && method === 'GET') return read().runs.map(r => ({ time: r.created_at, action: r.source_kind === 'published_public_run' ? '公开预计算导入' : '本机提交研究', target: r.id, status: r.status }));
  return fail('公开研究版不支持此接口：' + path, 404);
}
