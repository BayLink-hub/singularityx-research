import { evaluateScalar } from './browserEngine';
import { OPERATOR_CATALOG, type OperatorDefinition } from './operatorCatalog';
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
export type ResearchOperator = OperatorDefinition;
export const RESEARCH_OPERATORS = OPERATOR_CATALOG;
export function calculateFundamental(operator: OperatorDefinition, values: Record<string, string>, announced: string, asOf: string) {
  if (!operator.manual) throw new Error('请选择带有手填表达式的算子。');
  if (!announced || !asOf) throw new Error('请填写实际公告日和分析时点。');
  if (announced >= asOf) throw new Error('只有公告日期，无法证明同日决策前已知；请选择晚于公告日的分析日期。');
  const numeric: Record<string, number> = {};
  for (const input of operator.manual.inputs) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(input.key)) throw new Error('输入名称不是有效标识符。');
    if ((values[input.key] ?? '').trim() === '') throw new Error(`请填写真实的${input.label}。`);
    const value = Number(values[input.key]);
    if (!Number.isFinite(value)) throw new Error(`${input.label}必须为有限数。`);
    if (input.positive && value <= 0 || input.min != null && value < input.min || input.max != null && value > input.max) throw new Error(`${input.label}不满足公式输入范围。`);
    numeric[input.key] = value;
  }
  const value = evaluateScalar(operator.manual.expression, numeric);
  if (!Number.isFinite(value)) throw new Error('当前输入超出公式定义域或分母为零，未生成替代数值。');
  return { value, operator_id: operator.id, operator_version: operator.version, formula: operator.formula, expression: operator.manual.expression, inputs: numeric, announcement_date: announced, as_of: asOf, source: operator.source, mode: '用户输入白名单公式计算，未回测' };
}
export function operatorCode(operator: OperatorDefinition, parameters: Record<string, string> = {}): string {
  if (!operator.code) throw new Error('此条目没有日频AST模板。');
  let code = operator.code;
  for (const parameter of operator.parameters || []) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(parameter.name)) throw new Error('参数名称不是有效标识符。');
    const value = Number(parameters[parameter.name] ?? parameter.default);
    if (!Number.isFinite(value) || parameter.min != null && value < parameter.min || parameter.max != null && value > parameter.max) throw new Error(`参数${parameter.name}超出允许范围。`);
    const assignment = new RegExp('^\\s*' + parameter.name + '\\s*=\\s*[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?\\s*$', 'm');
    if (!assignment.test(code)) throw new Error(`参数${parameter.name}需要在模板中有独立数值赋值行。`);
    code = code.replace(assignment, parameter.name + ' = ' + value);
  }
  return code;
}
