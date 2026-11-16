/** Reproduce fixed published cases with the same browser interpreter, market and analytics.
 * No private paths/data, optimization, result filtering or substitution of missing fields.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const frontend = fs.existsSync(path.join(root, 'frontend/src')) ? path.join(root, 'frontend') : root;
const research = path.join(frontend, 'public/research');
const ts = require(path.join(frontend, 'node_modules/typescript'));
// Only trusted project TypeScript is compiled; factor strings use the whitelist interpreter.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const engine = require(path.join(frontend, 'src/browserEngine.ts'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const source_hashes = Object.fromEntries(['browserEngine', 'factorLanguage', 'researchAnalytics'].map(name => [name, hash(fs.readFileSync(path.join(frontend, `src/${name}.ts`)))]));
const raw = fs.readFileSync(path.join(research, 'public-market.json'));
const market = JSON.parse(raw);
const provenance = { data_sha256: hash(raw), engine_sha256: source_hashes.browserEngine, source_hashes,
  engine_bundle_sha256: hash(JSON.stringify(source_hashes)), language_version: engine.LANGUAGE_VERSION,
  engine_version: engine.ENGINE_VERSION, market_url: 'research/public-market.json' };
// One protocol frozen before the batch; never selected using resulting performance.
const protocol = Object.freeze({ start_date: '2024-01-01', end_date: '2024-12-31', horizon: 5, quantiles: 10,
  top_n: 3, rebalance_days: 5, initial_cash: 1000000, commission_bps: 3, slippage_bps: 5,
  stamp_tax_bps: 5, transfer_fee_bps: 0.1, min_commission: 5, max_weight: 0.4,
  max_participation: 0.01, min_ipo_days: 0, exclude_st: false, corporate_action_mode: 'price_only' });
const protocol_sha256 = hash(JSON.stringify(protocol));
const percentage = value => value == null ? '未定义/缺失' : (value * 100).toFixed(3) + '%';
const stamp = () => new Date().toISOString();
function reportFor(run) {
  const m = run.metrics || {};
  const body = `# ${run.name}\n\n## 研究问题（HYPOTHESIS）\n${run.config.hypothesis}\n\n## 冻结协议\n2024全年；固定12股；原式方向不翻转，按因子值从高到低选Top3的多头价格研究，不声称复现论文原多空组合。信号t收盘形成、t+1开盘成交；每5交易日调仓、单股上限40%；首日现金100万元。分为10组，每组仅1–2只股票，统计证据很弱。佣金3bps、最低5元、滑点5bps、卖出印花税5bps、过户费0.1bps，前日成交股数参与率1%。费用为固定研究假设；全部原式采用同一协议，无按结果调参。\n\n## 实际结果（FACT）\n${run.status === 'completed' ? `总价格净收益：${percentage(m.total_return)}；最大回撤：${percentage(m.max_drawdown)}；成交${m.trade_count}笔；日均IC：${m.ic_mean == null ? '未定义/缺失' : m.ic_mean.toFixed(6)}（${m.ic_observations}个有效观察）。基准价格收益：${percentage(m.benchmark_return)}。` : `计算失败，保留失败记录：${run.error}。未生成或填充绩效。`}\n\n## 解释与边界（INTERPRETATION）\n结果只描述事后固定小样本的历史价格表现，存在选择/幸存者偏差和多重检验。原式所需数据是否齐全与公式是否有有效统计值是两回事；常量相关、零分母等保持缺失。未复权价格不包括股息、拆并股等完整公司行动，历史ST/涨跌停和真实盘口状态未验证。10组不构成大样本或可交易收益证明，分组未扣成本，组合净值另扣成本。ICIR与信息比率口径分别保存，不据此宣布显著性或全A有效性。\n\n## 决定\n证据不足。保留全部正、负、未定义和失败结果，不以本批结果调整方向、窗口、费用或样本。后续需使用预先冻结的独立完整样本及多重检验。\n\n## 来源与复现\n腾讯证券公开行情；数据SHA256：${provenance.data_sha256}。协议SHA256：${protocol_sha256}。公式语言：${engine.LANGUAGE_VERSION}。三个实现文件SHA256在任务快照内；这是由真实已执行结果生成的报告，不是LLM判断或作者业绩复现。\n`;
  return { id: 'report_' + run.id, run_id: run.id, title: run.name, body, version: 1, created_at: run.finished_at, updated_at: run.finished_at, source_kind: 'published_public_run' };
}
async function calculate(item, label) {
  item = { ...item, factors: item.factors.map(f => Object.fromEntries(Object.entries(f).filter(([key]) => !key.startsWith('published_')))) };
  const created = stamp();
  const config = engine.normalizePublicConfig({ ...protocol, kind: item.kind, factor_id: item.factors[0].id,
    factors: item.factors.map(f => ({ factor_id: f.id, weight: f.weight })) }, market);
  config.factor_versions = item.factors.map(f => ({ id: f.id, version: f.version, weight: f.weight, code_hash: f.code_hash }));
  config.hypothesis = item.factors.map(f => f.description).join('\n');
  config.sample_role = '固定公开小样本探索，未设置独立样本外集，不按结果调参';
  config.protocol_sha256 = protocol_sha256;
  if (item.paper) config.replication = { source_title: `101 Formulaic Alphas · Alpha#${item.paper.number}`, source_url: item.paper.source_reference,
    mode: '原论文逐式转译并手工核对；安全AST执行，非LLM解读', definition: item.paper.original_formula,
    implementation_notes: item.paper.implementation_notes, required_fields: item.paper.required_fields };
  else if (item.factors[0].id === 'public_alpha101') config.replication = { source_title: '101 Formulaic Alphas · Alpha#101', source_url: 'https://arxiv.org/abs/1601.00991', mode: '人工确认公开公式', definition: '(close-open)/((high-low)+0.001)' };
  const identity = hash(JSON.stringify({ protocol, specs: config.factor_versions, data: provenance.data_sha256, sources: source_hashes })).slice(0, 12);
  const id = `published_v2_2024_${label}_${identity}`;
  const snapshot = { config_frozen: config, factor_specs: item.factors, protocol_sha256, ...provenance };
  const run = { id, name: item.name, kind: item.kind, status: 'running', progress: 0, created_at: created, updated_at: created,
    config, factor_specs: item.factors, snapshot, market_sha256: provenance.data_sha256, result: null, metrics: null,
    source_kind: 'published_public_run', protocol_sha256, ...provenance };
  try {
    const result = await engine.runBrowserResearch(market, config, item.factors);
    result.provenance = { ...result.provenance, ...provenance, protocol_sha256, published_batch: '统一2024协议，原式39条完整批次，未根据结果筛选' };
    Object.assign(run, { status: 'completed', progress: 100, message: '已用真实公开行情计算；统一协议发布案例', result, metrics: result.metrics });
  } catch (error) { Object.assign(run, { status: 'failed', progress: 100, error: error instanceof Error ? error.message : String(error), message: '固定协议计算失败；保留失败，不填绩效' }); }
  run.finished_at = stamp(); run.updated_at = run.finished_at;
  console.log(JSON.stringify({ id, status: run.status, trades: run.metrics?.trade_count ?? null, net_price_return: run.metrics?.total_return ?? null, ic: run.metrics?.ic_mean ?? null, error: run.error || null }));
  return { run, report: reportFor(run) };
}
async function main() {
  const seeds = engine.publicSeeds().map(f => ({ ...f, code_hash: hash(f.code) }));
  const seedCases = seeds.map(f => ({ name: f.name + ' · 2024公开价格研究', kind: 'factor', factors: [{ ...f, weight: 1 }] }));
  seedCases.push({ name: '动量与低波等权 · 2024公开价格研究', kind: 'strategy', factors: [{ ...seeds[0], weight: 0.5 }, { ...seeds[2], weight: 0.5 }] });
  const seedOutput = { schema: 'quant.public.runs', version: 1, ...provenance, protocol, protocol_sha256, generated_at: stamp(), runs: [], reports: [] };
  for (const [i, item] of seedCases.entries()) { const entry = await calculate(item, `seed${i+1}`); seedOutput.runs.push(entry.run); seedOutput.reports.push(entry.report); }
  fs.writeFileSync(path.join(research, 'public-runs.json'), JSON.stringify(seedOutput));

  const catalogPath = path.join(research, 'alpha101.json'), catalog = JSON.parse(fs.readFileSync(catalogPath));
  if (catalog.factors.length !== 101) throw new Error('Alpha101目录不是完整101条');
  const folder = path.join(research, 'alpha101-results'); fs.mkdirSync(folder, { recursive: true });
  const index = { schema: 'quant.public.alpha101.index', version: 1, ...provenance, protocol, protocol_sha256, generated_at: stamp(), runs: [], blocked: [], selection_policy: '依真实字段能力预先选择全部可执行定义，未按任何绩效筛选；缺数据不构造代理' };
  for (const f of catalog.factors) {
    f.category = 'Alpha101';
    const validated = engine.validateCode(f.code);
    if (!validated.valid || JSON.stringify(validated.ast) !== JSON.stringify(f.ast) || hash(f.code) !== f.code_hash) throw new Error(`Alpha#${f.number}代码/AST/hash不一致`);
    if (!f.capability.public_sample_executable) {
      index.blocked.push({ factor_id: f.id, number: f.number, code_hash: f.code_hash, status: 'blocked_missing_data', missing_fields: f.capability.missing_public_fields });
      continue;
    }
    const { run, report } = await calculate({ name: f.name + ' · 2024统一公开协议', kind: 'factor', factors: [{ ...f, weight: 1 }], paper: f }, f.id);
    const published_run_url = `research/alpha101-results/${f.id}.json`;
    const output = { schema: 'quant.public.alpha101.run', version: 1, ...provenance, protocol_sha256, generated_at: run.finished_at, run, report };
    const serialized = JSON.stringify(output);
    fs.writeFileSync(path.join(folder, f.id + '.json'), serialized);
    const summary = { id: run.id, name: run.name, kind: run.kind, factor_id: f.id, factor_version: f.version, code_hash: f.code_hash,
      status: run.status, metrics: run.metrics, error: run.error || null, created_at: run.created_at, finished_at: run.finished_at,
      published_run_url, file_sha256: hash(serialized), bytes: Buffer.byteLength(serialized), source_kind: 'published_public_run', config: run.config };
    index.runs.push(summary);
    Object.assign(f, { published_run_url, published_run_id: run.id, published_run_code_hash: f.code_hash, published_run_status: run.status, published_run_file_sha256: summary.file_sha256 });
  }
  index.summary = { definitions: 101, executable: index.runs.length, completed: index.runs.filter(r => r.status === 'completed').length,
    failed: index.runs.filter(r => r.status === 'failed').length, blocked: index.blocked.length };
  fs.writeFileSync(path.join(research, 'alpha101-runs.json'), JSON.stringify(index));
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(JSON.stringify({ batch: index.summary, all_result_bytes: index.runs.reduce((n, r) => n + r.bytes, 0), protocol_sha256, source_hashes }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
