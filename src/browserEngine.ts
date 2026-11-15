/** Public price-research engine. No private files, eval, Function, or imports from user code. */
export type Row = Record<string, any>;
export type Matrix = number[][];
export type Expr = { type: 'constant'; value: number } | { type: 'name'; id: string } |
  { type: 'unary'; operator: string; operand: Expr } |
  { type: 'binary' | 'compare'; operator: string; left: Expr; right: Expr } |
  { type: 'call'; function: string; args: Expr[] };
export type FactorAST = { schema: 'quant.factor.ast'; version: 1; kind: 'restricted'; output: 'factor'; body: { type: 'assign'; target: string; value: Expr }[] };
export interface PublicMarket { source: Row; universe: { symbol: string; name: string; exchange: string }[]; bars: { date: string; symbol: string; open: number; high: number; low: number; close: number; volume: number; amount: number | null }[]; benchmark: { date: string; close: number }[]; coverage: { start: string; end: string } }
export const ENGINE_VERSION = 'public-price-1.0.0';
export const FIELDS = ['open', 'high', 'low', 'close', 'volume', 'amount'];
const WINDOW_OPS = ['delay', 'returns', 'ts_mean', 'ts_std', 'ts_sum', 'ts_min', 'ts_max'];
const UNARY_OPS = ['rank', 'zscore', 'abs', 'log', 'sign'];
const OPERATORS = [...WINDOW_OPS, ...UNARY_OPS, 'ts_corr', 'where', 'clip'];
const safeName = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const finite = (value: number) => Number.isFinite(value) ? value : NaN;
const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN;
const std = (x: number[]) => { if (x.length && x.every(v => v === x[0])) return 0; const m = mean(x); return Math.sqrt(mean(x.map(v => (v - m) ** 2))); };
const numeric = (n: number) => { if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new Error('常量及常量运算结果须为绝对值不超过 1e9 的有限数字'); return n; };
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const binary = (op: string, a: number, b: number): number => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  switch (op) { case '+': return finite(a + b); case '-': return finite(a - b); case '*': return finite(a * b); case '/': return b === 0 ? NaN : finite(a / b); case '<': return +(a < b); case '<=': return +(a <= b); case '>': return +(a > b); case '>=': return +(a >= b); case '==': return +(a === b); case '!=': return +(a !== b); default: throw new Error('不支持的运算'); }
};

