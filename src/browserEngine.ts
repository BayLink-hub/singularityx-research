/** Public price research. Formula interpretation lives in the shared safe language. */
import { validateCode, evaluateCode, ranks, finite, mean, std, correlation, binary, languageOperators } from './factorLanguage';
import { augmentResearch } from './researchAnalytics';
import type { Row, Matrix } from './factorLanguage';
export * from './factorLanguage';
export interface PublicMarket { source: Row; universe: { symbol: string; name: string; exchange: string }[]; bars: { date: string; symbol: string; open: number; high: number; low: number; close: number; volume: number; amount: number | null }[]; benchmark: { date: string; close: number }[]; coverage: { start: string; end: string } }
export const ENGINE_VERSION = 'public-price-2.0.0';
export const PUBLIC_FIELDS = ['open', 'high', 'low', 'close', 'volume', 'amount'];
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

export function marketFrames(data: PublicMarket) {
  if (!data?.source?.provider || !data.source.url || !Array.isArray(data.universe) || !Array.isArray(data.bars) || !data.bars.length) throw new Error('公开行情文件缺少来源或数据');
  if (data.universe.length > 100 || data.bars.length > 100000) throw new Error('公开行情超过浏览器规模限制');
  const symbols = data.universe.map(x => x.symbol).sort(), dates = [...new Set(data.bars.map(b => b.date))].sort();
  if (new Set(symbols).size !== symbols.length || !symbols.length) throw new Error('证券清单有重复或为空');
  const benchmarkDates = new Set<string>();
  for (const point of data.benchmark || []) { if (!isoDate(point.date) || !Number.isFinite(point.close) || point.close <= 0 || benchmarkDates.has(point.date)) throw new Error('基准存在重复日期或无效报价'); benchmarkDates.add(point.date); }
  const si = new Map(symbols.map((s, i) => [s, i])), di = new Map(dates.map((d, i) => [d, i]));
  const frames = Object.fromEntries(PUBLIC_FIELDS.map(field => [field, dates.map(() => symbols.map(() => NaN))])) as Record<string, Matrix>, keys = new Set();
  for (const bar of data.bars) {
    if (!isoDate(bar.date) || !si.has(bar.symbol)) throw new Error('行情日期或证券代码不合法');
    const key = bar.date + '|' + bar.symbol; if (keys.has(key)) throw new Error(`行情存在重复主键 ${key}`); keys.add(key);
    if (PUBLIC_FIELDS.filter(f => f !== 'amount').some(f => !Number.isFinite((bar as any)[f])) || Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) || bar.volume < 0 || (bar.amount !== null && (!Number.isFinite(bar.amount) || bar.amount < 0))) throw new Error(`行情字段异常 ${key}`);
    for (const field of PUBLIC_FIELDS) frames[field][di.get(bar.date)!][si.get(bar.symbol)!] = (bar as any)[field] === null ? NaN : (bar as any)[field];
  }
  return { symbols, dates, frames, rows: data.bars.length };
}
export const publicWarnings = [
  '固定少量股票的公开历史样本，具有事后选样和幸存者偏差；不代表全 A 股选股或样本外有效性。',
  '使用未复权价格，未还原分红、拆并股、送转或配股；所有收益均为价格收益研究，不是完整公司行动回测。',
  '缺少历史 ST、上市日期、停牌和涨跌停交易状态；未声称已验证这些交易限制。缺报价保留持仓及上次估值。',
  '信号在 t 收盘形成，最早 t+1 开盘成交；开盘成交和按前日成交量的参与率均为研究假设，不证明真实可成交。',
  '费用为用户固定配置，不自动追溯历史费率；未建立真实券商账户或实盘交易连接。',
  'IC 和分组为统计价格收益，分组未扣成本；交易组合净值另行扣除佣金、滑点及费税。',
];
export function normalizePublicConfig(given: Row, data: PublicMarket): Row {
  const c = { kind: 'factor', start_date: '2024-01-01', end_date: '2024-12-31', horizon: 5, quantiles: 5, top_n: 3, rebalance_days: 5, initial_cash: 1e6, commission_bps: 3, slippage_bps: 5, stamp_tax_bps: 5, transfer_fee_bps: 0.1, min_commission: 5, max_weight: 0.4, max_participation: 0.01, min_ipo_days: 0, exclude_st: false, corporate_action_mode: 'price_only', ...given };
  if (!['factor', 'strategy'].includes(c.kind)) throw new Error('研究类型不支持');
  const dates = data.bars.map(x => x.date).sort(), start = dates[0], end = dates.at(-1)!;
  if (!isoDate(c.start_date) || !isoDate(c.end_date) || c.start_date >= c.end_date || c.end_date > end || c.start_date < start) throw new Error(`区间须位于实际公开行情 ${start} 至 ${end}，日期有效且起始早于结束`);
  const bounds: Record<string, [number, number, boolean?]> = { horizon: [1, 60, true], quantiles: [2, 10, true], top_n: [1, data.universe.length, true], rebalance_days: [1, 60, true], initial_cash: [10000, 1e9], commission_bps: [0, 100], slippage_bps: [0, 200], stamp_tax_bps: [0, 100], transfer_fee_bps: [0, 100], min_commission: [0, 1000], max_weight: [0.001, 1], max_participation: [0.00001, 0.1] };
  for (const [key, [low, high, integer]] of Object.entries(bounds)) { const v = c[key as keyof typeof c]; if (typeof v !== 'number' || !Number.isFinite(v) || v < low || v > high || (integer && !Number.isInteger(v))) throw new Error(`${key} 须为 ${low}–${high} 的${integer ? '整数' : '有限数字'}`); }
  if (c.quantiles > data.universe.length) throw new Error('分组数量不能超过样本证券数');
  if (c.exclude_st !== false || c.min_ipo_days !== 0) throw new Error('公开样本没有历史 ST/上市日期字段，请关闭 ST 过滤并将上市观察期设为 0');
  if (c.corporate_action_mode !== 'price_only') throw new Error('公开未复权行情仅支持 price_only 价格收益研究，不能假装复权或严格公司行动结算');
  return c;
}
export const jsonSafe = (value: any): any => typeof value === 'number' ? (Number.isFinite(value) ? value : null) : Array.isArray(value) ? value.map(jsonSafe) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)])) : value;

