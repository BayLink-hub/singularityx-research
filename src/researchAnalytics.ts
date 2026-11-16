/** Pure supplementary research analytics. Missing inputs stay null with reasons.
 * Existing evidence is never relabelled: five groups are not ten, ICIR is not IR,
 * and unadjusted gross group returns are not executable portfolio net returns.
 */
type Row = Record<string, any>;
export type FactorValues = { dates: string[]; symbols: string[]; values: (number | null)[][]; eligible?: boolean[][] };
export type MarketData = { source?: Row; bars: { date: string; symbol: string; open: number | null; close: number | null; volume?: number | null; [key: string]: any }[]; benchmark?: { date: string; close: number }[]; [key: string]: any };
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clean = (x: unknown): number | null => finite(x) ? x : null;
const mean = (a: number[]): number | null => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const variance = (a: number[]): number | null => { if (!a.length) return null; const m = mean(a)!; return mean(a.map(x => (x - m) ** 2)); };
const std = (a: number[]): number | null => { const v = variance(a); return v == null ? null : Math.sqrt(v); };
const ratio = (a: number[], annual = 1): number | null => { const s = std(a); return a.length >= 2 && s != null && s > 1e-14 ? clean(mean(a)! / s * Math.sqrt(annual)) : null; };
const compound = (a: number[]): number | null => a.length && a.every(x => x >= -1) ? clean(a.reduce((n, r) => n * (1 + r), 1) - 1) : null;
const safe = (x: any): any => typeof x === 'number' ? clean(x) : Array.isArray(x) ? x.map(safe) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, safe(v)])) : x;
function ranks(a: number[]): number[] {
  const order = a.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v || x.i - y.i), result = a.map(() => 0);
  for (let i = 0; i < order.length;) { let j = i + 1; while (j < order.length && order[j].v === order[i].v) j++; for (let k = i; k < j; k++) result[order[k].i] = (i + j + 1) / 2; i = j; }
  return result;
}
function corr(a: number[], b: number[]): number | null {
  if (a.length < 2 || a.length !== b.length) return null;
  const ma = mean(a)!, mb = mean(b)!, va = variance(a)!, vb = variance(b)!;
  return va > 1e-28 && vb > 1e-28 ? clean(mean(a.map((x, i) => (x - ma) * (b[i] - mb)))! / Math.sqrt(va * vb)) : null;
}
function histogram(values: number[], bins = 20) {
  return Array.from({ length: bins }, (_, i) => ({ lower: -1 + i * 2 / bins, upper: -1 + (i + 1) * 2 / bins, count: values.filter(x => x >= -1 + i * 2 / bins && (i === bins - 1 ? x <= 1 : x < -1 + (i + 1) * 2 / bins)).length }));
}
function icStats(rows: Row[], field: string) {
  const values = rows.map(x => x[field]).filter(finite), s = std(values);
  return { count: values.length, missing: rows.length - values.length, mean: mean(values), std: s,
    icir: ratio(values), icir_annualized: ratio(values, 252), positive_ratio: values.length ? values.filter(x => x > 0).length / values.length : null,
    reason: values.length < 2 ? '少于2个有效IC观察' : s == null || s <= 1e-14 ? 'IC零方差，ICIR未定义' : null };
}
function periodIC(rows: Row[], length: number) {
  return [...new Set(rows.map(r => String(r.date).slice(0, length)))].sort().map(period => {
    const values = rows.filter(r => String(r.date).startsWith(period));
    return { period, days: values.length, ic: icStats(values, 'ic'), rank_ic: icStats(values, 'rank_ic') };
  });
}
function icAnalytics(input: Row[]) {
  const rows = [...input].sort((a, b) => a.date.localeCompare(b.date)); let sumIC = 0, sumRank = 0, countIC = 0, countRank = 0;
  const daily = rows.map((r, i) => {
    const ic = clean(r.ic), rank = clean(r.rank_ic);
    if (ic != null) { sumIC += ic; countIC++; } if (rank != null) { sumRank += rank; countRank++; }
    const rolling: Row = {};
    for (const n of [20, 60]) {
      const window = rows.slice(Math.max(0, i - n + 1), i + 1);
      for (const f of ['ic', 'rank_ic']) {
        const a = window.map(x => x[f]).filter(finite), complete = window.length === n && a.length === n;
        rolling[`${f}_rolling_${n}`] = complete ? mean(a) : null;
        rolling[`${f}ir_rolling_${n}`] = complete ? ratio(a, 252) : null;
      }
    }
    return { ...r, ic, rank_ic: rank, cumulative_ic: ic == null ? null : sumIC, cumulative_rank_ic: rank == null ? null : sumRank,
      cumulative_ic_count: countIC, cumulative_rank_ic_count: countRank, ...rolling };
  });
  const monthly = periodIC(rows, 7), yearly = periodIC(rows, 4);
  return { daily, monthly, yearly, summary: { ic: icStats(rows, 'ic'), rank_ic: icStats(rows, 'rank_ic'),
    monthly_mean_icir_annualized: ratio(monthly.map(x => x.ic.mean).filter(finite), 12),
    monthly_mean_rank_icir_annualized: ratio(monthly.map(x => x.rank_ic.mean).filter(finite), 12) },
    distribution: { ic: histogram(rows.map(x => x.ic).filter(finite)), rank_ic: histogram(rows.map(x => x.rank_ic).filter(finite)) },
    definitions: { cumulative: '有效日IC的算术和；缺失日为空，并列出累计观察数，非收益',
      icir: '日IC均值/总体标准差(ddof=0)；annualized再乘sqrt(252)',
      monthly: '各月内部日IC统计；monthly_mean_icir_annualized=各月平均IC的均值/总体标准差×sqrt(12)',
      rolling: '20/60个观察日完整窗口，任何IC缺失则该窗口为空；年化比例不是显著性检验' } };
}
function performanceAnalytics(curves: Row[], config: Row) {
  const rows = [...curves].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const rfAnnual = finite(config.risk_free_rate) && config.risk_free_rate > -1 ? config.risk_free_rate : 0;
  const rf = (1 + rfAnnual) ** (1 / 252) - 1; let peak = 1;
  const daily = rows.map((r, i) => {
    const previous = rows[i - 1], ret = i === 0 ? null : finite(r.nav) && finite(previous.nav) && previous.nav > 0 ? clean(r.nav / previous.nav - 1) : null;
    const br = i === 0 ? null : finite(r.benchmark) && finite(previous.benchmark) && previous.benchmark > 0 ? clean(r.benchmark / previous.benchmark - 1) : null;
    if (finite(r.nav)) peak = Math.max(peak, r.nav);
    return { date: r.date, nav: clean(r.nav), benchmark: clean(r.benchmark), return: ret, benchmark_return: br,
      excess_return: ret != null && br != null ? ret - br : null, drawdown: finite(r.nav) ? r.nav / peak - 1 : null,
      turnover: clean(r.turnover), exposure: clean(r.exposure), cost: clean(r.cost) };
  });
  const returns = daily.map(r => r.return).filter(finite), paired = daily.filter(r => r.return != null && r.benchmark_return != null);
  const a = paired.map(r => r.return!), b = paired.map(r => r.benchmark_return!), excess = a.map((v, i) => v - b[i]);
  const ma = mean(a), mb = mean(b);
  const vb = variance(b), beta = b.length >= 2 && vb != null && vb > 1e-28 ? clean(mean(a.map((v, i) => (v - ma!) * (b[i] - mb!)))! / vb) : null;
  const alphaDaily = beta == null ? null : clean(mean(a)! - rf - beta * (mean(b)! - rf));
  const downside = returns.length ? Math.sqrt(mean(returns.map(r => Math.min(r - rf, 0) ** 2))!) : null;
  const drawdowns = daily.map(r => r.drawdown).filter(finite); const maxDrawdown = drawdowns.length && rows.every(r => finite(r.nav) && r.nav > 0) ? Math.min(0, ...drawdowns) : null;
  const full = rows.length > 1 && returns.length === rows.length - 1 && rows.every(r => finite(r.nav) && r.nav > 0);
  const total = full ? rows.at(-1)!.nav / rows[0].nav - 1 : null;
  const annual = full ? clean((1 + total!) ** (252 / returns.length) - 1) : null;
  const period = (n: number) => [...new Set(daily.map(r => String(r.date).slice(0, n)))].sort().map(key => {
    const values = daily.filter(r => String(r.date).startsWith(key)), usable = values.filter(r => r.return != null);
    const expected = values.filter(r => r.date !== daily[0]?.date).length;
    const rp = usable.map(r => r.return!), bp = values.map(r => r.benchmark_return).filter(finite);
    return { period: key, return: usable.length === expected ? compound(rp) : null,
      benchmark_return: bp.length === expected ? compound(bp) : null,
      excess_return: rp.length === expected && bp.length === expected && expected > 0 ? compound(rp)! - compound(bp)! : null,
      observations: rp.length, expected, mean_turnover: mean(values.map(r => r.turnover).filter(finite)), mean_exposure: mean(values.map(r => r.exposure).filter(finite)) };
  });
  return { daily, monthly: period(7), yearly: period(4), metrics: {
    information_ratio: ratio(excess, 252), tracking_error: excess.length >= 2 ? clean(std(excess)! * Math.sqrt(252)) : null,
    alpha_annual: alphaDaily == null ? null : alphaDaily * 252, alpha_daily: alphaDaily, beta,
    sortino: returns.length >= 2 && downside != null && downside > 1e-14 ? (mean(returns)! - rf) / downside * Math.sqrt(252) : null,
    calmar: annual != null && maxDrawdown != null && maxDrawdown < 0 ? annual / Math.abs(maxDrawdown) : null,
    annual_return: annual, total_return: total, max_drawdown: maxDrawdown,
    mean_turnover: mean(daily.map(r => r.turnover).filter(finite)), mean_exposure: mean(daily.map(r => r.exposure).filter(finite)),
    excess_observations: paired.length, return_observations: returns.length, missing_return_intervals: Math.max(0, rows.length - 1 - returns.length) },
    definitions: { information_ratio: '同日策略日收益−基准日收益的均值/总体标准差×sqrt(252)，不是ICIR',
      tracking_error: '策略日收益−基准日收益的总体标准差×sqrt(252)',
      alpha: '有截距日收益OLS：Rp−rf=alpha+beta(Rb−rf)；alpha_annual=日截距×252；未进行显著性检验',
      risk_free_rate: rfAnnual, sortino: '(平均日收益−日目标收益)/sqrt(mean(min(日收益−日目标,0)^2))×sqrt(252)',
      calmar: '由完整首末净值计算的年化收益/abs(含初始净值1的最大回撤)',
      turnover: '保留原curve.turnover单位；当前平台为买卖名义成交额之和/前一日净资产，未除2',
      periods: '月/年复合日收益；首日作为已给定基准净值而不虚构首日前回报；缺失区间不拼接' } };
}
function groupSummary(returns: Row[], keys: string[], coverage: Row[], turnover: Row[]) {
  const summary = keys.map((group, i) => {
    const values = returns.map(x => x[group]).filter(finite), total = values.length === returns.length ? compound(values) : null;
    const cov = coverage.map(x => x[group]).filter(x => x && typeof x === 'object');
    return { group, number: i + 1, mean_return: mean(values), cumulative_return: total, observations: values.length,
      missing_periods: returns.length - values.length, mean_turnover: mean(turnover.map(x => x[group]).filter(finite)),
      mean_members: mean(cov.map(x => x.members_count ?? x.members?.length).filter(finite)),
      mean_paired: mean(cov.map(x => x.paired_count).filter(finite)),
      missing_forward_observations: cov.length ? cov.reduce((n, x) => n + (x.missing ?? 0), 0) : null };
  });
  const finiteMeans = summary.filter(s => s.mean_return != null), monotonicity = finiteMeans.length === keys.length && keys.length > 1 ? corr(ranks(summary.map(s => s.number)), ranks(summary.map(s => s.mean_return!))) : null;
  const longShort = returns.map(r => ({ date: r.date, return: finite(r[keys.at(-1)!]) && finite(r[keys[0]]) ? r[keys.at(-1)!] - r[keys[0]] : null }));
  return { summary, monotonicity, strictly_increasing: finiteMeans.length === keys.length && summary.length > 1 ? summary.every((s, i) => i === 0 || s.mean_return! > summary[i - 1].mean_return!) : null, long_short: longShort,
    definitions: { monotonicity: '组号与各组平均不重叠持有期收益的Spearman相关；缺任一组均值则为空', long_short: '最高组−最低组的当期毛收益；不是可卖空净收益', group_return: '等权组毛价格收益，无费用；有成员未来报价缺失时整组收益为空，成员不重选' } };
}
function existingGroups(result: Row) {
  const curves: Row[] = result.groups || [], keys = [...new Set<string>(curves.flatMap(r => Object.keys(r).filter(k => /^(?:Q|G)\d+$/.test(k))))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const returns = curves.map((r, i) => Object.fromEntries([['date', r.date], ['signal_date', r.signal_date], ...keys.map(k => [k, finite(r[k]) && (i === 0 || finite(curves[i - 1][k]) && curves[i - 1][k] > 0) ? r[k] / (i === 0 ? 1 : curves[i - 1][k]) - 1 : null])])) as Row[];
  const rawCoverage: Row[] = result.diagnostics?.group_coverage || [];
  const bySignal = new Map(rawCoverage.map(r => [r.date, r]));
  const coverage = curves.map(r => {
    const raw = bySignal.get(r.signal_date || r.date), source = raw?.groups || raw || {};
    const row: Row = { date: r.date, signal_date: r.signal_date };
    for (const k of keys) {
      const v = source[k]; if (!v) { row[k] = null; continue; }
      const members = finite(v.members) ? v.members : Array.isArray(v.members) ? v.members.length : clean(v.members_count);
      row[k] = { ...v, members_count: members, paired_count: clean(v.paired_count ?? v.observed) ?? (members != null && finite(v.missing) ? members - v.missing : null) };
    }
    return row;
  });
  const turnover: Row[] = [];
  return { count: keys.length, curves, returns, coverage, turnover, ...groupSummary(returns, keys, coverage, turnover),
    source: 'existing_group_nav', return_basis: result.diagnostics?.forward_return_definition || result.provenance?.return_basis || '原有组净值口径，未更改收益定义', requested_count: 10, reason: keys.length === 10 ? null : `原结果实际为${keys.length}组；缺完整因子矩阵，不能伪造十分组`,
    turnover_reason: '原结果没有组成交账本或用于收益漂移的完整成员价格，组换手为空' };
}
function deciles(market: MarketData, config: Row, factor: FactorValues) {
  if (new Set(factor.dates).size !== factor.dates.length || new Set(factor.symbols).size !== factor.symbols.length || factor.values.length !== factor.dates.length || factor.values.some(r => r.length !== factor.symbols.length)) throw new Error('因子矩阵日期/股票轴重复或维度不匹配');
  if (factor.dates.some((d, i) => i > 0 && d <= factor.dates[i - 1])) throw new Error('因子日期轴必须严格递增');
  const h = config.horizon ?? 5;
  if (!Number.isInteger(h) || h < 1 || h > 252) throw new Error('forward horizon须为1–252交易日');
  const quotes = new Map<string, MarketData['bars'][number]>();
  for (const b of market.bars) { const k = b.date + '|' + b.symbol; if (quotes.has(k)) throw new Error('真实行情存在重复日期股票主键'); quotes.set(k, b); }
  const quote = (i: number, j: number) => quotes.get(factor.dates[i] + '|' + factor.symbols[j]);
  const active = factor.dates.map((d, i) => (!config.start_date || d >= config.start_date) && (!config.end_date || d <= config.end_date) ? i : -1).filter(i => i >= 0);
  const curves: Row[] = [], returns: Row[] = [], coverage: Row[] = [], turnover: Row[] = [], membershipTurnover: Row[] = [], ic: Row[] = [];
  const keys = Array.from({ length: 10 }, (_, i) => `Q${i + 1}`), nav: (number | null)[] = keys.map(() => 1);
  let previous: { members: number[][]; entry: number } | null = null;
  const reasons: string[] = [];
  for (let offset = 0; offset < active.length; offset++) {
    const t = active[offset], entry = t + 1, exit = t + h + 1;
    if (exit > active.at(-1)!) continue;
    const known = factor.symbols.map((symbol, j) => ({ symbol, j, score: factor.values[t][j] })).filter(x => {
      const q = quote(t, x.j);
      return finite(x.score) && (factor.eligible ? factor.eligible[t]?.[x.j] === true : q && finite(q.close) && q.close > 0 && finite(q.volume) && q.volume > 0);
    }).sort((a, b) => a.score! - b.score! || a.symbol.localeCompare(b.symbol));
    const forward = (j: number): number | null => {
      const start = quote(entry, j)?.open, end = quote(exit, j)?.open;
      return finite(start) && start > 0 && finite(end) && end > 0 ? clean(end / start - 1) : null;
    };
    const pairs = known.map(x => ({ score: x.score!, ret: forward(x.j) })).filter(x => x.ret != null);
    const xs = pairs.map(x => x.score), ys = pairs.map(x => x.ret!);
    ic.push({ date: factor.dates[t], ic: pairs.length >= 3 ? corr(xs, ys) : null, rank_ic: pairs.length >= 3 ? corr(ranks(xs), ranks(ys)) : null, count: pairs.length, factor_count: known.length });
    if (offset % h !== 0) continue;
    if (known.length < 10) {
      reasons.push(`${factor.dates[t]}只有${known.length}个已知有效因子，无法十分组`);
      const missing: Row = { date: factor.dates[exit], signal_date: factor.dates[t], entry_date: factor.dates[entry] };
      keys.forEach((k, q) => { missing[k] = null; nav[q] = null; });
      curves.push({ ...missing }); returns.push({ ...missing }); turnover.push({ ...missing }); coverage.push({ ...missing }); membershipTurnover.push({ ...missing });
      previous = null; continue;
    }
    const members = keys.map((_, q) => known.slice(Math.floor(q * known.length / 10), Math.floor((q + 1) * known.length / 10)).map(x => x.j));
    const row: Row = { date: factor.dates[exit], signal_date: factor.dates[t], entry_date: factor.dates[entry] }, rets: Row = { ...row }, cov: Row = { ...row }, turns: Row = { ...row }, memberTurns: Row = { ...row };
    for (let q = 0; q < 10; q++) {
      const group = keys[q], current = members[q], observed = current.map(forward), missing = observed.filter(x => x == null).length;
      const ret = missing ? null : mean(observed as number[]); rets[group] = ret;
      nav[q] = nav[q] != null && ret != null ? clean(nav[q]! * (1 + ret)) : null; row[group] = nav[q];
      cov[group] = { members: current.map(j => factor.symbols[j]), members_count: current.length, paired_count: current.length - missing, missing, small_group: current.length < 5 };
      if (!previous) { turns[group] = curves.length === 0 ? 1 : null; memberTurns[group] = curves.length === 0 ? 1 : null; }
      else {
        const old = previous.members[q], all = [...new Set([...old, ...current])], oldSet = new Set(old), currentSet = new Set(current);
        memberTurns[group] = all.reduce((s, j) => s + Math.abs((oldSet.has(j) ? 1 / old.length : 0) - (currentSet.has(j) ? 1 / current.length : 0)), 0) / 2;
        const oldValues = old.map(j => { const start = quote(previous!.entry, j)?.open, end = quote(entry, j)?.open; return finite(start) && start > 0 && finite(end) && end > 0 ? end / start / old.length : null; });
        if (oldValues.some(x => x == null)) turns[group] = null;
        else { const total = (oldValues as number[]).reduce((s, x) => s + x, 0), drifted = new Map(old.map((j, k) => [j, oldValues[k]! / total])); turns[group] = all.reduce((s, j) => s + Math.abs((drifted.get(j) || 0) - (currentSet.has(j) ? 1 / current.length : 0)), 0) / 2; }
      }
    }
    curves.push(row); returns.push(rets); coverage.push(cov); turnover.push(turns); membershipTurnover.push(memberTurns); previous = { members, entry };
  }
  return { ic, groups: { count: 10, curves, returns, coverage, turnover, membership_turnover: membershipTurnover, ...groupSummary(returns, keys, coverage, turnover),
    source: 'factor_matrix_and_real_open_prices', horizon: h, reason: returns.some(r => keys.some(k => finite(r[k]))) ? null : '没有足够10只有效证券和完整forward窗口', skipped_periods: reasons,
    membership_rule: factor.eligible ? '使用显式t时点eligible掩码，按分数再股票代码稳定排序切10组' : 't时点有限分数、正收盘价和正成交量；仅为提供行情的研究股票池，非全A历史交易资格认证',
    turnover_definition: '当前等权目标与上一组入场→当前入场价格漂移权重的L1差/2；首次从现金买入记1；报价缺失为空',
    return_basis: '提供行情open的价格收益，未替换复权或股息总回报；不模拟涨跌停排队/费用/可卖空',
    small_sample_warning: '10组若仅12只股票，每组1–2只，不能据此认为全市场分组稳定或统计显著' } };
}

/** Returns supplementary analytics only; callers attach as result.analytics.
 * factorValues are information-date scores; forward=t+1 open→t+h+1 open.
 * Groups are assigned BEFORE future-return availability is inspected.
 */
export function augmentResearch(result: Row, market: MarketData | null, config: Row = {}, factorValues?: FactorValues): Row {
  const unavailable: Row = {}, limitations: string[] = [];
  let groups: Row = existingGroups(result); let sourceIC: Row[] = result.ic || [];
  if (factorValues && market?.bars?.length) {
    try { const extra = deciles(market, config, factorValues); groups = extra.groups; if (!sourceIC.length) sourceIC = extra.ic; }
    catch (error) { unavailable.deciles = error instanceof Error ? error.message : String(error); }
  }
  if (groups.count !== 10 || groups.reason) unavailable.deciles = groups.reason;
  if (!factorValues) limitations.push('未提供完整因子矩阵，保留已有真实分组数量，不从5组推造10组。');
  const ic = icAnalytics(sourceIC), performance = performanceAnalytics(result.curves || [], config);
  if (!ic.summary.ic.count) unavailable.ic = '无原始日Pearson IC序列；不从汇总IC均值伪造';
  if (!ic.summary.rank_ic.count) unavailable.rank_ic = '无原始日RankIC序列；不复制Pearson或原历史单列IC';
  if (!performance.metrics.excess_observations) unavailable.benchmark = '缺少同日策略与基准净值收益配对；IR、tracking error、alpha、beta为空';
  if (performance.metrics.information_ratio == null) unavailable.information_ratio = '超额收益配对少于2个或总体标准差为零';
  if (performance.metrics.beta == null) unavailable.beta_alpha = '基准配对少于2个或基准收益方差为零';
  if (performance.metrics.sortino == null) unavailable.sortino = '少于2个有效日收益或下行目标偏差为零';
  if (performance.metrics.calmar == null) unavailable.calmar = '净值区间不完整或最大回撤为零';
  if (!groups.turnover?.length) unavailable.group_turnover = groups.turnover_reason || '缺组成员或价格漂移序列';
  if (performance.metrics.mean_turnover == null) unavailable.turnover = '原结果缺日成交换手序列，未从持仓数估算';
  if (performance.metrics.mean_exposure == null) unavailable.exposure = '原结果缺日持仓市值/净资产序列';
  limitations.push('统计扩展不增加原数据真实性；样本选择、公司行动、交易资格与持有期重叠限制仍沿用原结果。');
  return safe({ schema: 'quant.research.analytics', version: 1, metrics: { ...performance.metrics,
    ic_mean: ic.summary.ic.mean, rank_ic_mean: ic.summary.rank_ic.mean, icir_daily: ic.summary.ic.icir,
    icir_annualized: ic.summary.ic.icir_annualized, rank_icir_annualized: ic.summary.rank_ic.icir_annualized },
    ic, performance, groups, unavailable, limitations });
}