/** Small Pratt parser. Tokens are consumed exactly; properties, strings and arbitrary calls cannot enter the AST. */
class Parser {
  tokens: string[] = []; at = 0; nodes = 0;
  constructor(source: string) {
    let remaining = source;
    while (remaining.trim()) {
      const match = /^\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|(<=|>=|==|!=|[+\-*/(),<>]))/.exec(remaining);
      if (!match) throw new Error('仅允许数值、字段、赋值及白名单算子；属性、索引、字符串和任意 Python/JS 禁止执行');
      this.tokens.push(match[1] || match[2] || match[3]); remaining = remaining.slice(match[0].length);
      if (this.tokens.length > 512) throw new Error('表达式过长');
    }
  }
  pop() { const token = this.tokens[this.at++]; if (token === undefined) throw new Error('表达式不完整'); return token; }
  expression(min = 0, depth = 0): Expr {
    if (depth > 36 || ++this.nodes > 256) throw new Error('表达式嵌套或节点数超限，请拆分步骤');
    const token = this.pop(); let left: Expr;
    if (/^(?:\d|\.)/.test(token)) left = { type: 'constant', value: numeric(Number(token)) };
    else if (token === '-' || token === '+') left = { type: 'unary', operator: token, operand: this.expression(4, depth + 1) };
    else if (token === '(') { left = this.expression(0, depth + 1); if (this.pop() !== ')') throw new Error('缺少右括号'); }
    else if (safeName.test(token)) {
      if (this.tokens[this.at] === '(') {
        if (!OPERATORS.includes(token)) throw new Error(`不支持算子 ${token}`);
        this.at++; const args: Expr[] = [];
        if (this.tokens[this.at] !== ')') { while (true) { args.push(this.expression(0, depth + 1)); if (this.tokens[this.at] !== ',') break; this.at++; } }
        if (this.pop() !== ')') throw new Error('算子参数或括号不正确');
        left = { type: 'call', function: token, args };
      } else left = { type: 'name', id: token };
    } else throw new Error('非法表达式');
    const priority: Record<string, number> = { '<': 1, '<=': 1, '>': 1, '>=': 1, '==': 1, '!=': 1, '+': 2, '-': 2, '*': 3, '/': 3 };
    while (this.at < this.tokens.length) {
      const op = this.tokens[this.at], precedence = Object.hasOwn(priority, op) ? priority[op] : undefined;
      if (precedence === undefined || precedence < min) break;
      this.at++; const right = this.expression(precedence + 1, depth + 1);
      left = { type: precedence === 1 ? 'compare' : 'binary', operator: op, left, right };
      if (++this.nodes > 256) throw new Error('语法节点过多');
    }
    return left;
  }
}
type Info = { kind: 'scalar' | 'matrix' | 'condition'; value?: number; lookback: number; deps: string[] };
function infer(node: Expr, env: Map<string, Info>): Info {
  const scalar = (value: number): Info => ({ kind: 'scalar', value: numeric(value), lookback: 0, deps: [] });
  if (node.type === 'constant') return scalar(node.value);
  if (node.type === 'name') { const info = env.get(node.id); if (!info) throw new Error(`未知字段或未定义变量 ${node.id}；公开数据没有复权价、换手率或流通市值`); return info; }
  if (node.type === 'unary') { const info = infer(node.operand, env); if (info.kind === 'condition') throw new Error('条件只能用于 where'); return info.kind === 'scalar' ? scalar(node.operator === '-' ? -info.value! : info.value!) : info; }
  const items = node.type === 'call' ? node.args.map(x => infer(x, env)) : [infer(node.left, env), infer(node.right, env)];
  let lookback = Math.max(0, ...items.map(x => x.lookback));
  const deps = Array.from(new Set(items.flatMap(x => x.deps))).sort();
  if (node.type === 'binary' || node.type === 'compare') {
    if (items.some(x => x.kind === 'condition')) throw new Error('不支持链式条件或条件算术');
    if (node.type === 'compare') { if (!deps.length) throw new Error('比较须使用数据字段'); return { kind: 'condition', lookback, deps }; }
    if (node.operator === '/' && items[1].kind === 'scalar' && items[1].value === 0) throw new Error('不能除以常量 0');
    return items.every(x => x.kind === 'scalar') ? scalar(binary(node.operator, items[0].value!, items[1].value!)) : { kind: 'matrix', lookback, deps };
  }
  if (node.type !== 'call') throw new Error('未知语法节点');
  const name = node.function, count = WINDOW_OPS.includes(name) ? 2 : UNARY_OPS.includes(name) ? 1 : 3;
  if (items.length !== count) throw new Error(`${name} 需要 ${count} 个位置参数`);
  if (name === 'where') { if (items[0].kind !== 'condition' || items.slice(1).some(x => x.kind === 'condition')) throw new Error('where 参数类型不正确'); }
  else if (items[0].kind !== 'matrix') throw new Error(`${name} 的第一个参数须是数据矩阵`);
  if (WINDOW_OPS.includes(name) || name === 'ts_corr') {
    const window = items.at(-1)!;
    if (window.kind !== 'scalar' || !Number.isInteger(window.value) || window.value! < 1 || window.value! > 252 || (['ts_corr', 'ts_std'].includes(name) && window.value! < 2)) throw new Error('窗口须为 1–252 的整数（标准差/相关至少 2），禁止未来 shift');
    if (name === 'ts_corr' && items[1].kind !== 'matrix') throw new Error('相关算子需要两个数据字段');
    lookback += ['delay', 'returns'].includes(name) ? window.value! : window.value! - 1;
  }
  if (name === 'clip' && (items[1].kind !== 'scalar' || items[2].kind !== 'scalar' || items[1].value! >= items[2].value!)) throw new Error('clip 上下界须是递增常量');
  return { kind: 'matrix', lookback, deps };
}
function render(node: Expr): string {
  if (node.type === 'constant') return String(node.value);
  if (node.type === 'name') return node.id;
  if (node.type === 'unary') return `(${node.operator}${render(node.operand)})`;
  if (node.type === 'call') return `${node.function}(${node.args.map(render).join(', ')})`;
  return `(${render(node.left)} ${node.operator} ${render(node.right)})`;
}
function walk(node: Expr): Expr[] { return [node, ...(node.type === 'call' ? node.args.flatMap(walk) : node.type === 'unary' ? walk(node.operand) : node.type === 'binary' || node.type === 'compare' ? [...walk(node.left), ...walk(node.right)] : [])]; }
export function validateCode(code: string): Row {
  try {
    if (typeof code !== 'string' || new TextEncoder().encode(code).length > 12000) throw new Error('代码须为最多 12KB 的文本');
    const lines = code.split(/\r?\n/).map(x => x.replace(/#.*/, '').trim()).filter(Boolean);
    if (!lines.length || lines.length > 32) throw new Error('需要 1–32 行赋值，最后输出 factor');
    const env = new Map<string, Info>(FIELDS.map(f => [f, { kind: 'matrix', lookback: 0, deps: [f] }]));
    const ast: FactorAST = { schema: 'quant.factor.ast', version: 1, kind: 'restricted', output: 'factor', body: [] };
    const steps: Row[] = [], parameters: Row = {}; let nodeCount = 0;
    lines.forEach((line, index) => {
      const assignment = /^([A-Za-z][A-Za-z0-9_]{0,47})\s*=\s*(?!=)(.+)$/.exec(line);
      if (!assignment) throw new Error(`第 ${index + 1} 行只允许 name = expression`);
      const [, target, expression] = assignment;
      if (env.has(target) || OPERATORS.includes(target)) throw new Error(`不能重复赋值或覆盖字段/算子 ${target}`);
      const parser = new Parser(expression), value = parser.expression();
      if (parser.at !== parser.tokens.length) throw new Error(`第 ${index + 1} 行存在未识别内容`);
      nodeCount += parser.nodes; if (nodeCount > 256) throw new Error('程序超过 256 个语法节点');
      const info = infer(value, env);
      if (info.lookback > 252) throw new Error(`累计历史依赖 ${info.lookback} 日超过 252 日上限`);
      if (target === 'factor' && (index !== lines.length - 1 || info.kind !== 'matrix')) throw new Error('最后一行 factor 必须是数值矩阵');
      env.set(target, info); if (info.kind === 'scalar') parameters[target] = info.value;
      const nodes = walk(value), calls = nodes.filter((x): x is Extract<Expr, { type: 'call' }> => x.type === 'call');
      const windows = calls.filter(x => WINDOW_OPS.includes(x.function) || x.function === 'ts_corr').map(x => infer(x.args.at(-1)!, env).value!);
      steps.push({ index: index + 1, target, code: `${target} = ${render(value)}`, kind: target === 'factor' ? 'output' : info.kind === 'scalar' ? 'parameter' : 'transform', operation: calls.map(x => x.function).join(', ') || value.type, inputs: [...new Set(nodes.filter((x): x is Extract<Expr, { type: 'name' }> => x.type === 'name').map(x => x.id))], dependencies: info.deps, window: windows.length ? Math.max(...windows) : null, lookback_days: info.lookback });
      ast.body.push({ type: 'assign', target, value });
    });
    if (ast.body.at(-1)?.target !== 'factor') throw new Error('最后一行必须为 factor = ...');
    return { valid: true, ast, code: steps.map(x => x.code).join('\n'), dependencies: [...new Set(steps.flatMap(x => x.dependencies))].sort(), parameters, steps, warmup_days: Math.max(...steps.map(x => x.lookback_days)), errors: [] };
  } catch (error) { return { valid: false, ast: null, code, dependencies: [], parameters: {}, steps: [], warmup_days: null, errors: [error instanceof Error ? error.message : String(error)] }; }
}

export function ranks(values: number[]): number[] {
  const ordered = values.map((value, i) => ({ value, i })).filter(x => Number.isFinite(x.value)).sort((a, b) => a.value - b.value || a.i - b.i);
  const result = values.map(() => NaN); let i = 0;
  while (i < ordered.length) { let j = i + 1; while (j < ordered.length && ordered[j].value === ordered[i].value) j++; for (let k = i; k < j; k++) result[ordered[k].i] = (i + 1 + j) / 2; i = j; }
  return result;
}
function correlation(a: number[], b: number[]): number {
  if (a.length < 2 || a.length !== b.length || a.every(v => v === a[0]) || b.every(v => v === b[0])) return NaN;
  const ma = mean(a), mb = mean(b); let xy = 0, xx = 0, yy = 0;
  a.forEach((x, i) => { xy += (x - ma) * (b[i] - mb); xx += (x - ma) ** 2; yy += (b[i] - mb) ** 2; });
  return xx > 0 && yy > 0 ? finite(xy / Math.sqrt(xx * yy)) : NaN;
}
export function evaluateCode(code: string, frames: Record<string, Matrix>, frozenAst?: FactorAST): Matrix {
  const parsed = validateCode(code); if (!parsed.valid) throw new Error(parsed.errors.join('；'));
  if (frozenAst && JSON.stringify(frozenAst) !== JSON.stringify(parsed.ast)) throw new Error('冻结 AST 与代码不一致，拒绝执行');
  const first = frames[parsed.dependencies[0]]; if (!first?.length || !first[0]?.length || first.length * first[0].length > 100000) throw new Error('数据矩阵为空或超过公开浏览器计算上限');
  const rows = first.length, cols = first[0].length, env = new Map<string, number | Matrix>();
  const scalarEnv = new Map<string, Info>(Object.entries(parsed.parameters).map(([name, value]) => [name, { kind: 'scalar', value: value as number, lookback: 0, deps: [] }]));
  const workPerCell = (parsed.ast as FactorAST).body.flatMap(statement => walk(statement.value)).reduce((sum, node) => {
    if (node.type !== 'call') return sum + (['unary', 'binary', 'compare'].includes(node.type) ? 1 : 0);
    if (node.function.startsWith('ts_')) return sum + infer(node.args.at(-1)!, scalarEnv).value! * (node.function === 'ts_corr' ? 2 : 1);
    return sum + (node.function === 'rank' ? Math.max(1, Math.ceil(Math.log2(cols))) : 1);
  }, 0);
  const estimatedWork = workPerCell * rows * cols;
  if (estimatedWork > 20_000_000) throw new Error('公式与数据规模超过浏览器计算预算，请减少滚动步骤或缩短窗口');
  for (const field of parsed.dependencies) { const value = frames[field]; if (!value || value.length !== rows || value.some(x => x.length !== cols)) throw new Error(`字段 ${field} 缺失或未对齐`); if (!value.some(row => row.some(Number.isFinite))) throw new Error(`字段 ${field} 在当前公开行情中完全缺失，不能以 0 或其他代理替代`); env.set(field, value); }
  const cell = (value: number | Matrix, i: number, j: number) => typeof value === 'number' ? value : value[i][j];
  const map = (fn: (i: number, j: number) => number): Matrix => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => finite(fn(i, j))));
  function execute(node: Expr): number | Matrix {
    if (node.type === 'constant') return node.value;
    if (node.type === 'name') return env.get(node.id)!;
    if (node.type === 'unary') { const x = execute(node.operand); return typeof x === 'number' ? (node.operator === '-' ? -x : x) : map((i, j) => node.operator === '-' ? -x[i][j] : x[i][j]); }
    if (node.type === 'binary' || node.type === 'compare') { const a = execute(node.left), b = execute(node.right); return typeof a === 'number' && typeof b === 'number' ? binary(node.operator, a, b) : map((i, j) => binary(node.operator, cell(a, i, j), cell(b, i, j))); }
    if (node.type !== 'call') throw new Error('未知语法节点');
    const args = node.args.map(execute), x = args[0] as Matrix, name = node.function, n = args.at(-1) as number;
    if (name === 'delay') return map((i, j) => i >= n ? x[i - n][j] : NaN);
    if (name === 'returns') return map((i, j) => i >= n ? binary('/', x[i][j], x[i - n][j]) - 1 : NaN);
    if (name.startsWith('ts_')) return map((i, j) => {
      if (i < n - 1) return NaN;
      const values = Array.from({ length: n }, (_, k) => x[i - n + 1 + k][j]);
      if (values.some(v => !Number.isFinite(v))) return NaN;
      if (name === 'ts_mean') return mean(values); if (name === 'ts_sum') return values.reduce((a, b) => a + b, 0);
      if (name === 'ts_std') return std(values); if (name === 'ts_min') return Math.min(...values); if (name === 'ts_max') return Math.max(...values);
      const y = args[1] as Matrix, other = Array.from({ length: n }, (_, k) => y[i - n + 1 + k][j]);
      return other.every(Number.isFinite) ? correlation(values, other) : NaN;
    });
    if (name === 'rank') return x.map(row => { const rank = ranks(row), count = rank.filter(Number.isFinite).length; return rank.map(v => v / count); });
    if (name === 'zscore') return x.map(row => { const usable = row.filter(Number.isFinite), m = mean(usable), s = std(usable); return row.map(v => s > 0 ? finite((v - m) / s) : NaN); });
    if (name === 'abs') return map((i, j) => Math.abs(x[i][j]));
    if (name === 'sign') return map((i, j) => Math.sign(x[i][j]));
    if (name === 'log') return map((i, j) => x[i][j] > 0 ? Math.log(x[i][j]) : NaN);
    if (name === 'clip') return map((i, j) => Math.max(args[1] as number, Math.min(args[2] as number, x[i][j])));
    if (name === 'where') return map((i, j) => !Number.isFinite(x[i][j]) ? NaN : cell(x[i][j] ? args[1] : args[2], i, j));
    throw new Error('未实现算子');
  }
  parsed.ast.body.forEach((statement: FactorAST['body'][number]) => env.set(statement.target, execute(statement.value)));
  return (env.get('factor') as Matrix).map(row => row.slice());
}