/** Independent pure calculation; async checkpoints let cancellation and browser repaint run. */
export async function runBrowserResearch(data: PublicMarket, config: Row, factors: Row[], progress: (pct: number, message: string) => void = () => {}, cancelled: () => boolean = () => false): Promise<Row> {
  const c = normalizePublicConfig(config, data), { dates, symbols, frames } = marketFrames(data);
  const checkpoint = async (pct: number, message: string) => { if (cancelled()) throw new Error('任务已取消'); progress(pct, message); await new Promise<void>(resolve => setTimeout(resolve, 0)); if (cancelled()) throw new Error('任务已取消'); };
  await checkpoint(5, '验证公开数据、冻结 AST 与研究边界');
  if (!factors.length || factors.length > 8) throw new Error('请选择 1–8 个因子');
  const scores = dates.map(() => symbols.map(() => 0)); let weightSum = 0;
  const activeFactors = factors.filter(f => (f.weight ?? 1) !== 0);
  for (let k = 0; k < activeFactors.length; k++) {
    const f = activeFactors[k], weight = f.weight ?? 1;
    if (f.source_kind !== 'native_ast' || typeof weight !== 'number' || !Number.isFinite(weight) || Math.abs(weight) > 100) throw new Error('因子类型或权重无效');
    const values = evaluateCode(f.code, frames, f.ast);
    for (let i = 0; i < dates.length; i++) { const valuesAtDate = activeFactors.length > 1 ? ranks(values[i]) : values[i]; for (let j = 0; j < symbols.length; j++) scores[i][j] += valuesAtDate[j] * weight; }
    weightSum += Math.abs(weight); await checkpoint(10 + 15 * (k + 1) / activeFactors.length, `完成因子 ${f.name} 的历史计算`);
  }
  if (!weightSum) throw new Error('因子权重不能全为零');
  scores.forEach(row => row.forEach((_, j) => { row[j] /= weightSum; }));
  const active = dates.map((d, i) => d >= c.start_date && d <= c.end_date ? i : -1).filter(i => i >= 0);
  if (active.length < 3) throw new Error('区间至少需要 3 个真实交易日');
  if (!active.some(i => scores[i].some(Number.isFinite))) throw new Error('所选区间没有有效因子值，请检查预热窗口');
  const ic: Row[] = [], groups: Row[] = [], coverage: Row[] = [], groupCoverage: Row[] = []; const groupNav: number[] = Array(c.quantiles).fill(1);
  for (let offset = 0; offset < active.length; offset++) {
    const i = active[offset], exit = i + c.horizon + 1;
    const known = symbols.map((symbol, j) => ({ symbol, j, score: scores[i][j] })).filter(x => Number.isFinite(x.score) && Number.isFinite(frames.close[i][x.j]) && frames.volume[i][x.j] > 0).sort((a, b) => a.score - b.score || a.symbol.localeCompare(b.symbol));
    if (exit > active.at(-1)!) continue;
    const outcome = (j: number) => binary('/', frames.open[exit][j], frames.open[i + 1][j]) - 1;
    const pairs = known.filter(x => Number.isFinite(outcome(x.j)));
    coverage.push({ date: dates[i], factor_count: known.length, paired_count: pairs.length, universe_count: symbols.length });
    if (pairs.length >= 3) { const a = pairs.map(x => x.score), b = pairs.map(x => outcome(x.j)); ic.push({ date: dates[i], ic: correlation(a, b), rank_ic: correlation(ranks(a), ranks(b)), count: pairs.length }); }
    if (offset % c.horizon === 0 && known.length >= c.quantiles) {
      const row: Row = { date: dates[exit], signal_date: dates[i] }, audit: Row = { date: dates[i] };
      for (let q = 0; q < c.quantiles; q++) { const members = known.slice(Math.floor(q * known.length / c.quantiles), Math.floor((q + 1) * known.length / c.quantiles)), returns = members.map(x => outcome(x.j)); const ret = returns.length && returns.every(Number.isFinite) ? mean(returns) : NaN; groupNav[q] *= 1 + ret; row[`Q${q + 1}`] = groupNav[q]; audit[`Q${q + 1}`] = { members: members.map(x => x.symbol), missing: returns.filter(x => !Number.isFinite(x)).length }; }
      groups.push(row); groupCoverage.push(audit);
    }
    if (offset % 100 === 0) await checkpoint(25 + 15 * offset / active.length, '计算 IC 与不重叠分组价格收益');
  }
  type Position = { quantity: number; lastPrice: number; lastQuote: string; lastBuy: string };
  const positions = new Map<number, Position>(), trades: Row[] = [], curves: Row[] = [], dailyReturns: number[] = [], rejected: Row[] = [];
  let cash = c.initial_cash, previousEquity = c.initial_cash, totalFees = 0, totalSlippage = 0, peak = 1, staleDays = 0;
  const bps = (key: string) => c[key] / 10000;
  const fees = (gross: number, buy: boolean) => Math.max(c.min_commission, gross * bps('commission_bps')) + gross * bps('transfer_fee_bps') + (buy ? 0 : gross * bps('stamp_tax_bps'));
  for (let offset = 0; offset < active.length; offset++) {
    const i = active[offset], date = dates[i]; let traded = 0, dayCost = 0;
    if (offset > 0 && (offset - 1) % c.rebalance_days === 0) {
      const signal = i - 1;
      const candidates = symbols.map((symbol, j) => ({ symbol, j, score: scores[signal][j] })).filter(x => Number.isFinite(x.score) && frames.volume[signal][x.j] > 0 && Number.isFinite(frames.close[signal][x.j])).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol)).slice(0, c.top_n);
      const targetWeight = candidates.length ? Math.min(c.max_weight, 1 / candidates.length) : 0;
      const openEquity = cash + [...positions].reduce((sum, [j, p]) => sum + p.quantity * (Number.isFinite(frames.open[i][j]) ? frames.open[i][j] : p.lastPrice), 0);
      const targets = new Map<number, number>(candidates.map(x => [x.j, Number.isFinite(frames.open[i][x.j]) ? Math.floor(openEquity * targetWeight / frames.open[i][x.j] / 100) * 100 : positions.get(x.j)?.quantity || 0]));
      const participation = (j: number) => { const volume = frames.volume[signal][j]; return Number.isFinite(volume) && volume > 0 ? Math.floor(volume * c.max_participation / 100) * 100 : 0; };
      const execute = (j: number, quantity: number, buy: boolean) => {
        const raw = frames.open[i][j]; if (!Number.isFinite(raw) || raw <= 0) { rejected.push({ date, ts_code: symbols[j], reason: '开盘报价缺失，保留原持仓' }); return; }
        quantity = Math.min(quantity, participation(j)); if (quantity < 100) return;
        const price = raw * (1 + (buy ? 1 : -1) * bps('slippage_bps'));
        if (buy) { quantity = Math.min(quantity, Math.max(0, Math.floor((cash - c.min_commission) / (price * (1 + bps('commission_bps') + bps('transfer_fee_bps'))) / 100) * 100)); if (quantity < 100) return; }
        const gross = quantity * price, fee = fees(gross, buy), slippage = Math.abs(price - raw) * quantity;
        if (buy && gross + fee > cash + 1e-8) throw new Error('现金约束计算异常，拒绝负现金');
        const p = positions.get(j);
        if (buy) { cash -= gross + fee; positions.set(j, { quantity: (p?.quantity || 0) + quantity, lastPrice: raw, lastQuote: date, lastBuy: date }); }
        else { if (!p || p.lastBuy === date) return; cash += gross - fee; p.quantity -= quantity; if (!p.quantity) positions.delete(j); }
        totalFees += fee; totalSlippage += slippage; dayCost += fee + slippage; traded += gross;
        trades.push({ date, signal_date: dates[signal], execution_date: date, ts_code: symbols[j], side: buy ? '买入' : '卖出', quantity, price, raw_open: raw, amount: gross, fees: fee, slippage_cost: slippage, cost: fee + slippage, cash_after: cash });
      };
      for (const [j, p] of [...positions]) { const sell = p.quantity - (targets.get(j) || 0); if (sell > 0) execute(j, sell, false); }
      for (const candidate of candidates) { const buy = (targets.get(candidate.j) || 0) - (positions.get(candidate.j)?.quantity || 0); if (buy > 0) execute(candidate.j, buy, true); }
    }
    let marketValue = 0, stale = 0;
    for (const [j, p] of positions) { if (Number.isFinite(frames.close[i][j])) { p.lastPrice = frames.close[i][j]; p.lastQuote = date; } else stale++; marketValue += p.quantity * p.lastPrice; }
    const equity = cash + marketValue, nav = equity / c.initial_cash; if (!(equity > 0)) throw new Error('组合资产非正，无法继续计算');
    if (stale) staleDays++; peak = Math.max(peak, nav); const ret = equity / previousEquity - 1;
    dailyReturns.push(ret); curves.push({ date, nav, drawdown: nav / peak - 1, cash, exposure: marketValue / equity, turnover: traded / previousEquity, cost: dayCost, positions: positions.size, stale_positions: stale }); previousEquity = equity;
    if (offset % 25 === 0) await checkpoint(45 + 45 * offset / active.length, `执行价格研究 ${offset + 1}/${active.length} 个交易日`);
  }
  const bm = new Map((data.benchmark || []).map(x => [x.date, x.close])), base = bm.get(curves[0].date);
  const benchmarkComplete = typeof base === 'number' && base > 0 && curves.every(x => Number.isFinite(bm.get(x.date)) && bm.get(x.date)! > 0);
  if (benchmarkComplete) curves.forEach(row => { row.benchmark = bm.get(row.date)! / base!; });
  const last = curves.at(-1)!, days = curves.length - 1, returns = dailyReturns.slice(1), ics = ic.map(x => x.ic).filter(Number.isFinite), ranksIC = ic.map(x => x.rank_ic).filter(Number.isFinite);
  const ratio = (values: number[]) => values.length > 1 && std(values) > 0 ? mean(values) / std(values) * Math.sqrt(252) : NaN;
  const metrics: Row = { total_return: last.nav - 1, annual_return: last.nav ** (252 / days) - 1, annual_volatility: std(returns) * Math.sqrt(252), sharpe: ratio(returns), max_drawdown: Math.min(...curves.map(x => x.drawdown)), final_nav: last.nav, trade_count: trades.length, total_cost: totalFees + totalSlippage, total_fees: totalFees, total_slippage: totalSlippage, mean_turnover: mean(curves.map(x => x.turnover)), n_days: curves.length, n_stocks: symbols.length, ic_mean: mean(ics), icir: ratio(ics), ic_ir: ratio(ics), rank_ic_mean: mean(ranksIC), rank_icir: ratio(ranksIC), ic_observations: ics.length, stale_valuation_days: staleDays, win_rate: returns.filter(x => x > 0).length / returns.length };
  if (benchmarkComplete) { metrics.benchmark_return = last.benchmark - 1; metrics.excess_return = last.nav - last.benchmark; }
  const period = (length: number, field: string) => [...new Set(curves.map(x => x.date.slice(0, length)))].map(key => ({ [field]: key, return: curves.reduce((product, row, i) => row.date.startsWith(key) ? product * (1 + dailyReturns[i]) : product, 1) - 1, days: curves.filter(x => x.date.startsWith(key)).length }));
  const holdings = [...positions].map(([j, p]) => ({ ts_code: symbols[j], quantity: p.quantity, quantity_unit: '股（100股整手）', price: p.lastPrice, market_value: p.quantity * p.lastPrice, weight: p.quantity * p.lastPrice / previousEquity, last_quote_date: p.lastQuote, stale: p.lastQuote !== last.date }));
  const warnings = [...publicWarnings]; if (!trades.length) warnings.push('本次没有成交，零交易结果不能作为策略有效性的证据。'); if (!benchmarkComplete) warnings.push('基准区间报价不完整，未生成基准曲线或超额收益。'); if (staleDays) warnings.push(`有 ${staleDays} 天持仓缺报价，使用最后已知估值，不能视为已清算收益。`);
  await checkpoint(98, '完成真实计算并准备保存研究证据');
  const result = jsonSafe({ metrics, curves, ic, groups, yearly: period(4, 'year'), monthly: period(7, 'month'), trades, holdings, diagnostics: { coverage, group_coverage: groupCoverage, rejected_orders: rejected, initial_day_cash_only: true }, warnings, provenance: { engine: ENGINE_VERSION, source: data.source, universe: data.universe, sample_status: '固定公开小样本的探索研究，非全A或样本外验证', config: c, factor_versions: factors.map(f => ({ id: f.id, version: f.version, name: f.name, code: f.code, ast: f.ast, weight: f.weight ?? 1 })), information_time: 't收盘形成信号→t+1开盘；首个研究日保持现金', quantity_unit: '股（100股整手，缺少公司行动调整）', return_basis: '未复权价格收益', grouping: '信号日先分组；每horizon日一批不重叠开盘至开盘收益，缺报价不重选成员', icir: '日度IC均值/总体标准差×sqrt(252)，重叠持有期导致相关性，非显著性检验', source_start: dates[0], source_end: dates.at(-1) } });
  result.analytics = augmentResearch(result, data, c, {dates, symbols, values: scores});
  return jsonSafe(result);
}

