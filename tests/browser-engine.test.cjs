/* Trusted TypeScript is transpiled for Node tests; factor text never uses eval/Function. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('../node_modules/typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.tsx'] = require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8').replace(/\bimport\.meta\b/g, '({env:{BASE_URL:"/"}})');
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
};
const engine = require('../src/browserEngine.ts');
const rawMarket = fs.readFileSync(path.join(root, 'public/research/public-market.json'), 'utf8');
const market = JSON.parse(rawMarket);
const cfg = { start_date: '2024-01-01', end_date: '2024-03-31', top_n: 3, max_weight: 0.4, corporate_action_mode: 'price_only', exclude_st: false, min_ipo_days: 0 };
const noCost = { commission_bps: 0, slippage_bps: 0, stamp_tax_bps: 0, transfer_fee_bps: 0, min_commission: 0 };

test('restricted parser rejects code injection, future reads, excessive depth and cumulative windows', () => {
  for (const code of [
    "import os\nfactor = close", "factor = eval(close)", "factor = Function(close)", "factor = close.constructor", "factor = close[0]",
    "factor = delay(close, -1)", "n = 1 - 2\nfactor = returns(close, n)", "factor = ts_mean(close, 999999999)",
    "factor = delay(ts_mean(close, 252), 252)", "factor = close ** (10 ** 1000000000)", "factor = close; print(close)", "factor = close constructor",
    "close = volume\nfactor = close", "factor = 1", "factor = __proto__", "factor = close / 0", "factor = " + '-'.repeat(45) + 'close',
  ]) assert.equal(engine.validateCode(code).valid, false, code);
  const parsed = engine.validateCode('window = 20\nx = returns(close, 1)\nfactor = ts_std(x, window)');
  assert.equal(parsed.valid, true); assert.equal(parsed.warmup_days, 20); assert.deepEqual(parsed.dependencies, ['close']);
  assert.equal(engine.validateCode(parsed.code).valid, true);
  assert.deepEqual(engine.validateCode(parsed.code).ast, JSON.parse(JSON.stringify(parsed.ast)));
});

test('all public seeds are causal and a frozen AST cannot diverge from code', () => {
  const { frames } = engine.marketFrames(market), changed = structuredClone(frames), boundary = 300;
  for (const matrix of Object.values(changed)) for (let i = boundary; i < matrix.length; i++) matrix[i] = matrix[i].map((_, j) => 1000000 + i + j);
  for (const factor of engine.publicSeeds()) {
    const before = engine.evaluateCode(factor.code, frames, factor.ast), after = engine.evaluateCode(factor.code, changed, factor.ast);
    assert.deepEqual(before.slice(0, boundary), after.slice(0, boundary));
    const wrong = structuredClone(factor.ast); wrong.output = 'evil';
    assert.throws(() => engine.evaluateCode(factor.code, frames, wrong), /冻结 AST/);
  }
  assert.throws(() => engine.evaluateCode('factor = amount', frames), /完全缺失/);
  assert.ok(engine.evaluateCode('constant = close * 0 + 3.1\nfactor = ts_corr(constant, volume, 3)', frames).every(row => row.every(Number.isNaN)));
});

test('market provenance inputs keep missing amount missing and reject duplicate bars/benchmark', () => {
  const parsed = engine.marketFrames(market); assert.equal(parsed.rows, 5808); assert.equal(parsed.symbols.length, 12);
  assert.ok(parsed.frames.amount.every(row => row.every(Number.isNaN)));
  assert.throws(() => engine.marketFrames({ ...market, bars: [...market.bars, market.bars[0]] }), /重复主键/);
  assert.throws(() => engine.marketFrames({ ...market, benchmark: [...market.benchmark, market.benchmark[0]] }), /基准/);
  assert.throws(() => engine.normalizePublicConfig({ ...cfg, exclude_st: true }, market), /历史 ST/);
  assert.throws(() => engine.normalizePublicConfig({ ...cfg, corporate_action_mode: 'adjusted_units' }, market), /price_only/);
});

test('actual public research obeys next-open timing, fees, integer lots, cash and NAV accounting', async () => {
  const factor = { ...engine.publicSeeds()[0], weight: 1 };
  const result = await engine.runBrowserResearch(market, cfg, [factor]);
  assert.ok(result.trades.length > 0); assert.equal(result.curves[0].nav, 1); assert.equal(result.curves[0].exposure, 0);
  const c = engine.normalizePublicConfig(cfg, market), { dates, symbols, frames } = engine.marketFrames(market);
  let cash = c.initial_cash, fees = 0, slippage = 0; const quantities = new Map();
  for (const curve of result.curves) {
    for (const trade of result.trades.filter(t => t.date === curve.date)) {
      assert.equal(dates.indexOf(trade.execution_date) - dates.indexOf(trade.signal_date), 1);
      assert.equal(trade.quantity % 100, 0); assert.ok(trade.quantity > 0);
      const j = symbols.indexOf(trade.ts_code), prior = dates.indexOf(trade.date) - 1;
      assert.ok(trade.quantity <= Math.floor(frames.volume[prior][j] * c.max_participation / 100) * 100);
      const buy = trade.side === '买入';
      const expectedFee = Math.max(c.min_commission, trade.amount * c.commission_bps / 10000) + trade.amount * c.transfer_fee_bps / 10000 + (buy ? 0 : trade.amount * c.stamp_tax_bps / 10000);
      assert.ok(Math.abs(expectedFee - trade.fees) < 1e-7);
      cash += buy ? -trade.amount - trade.fees : trade.amount - trade.fees;
      quantities.set(trade.ts_code, (quantities.get(trade.ts_code) || 0) + (buy ? trade.quantity : -trade.quantity));
      assert.ok(cash >= -1e-7); assert.ok(Math.abs(cash - trade.cash_after) < 1e-6);
      fees += trade.fees; slippage += trade.slippage_cost;
    }
    const i = dates.indexOf(curve.date), value = cash + [...quantities].reduce((sum, [symbol, quantity]) => sum + quantity * frames.close[i][symbols.indexOf(symbol)], 0);
    assert.ok(Math.abs(value / c.initial_cash - curve.nav) < 1e-10);
  }
  assert.ok(Math.abs(fees + slippage - result.metrics.total_cost) < 1e-7);
  assert.ok(result.ic.length > 0); assert.ok(result.groups.length > 0); assert.ok(result.warnings.some(x => x.includes('幸存者偏差')));
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('future shocks do not change earlier trades/NAV and missing quotes retain held securities', async () => {
  const factor = { ...engine.publicSeeds()[1], weight: 1 }, altered = structuredClone(market);
  for (const bar of altered.bars) if (bar.date >= '2024-03-01') for (const field of ['open', 'high', 'low', 'close']) bar[field] *= 10;
  const before = await engine.runBrowserResearch(market, cfg, [factor]), after = await engine.runBrowserResearch(altered, cfg, [factor]);
  assert.deepEqual(before.trades.filter(x => x.date < '2024-03-01'), after.trades.filter(x => x.date < '2024-03-01'));
  assert.deepEqual(before.curves.filter(x => x.date < '2024-03-01'), after.curves.filter(x => x.date < '2024-03-01'));
  const simple = { id: 'test_price', name: '测试价格选择', version: 1, source_kind: 'native_ast', ...engine.validateCode('factor = close') };
  const missing = { ...market, bars: market.bars.filter(b => !(b.date === '2024-03-29' && b.symbol === '600519.SH')) };
  const result = await engine.runBrowserResearch(missing, { ...cfg, top_n: 1, max_weight: 1 }, [simple]);
  assert.ok(result.holdings.some(x => x.ts_code === '600519.SH' && x.stale));
  assert.ok(result.metrics.stale_valuation_days > 0);
});

test('zero-cost configuration reports zero cost and explicit charges are positive', async () => {
  const factor = { ...engine.publicSeeds()[0], weight: 1 };
  const free = await engine.runBrowserResearch(market, { ...cfg, ...noCost }, [factor]);
  const charged = await engine.runBrowserResearch(market, cfg, [factor]);
  assert.equal(free.metrics.total_cost, 0); assert.ok(charged.metrics.total_cost > 0);
  assert.ok(charged.trades.every(x => x.cost > 0));
});

class MemoryStorage {
  data = new Map(); limit = Infinity;
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { if (value.length > this.limit) throw new Error('QuotaExceeded'); this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
test('public API imports only verified public cases, preserves revisions, computes runs and exports snapshots', async () => {
  global.localStorage = new MemoryStorage(); global.sessionStorage = new MemoryStorage();
  // Node 24 exposes a process-wide experimental Web Locks implementation;
  // browser persistence is simulated here, so use the same callback contract.
  Object.defineProperty(global, 'navigator', { value: { locks: { request: async (_name, callback) => callback() } }, configurable: true });
  if (!global.crypto) global.crypto = crypto.webcrypto;
  global.fetch = async url => { const name = String(url).split('/research/')[1]; const file = path.join(root, 'public/research', name); return fs.existsSync(file) ? new Response(fs.readFileSync(file), { status: 200 }) : new Response('', { status: 404 }); };
  const { publicRequest } = require('../src/publicApi.ts');
  assert.equal((await publicRequest('/session')).mode, 'public');
  const factors = await publicRequest('/factors'); const alphaCatalog=JSON.parse(fs.readFileSync(path.join(root,'public/research/alpha101.json'))); const workCatalog=JSON.parse(fs.readFileSync(path.join(root,'public/research/work-catalog.json'))); assert.equal(factors.length,engine.publicSeeds().length+alphaCatalog.factors.length+workCatalog.factors.length); assert.ok(factors.some(f=>f.source_kind==='native_ast')); assert.ok(factors.some(f=>f.id==='alpha101_001')); 
  const published = JSON.parse(fs.readFileSync(path.join(root, 'public/research/public-runs.json')));
  const initialRuns = await publicRequest('/runs'); assert.equal(initialRuns.length, published.runs.length + JSON.parse(fs.readFileSync(path.join(root,'public/research/alpha101-runs.json'))).runs.length); assert.ok(initialRuns.every(r => r.source_kind === 'published_public_run'));
  const options = await publicRequest('/research/options');
  assert.equal(options.universes.length, 1); assert.equal(options.universes[0].id, 'public_sample'); assert.equal(options.universes[0].stock_count, 12);
  assert.equal(options.benchmarks.length, 1); assert.equal(options.benchmarks[0].id, 'index:000300.SH');
  assert.ok(options.available_fields.includes('volume')); assert.ok(!options.available_fields.includes('amount')); assert.ok(!options.available_fields.includes('vwap'));
  const work = factors.find(f => f.source_kind === 'legacy');
  const draft = await publicRequest('/strategies', 'POST', { name: 'work研究设计可保存但不伪造执行', config: { ...cfg, factors: [{factor_id: work.id, weight: 1}] } });
  assert.equal(draft.config.factors[0].factor_id, work.id);
  const missing = await publicRequest('/research/preflight', 'POST', { kind:'strategy', config:{...cfg, factors:[{factor_id:'alpha101_005',weight:1}]} });
  assert.equal(missing.ready,false); assert.deepEqual(missing.factors[0].missing_fields,['vwap']);
  await assert.rejects(publicRequest('/runs','POST',{name:'缺字段不建任务',kind:'factor',config:{...cfg,factor_id:'alpha101_005'}}),/vwap/);
  await assert.rejects(publicRequest('/runs','POST',{name:'work原值不在浏览器',kind:'strategy',config:draft.config}),/本地引擎/);
  const ignored = await publicRequest('/research/preflight','POST',{kind:'strategy',config:{...cfg,factors:[{factor_id:factors[1].id,weight:2},{factor_id:work.id,weight:0},{factor_id:'alpha101_005',weight:0}]}});
  assert.equal(ignored.ready,true); assert.equal(ignored.factors.length,3); assert.ok(ignored.factors.slice(1).every(f=>f.reason.includes('0权重')));
  await assert.rejects(publicRequest('/runs','POST',{name:'非法股票池',kind:'factor',config:{...cfg,factor_id:factors[1].id,universe_id:'all_a'}}),/public_sample/);
  await assert.rejects(publicRequest('/strategies','POST',{name:'非法基准',config:{...cfg,factor_id:factors[1].id,benchmark_id:'index:000905.SH'}}),/index:000300.SH/);
  const original = await publicRequest('/factors/' + factors[0].id);
  const changed = await publicRequest('/factors/' + original.id, 'PUT', { name: original.name, category: original.category, description: '测试版本，不影响历史结果', code: original.code, base_version: 1 });
  assert.equal(changed.version, 2); assert.equal(changed.versions.length, 2);
  await assert.rejects(publicRequest('/factors/' + original.id, 'PUT', { name: original.name, code: original.code, base_version: 1 }), /版本已更新/);
  const run = await publicRequest('/runs', 'POST', { name: '真实公开小区间测试', kind: 'factor', config: { ...cfg, factor_id: factors[1].id, factors: [{factor_id:factors[1].id,weight:2},{factor_id:work.id,weight:0},{factor_id:'alpha101_005',weight:0}] } });
  let result;
  for (let attempt = 0; attempt < 100; attempt++) { result = await publicRequest('/runs/' + run.id); if (['completed', 'failed', 'cancelled'].includes(result.status)) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(result.status, 'completed', result.error); assert.ok(result.result.trades.length > 0);
  assert.equal(result.config.factor_versions.length,1); assert.equal(result.factor_specs.length,1); assert.equal(result.result.benchmark.id,'index:000300.SH');
  assert.ok(result.config.signal_weight_definition.includes('无量纲'));
  const frozenBefore=JSON.stringify(result.result), comparison=await publicRequest('/runs/'+run.id+'/benchmark?benchmark_id=index%3A000300.SH');
  assert.equal(comparison.comparison_only,true); assert.equal(comparison.curves[0].benchmark,1); assert.equal(comparison.curves.length,result.result.curves.length);
  const frozenMarket=(await publicRequest('/runs/'+run.id+'/export')).data, closes=new Map(frozenMarket.benchmark.map(row=>[row.date,row.close]));
  assert.equal(comparison.curves.at(-1).benchmark,closes.get(result.result.curves.at(-1).date)/closes.get(result.result.curves[0].date));
  assert.equal(JSON.stringify((await publicRequest('/runs/'+run.id)).result),frozenBefore);
  await assert.rejects(publicRequest('/runs/'+run.id+'/benchmark?benchmark_id=unknown'),/只提供/);
  const report = await publicRequest('/reports', 'POST', { title: '真实测试运行报告', run_id: run.id, body: '此记录用于验证本机持久化流程' }); assert.equal(report.version, 1);
  const exported = await publicRequest('/runs/' + run.id + '/export'); assert.equal(exported.data.bars.length, 5808); assert.equal(exported.run.config.factor_versions[0].version, 1);
  const snapshot = await publicRequest('/snapshot'); assert.ok(snapshot.state.factors.find(f => f.id === original.id).versions.length === 2); assert.ok(snapshot.state.datasets[result.market_sha256]);
  const beforeQuota = localStorage.getItem('singularityx.public.research.v1'); localStorage.limit = 1;
  await assert.rejects(publicRequest('/reports', 'POST', { title: '不应成功写入', run_id: run.id, body: 'quota' }), /容量已满/);
  assert.equal(localStorage.getItem('singularityx.public.research.v1'), beforeQuota); localStorage.limit = Infinity;
});


test('backend evidence retains missing sessions, independent cohort returns and frozen annualization', () => {
  const { backendEvidence } = require('../src/FactorEvidence.tsx');
  const result = {
    curves: [{date:'2024-01-02',nav:1,benchmark:1},{date:'2024-01-03',nav:1.1,benchmark:1.01},{date:'2024-01-04',nav:1.05,benchmark:1.02}],
    ic: [{date:'2024-01-02',ic:.2,rank_ic:.3},{date:'2024-01-04',ic:.4,rank_ic:.1}],
    groups: [{date:'2024-01-02',Q1:1.1,Q2:1},{date:'2024-01-03',Q1:null,Q2:null},{date:'2024-01-04',Q1:null,Q2:null}],
    metrics: {annualized_return:3,total_return:.05,max_drawdown:-.1,sortino:2,calmar:30},
    monthly: [{month:'2024-01',return:.05,days:3}],yearly:[{year:'2024',return:.05,days:3}],
    diagnostics: {
      coverage:[{date:'2024-01-02'},{date:'2024-01-03'},{date:'2024-01-04'}],
      group_returns:[{date:'2024-01-02',Q1:.1,Q2:0},{date:'2024-01-03',Q1:null,Q2:null},{date:'2024-01-04',Q1:.2,Q2:.4}],
      group_turnover:[{date:'2024-01-02',Q1:1,Q2:1},{date:'2024-01-03',Q1:.2,Q2:.4},{date:'2024-01-04',Q1:.3,Q2:.5}],
    }
  };
  const before=JSON.stringify(result),a=backendEvidence(result);
  assert.equal(JSON.stringify(result),before);
  assert.equal(a.ic.daily.length,3);assert.equal(a.ic.daily[1].ic,null);assert.equal(a.ic.summary.ic.count,2);
  assert.equal(a.groups.summary[0].observations,2);assert.equal(a.groups.summary[0].missing_periods,1);
  assert.equal(a.groups.summary[0].cumulative_return,null);assert.equal(a.groups.summary[0].mean_turnover,.5);
  assert.ok(Math.abs(a.groups.summary[0].mean_return-.15)<1e-14);
  assert.ok(Math.abs(a.groups.monotonicity-1)<1e-14);assert.equal(a.groups.strictly_increasing,true);assert.equal(a.groups.long_short[2].return,.2);
  assert.equal(a.metrics.annual_return,3);assert.equal(a.performance.metrics.annual_return,3);assert.equal(a.metrics.sortino,2);assert.equal(a.metrics.calmar,30);
  assert.equal(a.performance.monthly[0].return,.05);assert.equal(a.performance.yearly[0].observations,3);
  assert.equal(a.unavailable.group_turnover,undefined);assert.ok(a.groups.reason.includes('缺失'));
  const old=structuredClone(result);delete old.diagnostics.group_returns;const older=backendEvidence(old);assert.equal(older.metrics.annual_return,3);assert.equal(older.performance.monthly[0].return,.05);
});
