/** Pure, auditable research calculations. No example holdings or synthetic prices. */
export const VERIFIED_AT = '2026-11-16';
export const SOURCES = {
  sse: 'https://www.sse.com.cn/lawandrules/sselawsrules2025/stocks/issue/c/c_20250515_10778982.shtml',
  szse: 'https://investor.szse.cn/institute/rules/t20230601_600765.html',
  alpha: 'https://arxiv.org/abs/1601.00991',
  alphaPdf: 'https://arxiv.org/pdf/1601.00991',
  bm: 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_form_btm.html',
  ep: 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/int_country_port_formed.html',
  dp: 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library/det_port_form_dp.html',
  op: 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/tw_5_ports_op_inv.html',
  gp: 'https://www.nber.org/papers/w15940',
  policy: 'https://www.csrc.gov.cn/csrc/c106311/c7508374/content.shtml',
};
export const ALPHA101_CODE = 'factor = (close - open) / ((high - low) + 0.001)';
export const DRAFT_KEY = 'quant.research.replication.v1';
export type MarketName = 'SH' | 'SZ';
export function parseMarketValues(text: string): number[] {
  const entries = text.trim().split(/[\s,，;；]+/).filter(Boolean);
  if (entries.length !== 20) throw new Error(`需要恰好20个交易日的市值，当前为${entries.length}个；无持仓日请明确输入0。`);
  return entries.map((entry, index) => {
    const value = Number(entry);
    if (!Number.isFinite(value) || value < 0) throw new Error(`第${index + 1}个市值必须是非负有限数。`);
    return value;
  });
}
export function ipoQuota(values: number[], market: MarketName, announcedCap?: number | null, initialShares?: number | null) {
  if (values.length !== 20 || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('市值必须为20个非负有限数。');
  const average = values.reduce((a, b) => a + b, 0) / 20;
  if (!Number.isFinite(average)) throw new Error('市值合计超出计算范围。');
  const qualifiedByValue = average >= 10000;
  const marketQuota = qualifiedByValue ? Math.floor(average / 5000) * 500 : 0;
  const systemCap = market === 'SH' ? 99_999_500 : 999_999_500;
  if (announcedCap != null && (!Number.isFinite(announcedCap) || announcedCap < 0 || announcedCap % 500 !== 0)) throw new Error('公告申购上限须为非负的500股整数倍。');
  if (initialShares != null && (!Number.isSafeInteger(initialShares) || initialShares <= 0)) throw new Error('网上初始发行股数须为正整数。');
  const issuanceCap = initialShares == null ? null : Math.floor(initialShares / 1000 / 500) * 500;
  const finalQuota = announcedCap == null ? null : Math.min(marketQuota, announcedCap, issuanceCap ?? Infinity, systemCap);
  return { market, observations: 20, average, qualifiedByValue, unitValue: 5000, unitShares: 500, marketQuota, announcedCap: announcedCap ?? null, issuanceCap, systemCap, finalQuota };
}
export interface PublicBar { date: string; symbol: string; open: number; high: number; low: number; close: number; volume: number | null; amount: number | null }
export interface PublicMarket {
  source: { provider: string; url: string; retrieved_at: string; adjustment: string; notes?: string | string[]; [key: string]: unknown };
  universe: { symbol: string; name: string; exchange: string }[];
  bars: PublicBar[];
  benchmark: { date: string; close: number; symbol?: string; name?: string }[];
  coverage: { start: string; end: string };
}
export function eventWindow(market: PublicMarket, symbol: string, eventDate: string, before = 20, after = 20) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new Error('请选择有效事件日期。');
  if (!Number.isInteger(before) || !Number.isInteger(after) || before < 1 || after < 1 || before > 60 || after > 60) throw new Error('观察窗口应为1至60个报价日。');
  const benchmark = [...market.benchmark].filter(x => Number.isFinite(x.close) && x.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!benchmark.length || eventDate < benchmark[0].date || eventDate > benchmark[benchmark.length - 1].date) throw new Error('所选事件不在基准实际数据覆盖内，未生成结果。');
  if (new Set(benchmark.map(x => x.date)).size !== benchmark.length) throw new Error('基准存在重复日期，需先清理数据来源。');
  const stocks = market.bars.filter(x => x.symbol === symbol);
  if (!stocks.length) throw new Error('该证券没有实际行情，未生成结果。');
  if (new Set(stocks.map(x => x.date)).size !== stocks.length) throw new Error('证券行情存在重复日期，需先清理。');
  const prices = new Map(stocks.map(x => [x.date, x.close]));
  const center = benchmark.findIndex(x => x.date >= eventDate);
  const start = center - before, end = center + after;
  const anchor = benchmark[start - 1];
  const stockAnchor = anchor ? prices.get(anchor.date) : undefined;
  const rows: { date: string; tau: number; stock_close: number | null; benchmark_close: number; stock_return: number | null; benchmark_return: number | null; abnormal_return: number | null; stock_cumulative: number | null; benchmark_cumulative: number | null; car: number | null }[] = [];
  let car: number | null = 0;
  let paired = 0;
  for (let i = Math.max(0, start); i <= Math.min(benchmark.length - 1, end); i++) {
    const b = benchmark[i], prev = benchmark[i - 1], price = prices.get(b.date), prior = prev ? prices.get(prev.date) : undefined;
    const valid = (x: number | undefined): x is number => x != null && Number.isFinite(x) && x > 0;
    const sr = valid(price) && valid(prior) ? price / prior - 1 : null;
    const br = prev ? b.close / prev.close - 1 : null;
    const ar = sr == null || br == null ? null : sr - br;
    if (ar != null) paired++;
    car = car != null && ar != null && start >= 0 ? car + ar : null;
    rows.push({ date: b.date, tau: i - center, stock_close: valid(price) ? price : null, benchmark_close: b.close, stock_return: sr, benchmark_return: br, abnormal_return: ar,
      stock_cumulative: valid(price) && valid(stockAnchor) ? price / stockAnchor - 1 : null,
      benchmark_cumulative: anchor ? b.close / anchor.close - 1 : null, car });
  }
  const complete = start >= 1 && end < benchmark.length && paired === before + after + 1;
  return { rows, symbol, eventDate, effectiveDate: benchmark[center].date, anchorDate: anchor?.date ?? null, expected: before + after + 1, actual: rows.length, paired, complete,
    notes: [eventDate !== benchmark[center].date ? '事件日没有基准报价，已显式映射至下一有报价日作为τ=0。' : 'τ=0为所选事件日。',
      '观察日以基准实际报价序列为准；没有假定节假日，也没有补齐缺失报价。',
      '股票及基准累计价格收益以窗口前一报价日收盘为起点；CAR为窗口内每日(股票收益−基准收益)的算术累加。',
      '未估计市场模型α/β，未控制其他事件；描述性关联不代表政策的因果效果。',
      '缺任一天配对收益，后续CAR为空；价格收益不含交易成本或分红再投资。',
      ...(complete ? [] : ['窗口或报价不完整，请查看实际覆盖与缺失数量。'])] };
}
export type ResearchOperator = {
  id: string; name: string; category: '量价' | '基本面'; formula: string; description: string; fields: string; window: string; timing: string;
  source: string; sourceLabel: string; code?: string; inputs?: { key: string; label: string }[]; calculate?: (x: Record<string, number>) => number;
};
const price = (id: string, name: string, formula: string, description: string, fields: string, window: string, code: string): ResearchOperator => ({ id, name, category: '量价', formula, description, fields, window, code, source: SOURCES.alpha, sourceLabel: '101 Formulaic Alphas · 相关算子背景', timing: '日线收盘后可得，最早次日交易；窗口为本平台示例参数。跨日价格需单独核验复权口径。' });
const financial = (id: string, name: string, formula: string, source: string, sourceLabel: string, inputs: { key: string; label: string }[], calculate: (x: Record<string, number>) => number, description: string): ResearchOperator => ({ id, name, category: '基本面', formula, description, fields: inputs.map(x => x.label).join(' / '), window: '按公式指定财年或12个月期间', timing: '必须按实际公告日可得，不能按报告期回填；本版未接入可验证的财务PIT面板。', source, sourceLabel, inputs, calculate });
function divide(a: number, b: number) { if (!(b > 0)) throw new Error('该口径要求分母大于0；负净资产和缺失值不强行计算。'); return a / b; }
export const RESEARCH_OPERATORS: ResearchOperator[] = [
  price('delay', '滞后值', 'x[t−n]', '读取过去值。', 'close', 'n=1', 'factor = delay(close, 1)'),
  { ...price('return', '区间价格变动', 'close[t] / close[t−20] − 1', '平台区间收益定义；非论文中的原式策略。', 'close', '20交易日', 'factor = returns(close, 20)'), sourceLabel: '平台基础统计定义；背景：101 Formulaic Alphas' },
  price('delta', '一阶差分', 'close[t] − close[t−1]', '保留价格单位的变化量。', 'close', '1交易日', 'factor = close - delay(close, 1)'),
  price('mean', '滚动均值', 'mean(close[t−19:t])', '完整窗口均值。', 'close', '20个观测', 'factor = ts_mean(close, 20)'),
  price('std', '收益标准差', 'std(close[t]/close[t−1]−1, 20)', '总体标准差，ddof=0。', 'close', '20个收益观测', 'factor = ts_std(returns(close, 1), 20)'),
  price('sum', '成交量滚动和', 'sum(volume[t−19:t])', '窗口成交量累加。', 'volume', '20个观测', 'factor = ts_sum(volume, 20)'),
  price('min', '滚动最低价', 'min(low[t−19:t])', '窗口最小值。', 'low', '20个观测', 'factor = ts_min(low, 20)'),
  price('max', '滚动最高价', 'max(high[t−19:t])', '窗口最大值。', 'high', '20个观测', 'factor = ts_max(high, 20)'),
  price('corr', '量价相关性', 'corr(close, volume, 20)', 'Pearson时间序列相关。', 'close / volume', '20个观测', 'factor = ts_corr(close, volume, 20)'),
  price('rank', '截面百分位排名', 'rank(close[t])', '同日平均秩÷有效样本数；并列取平均。', 'close；当日证券集合', '当日截面', 'factor = rank(close)'),
  { ...price('zscore', '截面标准化', '(x − mean(x)) / std(x)', '平台基础统计定义，ddof=0；不是Alpha101原式算子。', 'close；当日证券集合', '当日截面', 'factor = zscore(close)'), source: 'https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.zscore.html', sourceLabel: 'SciPy · zscore 定义（平台通用统计扩展）' },
  { ...price('log', '成交量对数', 'log(volume)', '平台自然对数变换；非正值输出缺失，不是独立论文策略。', 'volume', '当日', 'factor = log(volume)'), sourceLabel: '平台基础统计定义；背景：Alpha101含log(volume)表达式' },
  price('sign', '价差符号', 'sign(close − open)', '输出−1、0或1。', 'close / open', '当日', 'factor = sign(close - open)'),
  { ...price('alpha101', 'Alpha101 · #101', '(close − open) / (high − low + 0.001)', '论文附录#101原始定义；未宣称A股有效。', 'open / high / low / close', '当日', ALPHA101_CODE), sourceLabel: 'Kakushadze · 101 Formulaic Alphas，附录#101' },
  financial('bm', '账面市值比 B/M', 'book_equity / market_equity', SOURCES.bm, 'Kenneth French · Book-to-Market', [{ key: 'book', label: '上财年账面权益' }, { key: 'market', label: '上年12月末权益市值' }], x => divide(x.book, x.market), '沿用文献财年/市值时点定义；负账面权益单独处理。'),
  financial('ep', '盈利收益率 E/P', 'earnings / market_equity', SOURCES.ep, 'Kenneth French · International valuation portfolios', [{ key: 'earnings', label: '指定期间盈利' }, { key: 'market', label: '匹配时点权益市值' }], x => divide(x.earnings, x.market), '基础估值比率；不能用未来财报盈利解释过去价格。'),
  financial('dp', '股息收益率 D/P', 'dividends_12m / market_equity', SOURCES.dp, 'Kenneth French · Dividend Yield', [{ key: 'dividend', label: '过去12个月已支付股息总额' }, { key: 'market', label: '期末权益市值' }], x => divide(x.dividend, x.market), '采用已支付股息；不计未实施预案。总额/总市值需同一股数口径，股本变动时不等同原文逐股股息计算。'),
  financial('op', '经营盈利能力 OP', '(revenue − COGS − interest − SG&A) / book_equity', SOURCES.op, 'Kenneth French · Operating Profitability', [{ key: 'revenue', label: '年度收入' }, { key: 'cogs', label: '年度销售成本' }, { key: 'interest', label: '年度利息费用' }, { key: 'sga', label: '年度销售及管理费用' }, { key: 'book', label: '财年末账面权益' }], x => divide(x.revenue - x.cogs - x.interest - x.sga, x.book), '费用分类须与财报口径核对，不直接套用不同行业。'),
  financial('investment', '资产增长 INV', '(assets_t − assets_t−1) / assets_t−1', SOURCES.op, 'Kenneth French · Investment', [{ key: 'assets', label: '本财年末总资产' }, { key: 'previous', label: '上财年末总资产' }], x => divide(x.assets - x.previous, x.previous), '同口径相邻两财年资产增长率。'),
  financial('gpa', '毛利润资产比 GP/A', '(revenue − COGS) / assets', SOURCES.gp, 'Novy-Marx · NBER 15940 / JFE 2013', [{ key: 'revenue', label: '年度收入' }, { key: 'cogs', label: '年度销售成本' }, { key: 'assets', label: '同财年末总资产' }], x => divide(x.revenue - x.cogs, x.assets), '毛利润除期末资产；不是净利润率，也不是行业无差别评分。'),
];
export function calculateFundamental(operator: ResearchOperator, values: Record<string, string>, announced: string, asOf: string) {
  if (!operator.calculate || !operator.inputs) throw new Error('请选择基本面算子。');
  if (!announced || !asOf) throw new Error('请填写实际公告日和分析时点。');
  if (announced >= asOf) throw new Error('只有公告日期，无法证明同日决策前已知；请选择晚于公告日的分析日期。');
  const numeric: Record<string, number> = {};
  for (const input of operator.inputs) {
    if ((values[input.key] ?? '').trim() === '') throw new Error(`请填写真实的${input.label}。`);
    numeric[input.key] = Number(values[input.key]);
    if (!Number.isFinite(numeric[input.key])) throw new Error(`${input.label}必须为有限数。`);
  }
  if (operator.id === 'bm' && numeric.book < 0) throw new Error('负账面权益应单独分类，不并入普通B/M计算。');
  const value = operator.calculate(numeric);
  if (!Number.isFinite(value)) throw new Error('计算结果非有限数。');
  return { value, formula: operator.formula, inputs: numeric, announcement_date: announced, as_of: asOf, source: operator.source, mode: '用户输入公式计算，未回测' };
}
