/* Public fixtures only: startup, deferred evidence and preservation of local revisions. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('../node_modules/typescript');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'public/research');
const KEY = 'singularityx.public.research.v1';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\b/g, '({env:{BASE_URL:"/",VITE_PUBLIC_MODE:"true"}})');
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
};
const fixture = name => JSON.parse(fs.readFileSync(path.join(assets, name), 'utf8'));
class Storage {
  constructor() { this.data = new Map(); this.reads = 0; this.writes = 0; }
  getItem(key) { this.reads++; return this.data.get(key) ?? null; }
  setItem(key, value) { this.writes++; this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
function mockIDB() {
  const records = new Map(); let created = false;
  const database = {
    objectStoreNames: { contains: () => created }, createObjectStore() { created = true; }, close() {},
    transaction() {
      const transaction = {};
      transaction.objectStore = () => ({
        get(key) { const request = {}; queueMicrotask(() => { request.result = records.has(key) ? structuredClone(records.get(key)) : undefined; request.onsuccess?.(); transaction.oncomplete?.(); }); return request; },
        put(value, key) { queueMicrotask(() => { records.set(key, structuredClone(value)); transaction.oncomplete?.(); }); }
      }); return transaction;
    }
  };
  return { records, open() { const request = { result: database }; queueMicrotask(() => { if (!created) request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; } };
}
function setup({ existing, idb, fetchTransform } = {}) {
  delete require.cache[require.resolve('../src/publicApi.ts')];
  delete require.cache[require.resolve('../src/api.ts')];
  global.localStorage = new Storage(); global.sessionStorage = new Storage();
  if (existing) localStorage.setItem(KEY, JSON.stringify(existing));
  Object.defineProperty(global, 'indexedDB', { value: idb, configurable: true });
  let lock = Promise.resolve();
  Object.defineProperty(global, 'navigator', { value: { locks: { request(_name, callback) { const result = lock.then(callback, callback); lock = result.then(() => undefined, () => undefined); return result; } } }, configurable: true });
  if (!global.crypto) global.crypto = crypto.webcrypto;
  const fetched = [];
  global.fetch = async url => {
    const name = String(url).split('/research/')[1]; fetched.push(name);
    const file = path.join(assets, name || 'missing');
    let raw = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (fetchTransform) raw = await fetchTransform(name, raw);
    return new Response(raw, { status: raw === null ? 404 : 200 });
  };
  return { fetched, request: (...args) => require('../src/publicApi.ts').publicRequest(...args) };
}

test('public session returns without importing research adapter, fetching assets or opening storage', async () => {
  const env = setup();
  const { api } = require('../src/api.ts');
  assert.equal((await api('/session')).mode, 'public');
  assert.equal(require.cache[require.resolve('../src/publicApi.ts')], undefined);
  assert.equal((await env.request('/session')).authenticated, true);
  assert.deepEqual(env.fetched, []);
  assert.equal(localStorage.reads, 0); assert.equal(localStorage.writes, 0);
});

test('cold factor and run lists fetch only the compact index and keep metrics unchanged', async () => {
  const env = setup();
  const [factors, runs] = await Promise.all([env.request('/factors'), env.request('/runs')]);
  assert.equal(factors.length, 227); assert.equal(runs.length, 46);
  assert.deepEqual(env.fetched, ['catalog-index.json']);
  assert.ok(fs.statSync(path.join(assets, 'catalog-index.json')).size < 500000);
  const work = factors.find(f => f.source_kind === 'legacy');
  assert.equal(work.code, undefined); assert.equal(work.ast, undefined);
  const index = fixture('catalog-index.json');
  for (const [name, source] of Object.entries(index.sources)) assert.equal(source.sha256, sha(fs.readFileSync(path.join(assets, name))));
  for (const run of fixture('public-runs.json').runs) assert.deepEqual(runs.find(r => r.id === run.id).metrics, run.metrics);
  const saved = JSON.parse(localStorage.getItem(KEY));
  assert.deepEqual(saved.datasets, {}); assert.equal(saved.runs.length, 0);
  assert.ok(saved.factors.find(f => f.id === work.id)._catalog_stub);
});

test('definition and result detail load their own asset once, without loading market data', async () => {
  const env = setup();
  const factors = await env.request('/factors');
  const alpha = await env.request('/factors/alpha101_001');
  assert.equal(alpha.code_hash, sha(alpha.code)); assert.equal(alpha.versions.length, 1);
  assert.ok(alpha.ast); assert.equal(alpha._catalog_stub, undefined);
  await env.request('/factors/alpha101_002');
  assert.deepEqual(env.fetched, ['catalog-index.json', 'alpha101.json']);
  const work = factors.find(f => f.source_kind === 'legacy');
  assert.ok((await env.request('/factors/' + work.id)).code);
  const original = fixture('public-runs.json').runs[0];
  const detail = await env.request('/runs/' + original.id);
  assert.deepEqual(detail.result, original.result);
  await env.request('/runs/' + original.id);
  assert.equal(env.fetched.filter(x => x === 'public-runs.json').length, 1);
  assert.ok(!env.fetched.includes('public-market.json'));
});

test('delete and restore hydrate a stub before recording complete immutable versions', async () => {
  const env = setup(); await env.request('/factors');
  const deleted = await env.request('/factors/alpha101_001', 'DELETE', { base_version: 1 });
  assert.equal(deleted.deleted, true); assert.equal(deleted.version, 2);
  assert.equal(deleted.versions.length, 2); assert.ok(deleted.versions.every(v => v.code && v.ast));
  const restored = await env.request('/factors/alpha101_001', 'PUT', { deleted: false, base_version: 2 });
  assert.equal(restored.deleted, false); assert.equal(restored.version, 3);
  await assert.rejects(env.request('/factors/alpha101_001', 'DELETE', { base_version: 1 }), /版本已更新/);
});

function oldState() {
  const original = fixture('alpha101.json').factors[0], code = 'factor = -returns(close, 5)';
  const saved = { ...original, name: '本机私有修订（测试）', description: '保留我的说明', implementation_notes: '已有完整实现说明', code, code_hash: sha(code), version: 2, deleted: true, ast: { fixture: 'preserve my exact stored AST' }, versions: [original, { ...original, version: 2, code, code_hash: sha(code) }] };
  return { schema: 1, created_at: '2024-01-01', factors: [saved], strategies: [{ id: 'mine', config: { factor_id: saved.id }, version: 1 }],
    runs: [{ id: 'local-fixture', status: 'completed', created_at: '2024-01-02', result: { preserved: true }, factor_specs: [{ code }], config: {} }], reports: [], datasets: { 'my-frozen-data': { fixture: true } }, notices: [] };
}
test('old localStorage migrates to IDB without losing edits, tombstones, frozen results or versions', async () => {
  const existing = oldState(), idb = mockIDB(), env = setup({ existing, idb });
  const factors = await env.request('/factors');
  assert.equal(localStorage.getItem(KEY), null); assert.deepEqual(env.fetched, ['catalog-index.json']);
  const original = existing.factors[0], summary = factors.find(f => f.id === original.id);
  assert.equal(summary.code, original.code); assert.equal(summary.deleted, true); assert.equal(summary.version, 2);
  const detail = await env.request('/factors/' + original.id);
  for (const key of ['code', 'ast', 'name', 'description', 'implementation_notes', 'version', 'deleted', 'versions']) assert.deepEqual(detail[key], original[key]);
  assert.deepEqual(idb.records.get(KEY).runs, existing.runs);
  assert.deepEqual(idb.records.get(KEY).datasets, existing.datasets);
  assert.deepEqual(idb.records.get(KEY).strategies, existing.strategies);
});

test('an existing unedited full definition keeps fields absent from the compact index', async () => {
  const existing = oldState(), original = fixture('alpha101.json').factors[0];
  existing.factors = [{ ...original, implementation_notes: '完整说明不能被摘要中缺失字段删除', versions: [original] }];
  const env = setup({ existing });
  const list = await env.request('/factors');
  assert.equal(list.find(f => f.id === original.id).implementation_notes, existing.factors[0].implementation_notes);
  assert.equal((await env.request('/factors/' + original.id)).implementation_notes, existing.factors[0].implementation_notes);
});

test('a concurrent local revision is not replaced by a deferred public definition', async () => {
  let changed;
  const env = setup({ fetchTransform(name, raw) {
    if (name === 'alpha101.json') {
      const state = JSON.parse(localStorage.getItem(KEY)), target = state.factors.find(f => f.id === 'alpha101_001');
      Object.assign(target, { version: 2, code: 'factor = close', code_hash: sha('factor = close'), name: '并发修改', ast: { fixture: 'private' }, versions: [{ version: 2, code: 'factor = close' }] });
      delete target._catalog_stub; changed = structuredClone(target); localStorage.setItem(KEY, JSON.stringify(state));
    }
    return raw;
  } });
  await env.request('/factors');
  const detail = await env.request('/factors/alpha101_001');
  for (const key of ['name', 'version', 'code', 'ast', 'versions']) assert.deepEqual(detail[key], changed[key]);
});

test('changed asset fingerprints fail closed without replacing stored definitions', async () => {
  const env = setup({ fetchTransform: (name, raw) => name === 'alpha101.json' ? Buffer.concat([raw, Buffer.from('\n')]) : raw });
  await env.request('/factors');
  const before = localStorage.getItem(KEY);
  await assert.rejects(env.request('/factors/alpha101_001'), /指纹不匹配/);
  assert.equal(localStorage.getItem(KEY), before);
});

test('explicit complete export resolves evidence without inflating persisted browser state', async () => {
  const env = setup(); await env.request('/factors');
  const before = localStorage.getItem(KEY), snapshot = await env.request('/snapshot');
  assert.equal(snapshot.state.factors.length, 227);
  assert.ok(snapshot.state.factors.every(f => typeof f.code === 'string' && f.ast && f.versions.length));
  assert.equal(snapshot.state.runs.length, 46); assert.ok(snapshot.state.runs.every(r => r.result && r.factor_specs));
  assert.equal(Object.keys(snapshot.state.datasets).length, 1);
  assert.equal(localStorage.getItem(KEY), before);
  assert.equal(env.fetched.filter(name => name === 'public-runs.json').length, 1);
  assert.equal(env.fetched.filter(name => name === 'public-market.json').length, 1);
});