export function marketFrames(data: PublicMarket) {
  if (!data?.source?.provider || !data.source.url || !Array.isArray(data.universe) || !Array.isArray(data.bars) || !data.bars.length) throw new Error('公开行情文件缺少来源或数据');
  if (data.universe.length > 100 || data.bars.length > 100000) throw new Error('公开行情超过浏览器规模限制');
  const symbols = data.universe.map(x => x.symbol).sort(), dates = [...new Set(data.bars.map(b => b.date))].sort();
  if (new Set(symbols).size !== symbols.length || !symbols.length) throw new Error('证券清单有重复或为空');
  const benchmarkDates = new Set<string>();
  for (const point of data.benchmark || []) { if (!isoDate(point.date) || !Number.isFinite(point.close) || point.close <= 0 || benchmarkDates.has(point.date)) throw new Error('基准存在重复日期或无效报价'); benchmarkDates.add(point.date); }
  const si = new Map(symbols.map((s, i) => [s, i])), di = new Map(dates.map((d, i) => [d, i]));
  const frames = Object.fromEntries(FIELDS.map(field => [field, dates.map(() => symbols.map(() => NaN))])) as Record<string, Matrix>, keys = new Set();
  for (const bar of data.bars) {
    if (!isoDate(bar.date) || !si.has(bar.symbol)) throw new Error('行情日期或证券代码不合法');
    const key = bar.date + '|' + bar.symbol; if (keys.has(key)) throw new Error(`行情存在重复主键 ${key}`); keys.add(key);
    if (FIELDS.filter(f => f !== 'amount').some(f => !Number.isFinite((bar as any)[f])) || Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) || bar.volume < 0 || (bar.amount !== null && (!Number.isFinite(bar.amount) || bar.amount < 0))) throw new Error(`行情字段异常 ${key}`);
    for (const field of FIELDS) frames[field][di.get(bar.date)!][si.get(bar.symbol)!] = (bar as any)[field] === null ? NaN : (bar as any)[field];
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
  return jsonSafe({ metrics, curves, ic, groups, yearly: period(4, 'year'), monthly: period(7, 'month'), trades, holdings, diagnostics: { coverage, group_coverage: groupCoverage, rejected_orders: rejected, initial_day_cash_only: true }, warnings, provenance: { engine: ENGINE_VERSION, source: data.source, universe: data.universe, sample_status: '固定公开小样本的探索研究，非全A或样本外验证', config: c, factor_versions: factors.map(f => ({ id: f.id, version: f.version, name: f.name, code: f.code, ast: f.ast, weight: f.weight ?? 1 })), information_time: 't收盘形成信号→t+1开盘；首个研究日保持现金', quantity_unit: '股（100股整手，缺少公司行动调整）', return_basis: '未复权价格收益', grouping: '信号日先分组；每horizon日一批不重叠开盘至开盘收益，缺报价不重选成员', icir: '日度IC均值/总体标准差×sqrt(252)，重叠持有期导致相关性，非显著性检验', source_start: dates[0], source_end: dates.at(-1) } });
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
export function publicOperators(): Row[] {
  const descriptions: Record<string, string> = { delay: '过去 n 个交易日，禁止未来位移。', returns: 'x/delay(x,n)-1；未复权价格可能包含除权跳变。', ts_mean: '完整 n 日窗口均值。', ts_std: '完整 n 日总体标准差。', ts_sum: '完整 n 日求和。', ts_min: '完整 n 日最小值。', ts_max: '完整 n 日最大值。', ts_corr: '两字段完整 n 日 Pearson 相关。', rank: '按日横截面百分位秩，并列取平均。', zscore: '按日标准化，常量截面保持缺失。', abs: '绝对值。', log: '自然对数，非正数为空。', sign: '数值符号。', where: '按比较条件选择值，缺失条件保持缺失。', clip: '按照常数上下界截断。' };
  return [...OPERATORS.map(name => ({ name, category: WINDOW_OPS.includes(name) || name === 'ts_corr' ? '时间序列' : '截面与数值', signature: `${name}(${WINDOW_OPS.includes(name) ? 'x, n' : name === 'ts_corr' ? 'x, y, n' : name === 'where' ? 'condition, a, b' : name === 'clip' ? 'x, lower, upper' : 'x'})`, description: descriptions[name] })), ...FIELDS.map(name => ({ name, category: '字段', signature: name, description: name === 'amount' ? '成交额字段在当前公开源中缺失（null），依赖它的公式会拒绝运行；不以0或估计值冒充。' : name === 'volume' ? '日成交量，单位股（原始手数已换算）；t日收盘后可得。' : `未复权${({ open: '开盘', high: '最高', low: '最低', close: '收盘' } as Row)[name]}价，单位元；统一按t日收盘信息处理。` }))];
}