export function publicSeeds(): Row[] {
  const definitions = [
    ['public_momentum20', '20 日动量 · 跳 1 日', '动量', '剔除最近一日后，过去价格趋势是否延续。使用未复权价格，除权跳变可能影响信号。', 'window = 20\nskip = 1\nrecent = delay(close, skip)\nanchor = delay(close, window + skip)\nfactor = recent / anchor - 1'],
    ['public_reversal5', '5 日短期反转', '反转', '过去短期跌幅较大的股票是否反弹；这是待检验假设。', 'window = 5\nrecent_return = returns(close, window)\nfactor = -recent_return'],
    ['public_lowvol20', '20 日低波动', '波动率', '低价格收益波动是否对应不同的后续收益风险；不预设有效。', 'window = 20\ndaily_return = returns(close, 1)\nvolatility = ts_std(daily_return, window)\nfactor = -volatility'],
    ['public_volume_stability20', '20 日成交量稳定性', '量价', '成交量变异系数较低是否对应不同后续价格表现。成交量不是换手率。', 'window = 20\nvolume_mean = ts_mean(volume, window)\nvolume_std = ts_std(volume, window)\nfactor = -volume_std / volume_mean'],
    ['public_return_volume60', '60 日收益成交量相关反转', '量价', '收益与成交量变化高度同向可能反映拥挤；使用成交量代理，非资金流或换手率。', 'window = 60\ndaily_return = returns(close, 1)\nvolume_change = returns(volume, 1)\ncrowding = ts_corr(daily_return, volume_change, window)\nfactor = -crowding'],
    ['public_alpha101', 'Alpha101 #101 · 日内价格位置', '文献复现', '按公开论文 #101 公式手工定义：(close-open)/((high-low)+0.001)。来源 https://arxiv.org/abs/1601.00991 。这是公式程序实现，不是 LLM 自动解读，也不证明在 A 股或公开固定样本之外有效。', 'factor = (close - open) / ((high - low) + 0.001)'],
  ];
  const stamp = new Date().toISOString();
  return definitions.map(([id, name, category, description, code]) => ({ id, name, category, description, ...validateCode(code), source_kind: 'native_ast', status: 'ready', version: 1, created_at: stamp, updated_at: stamp, source_path: '公开浏览器因子定义', ...(id === 'public_alpha101' ? { source_reference: 'https://arxiv.org/abs/1601.00991', paper_factor_number: 101, replication_method: '手工确认公开公式；非 LLM 解读或有效性认证' } : {}), limitations: publicWarnings.slice(0, 2), metrics: null, legacy_metrics: null }));
}
export const publicOperators = languageOperators;
