/** Bounded numerical DSL; user text is interpreted, never executed as JS or Python. */
export type Row = Record<string, any>;
export type Matrix = number[][];
export type GroupMatrix = (string | number | null)[][];
export type Frames = Record<string, Matrix | GroupMatrix>;
export type Expr = {
    type: 'constant';
    value: number;
} | {
    type: 'name';
    id: string;
} | {
    type: 'unary';
    operator: string;
    operand: Expr;
} | {
    type: 'binary' | 'compare';
    operator: string;
    left: Expr;
    right: Expr;
} | {
    type: 'call';
    function: string;
    args: Expr[];
};
export type FactorAST = {
    schema: 'quant.factor.ast';
    version: 1;
    kind: 'restricted';
    output: 'factor';
    body: {
        type: 'assign';
        target: string;
        value: Expr;
    }[];
};
export const LANGUAGE_VERSION = 'factor-language-2.0.0';
export const GROUP_FIELDS = ['sector', 'industry', 'subindustry'];
export const FIELDS = ['open', 'high', 'low', 'close', 'volume', 'amount', 'vwap', 'cap', 'turnover', 'float_cap', 'adj_open', 'adj_high', 'adj_low', 'adj_close', 'adj_factor', ...GROUP_FIELDS];
const WINDOWS = ['delay', 'returns', 'delta', 'ts_mean', 'ts_std', 'ts_sum', 'ts_min', 'ts_max', 'ts_rank', 'ts_pct', 'ts_argmax', 'ts_argmin', 'decay_linear', 'ts_product', 'ts_ema', 'ts_slope', 'ts_resi', 'ts_rsquare'];
const PAIRS = ['ts_corr', 'ts_cov', 'ts_beta', 'ts_regression_slope', 'ts_regression_resi', 'ts_regression_rsquare'];
const UNARY = ['abs', 'log', 'sign', 'logical_not'];
const BINARY = ['power', 'signed_power', 'minimum', 'maximum', 'logical_and', 'logical_or', 'safe_div', 'spread', 'geom_mean', 'harm_mean'];
const CROSS = ['rank', 'zscore', 'scale', 'indneutralize'];
const OPS = [...WINDOWS, ...PAIRS, ...UNARY, ...BINARY, ...CROSS, 'where', 'clip'];
const ALIASES: Record<string, string> = { correlation: 'ts_corr', covariance: 'ts_cov', stddev: 'ts_std', sum: 'ts_sum', product: 'ts_product', signedpower: 'signed_power', pow: 'power', min: 'minimum', max: 'maximum', ema: 'ts_ema', ts_decay_linear: 'decay_linear' };
const safeName = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
export const finite = (n: number) => Number.isFinite(n) ? n : NaN;
export const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN;
export const std = (x: number[]) => { if (x.length && x.every(v => v === x[0]))
    return 0; const m = mean(x); return Math.sqrt(mean(x.map(v => (v - m) ** 2))); };
const numeric = (n: number) => { if (!Number.isFinite(n) || Math.abs(n) > 1e9)
    throw new Error('常量及常量运算结果须为绝对值不超过1e9的有限数字'); return n; };
export function binary(op: string, a: number, b: number): number { if (!Number.isFinite(a) || !Number.isFinite(b))
    return NaN; switch (op) {
    case '+': return finite(a + b);
    case '-': return finite(a - b);
    case '*': return finite(a * b);
    case '/': return b === 0 ? NaN : finite(a / b);
    case '**': return finite(Math.pow(a, b));
    case '<': return +(a < b);
    case '<=': return +(a <= b);
    case '>': return +(a > b);
    case '>=': return +(a >= b);
    case '==': return +(a === b);
    case '!=': return +(a !== b);
    default: throw new Error('不支持的运算');
} }
function element(name: string, a: number, b?: number, c?: number): number {
    if (name === 'where')
        return Number.isFinite(a) ? (a !== 0 ? b! : c!) : NaN;
    if (!Number.isFinite(a) || (b !== undefined && !Number.isFinite(b)) || (c !== undefined && !Number.isFinite(c)))
        return NaN;
    switch (name) {
        case 'abs': return Math.abs(a);
        case 'log': return a > 0 ? Math.log(a) : NaN;
        case 'sign': return Math.sign(a);
        case 'logical_not': return +(a === 0);
        case 'logical_and': return +(a !== 0 && b !== 0);
        case 'logical_or': return +(a !== 0 || b !== 0);
        case 'power':
        case 'signed_power': return finite(Math.pow(a, b!));
        case 'minimum': return Math.min(a, b!);
        case 'maximum': return Math.max(a, b!);
        case 'safe_div': return binary('/', a, b!);
        case 'spread': return binary('/', a - b!, Math.abs(a) + Math.abs(b!));
        case 'geom_mean': return a >= 0 && b! >= 0 ? finite(Math.sqrt(a * b!)) : NaN;
        case 'harm_mean': return a > 0 && b! > 0 ? finite(2 * a * b! / (a + b!)) : NaN;
        case 'clip': return Math.max(b!, Math.min(c!, a));
        default: throw new Error(`未实现标量算子 ${name}`);
    }
}
const call = (name: string, args: Expr[]): Expr => ({ type: 'call', function: name, args });
const constant = (value: number): Expr => ({ type: 'constant', value });
class Parser {
    tokens: string[] = [];
    at = 0;
    nodes = 0;
    constructor(source: string) { let remaining = source; while (remaining.trim()) {
        const match = /^\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|(<=|>=|==|!=|\*\*|\|\||&&|[+\-*/^(),<>!?:]))/.exec(remaining);
        if (!match)
            throw new Error('仅允许数值、字段及白名单算子；属性、索引、字符串和任意程序禁止执行');
        this.tokens.push(match[1] || match[2] || match[3]);
        remaining = remaining.slice(match[0].length);
        if (this.tokens.length > 1024)
            throw new Error('表达式过长');
    } }
    pop() { const t = this.tokens[this.at++]; if (t === undefined)
        throw new Error('表达式不完整'); return t; }
    expression(min = 0, depth = 0): Expr {
        if (depth > 40 || ++this.nodes > 256)
            throw new Error('表达式嵌套或节点数超限，请拆分步骤');
        const token = this.pop();
        let left: Expr;
        if (/^(?:\d|\.)/.test(token))
            left = constant(numeric(Number(token)));
        else if (token === '-' || token === '+')
            left = { type: 'unary', operator: token, operand: this.expression(6, depth + 1) };
        else if (token === '!')
            left = call('logical_not', [this.expression(6, depth + 1)]);
        else if (token === '(') {
            left = this.expression(0, depth + 1);
            if (this.pop() !== ')')
                throw new Error('缺少右括号');
        }
        else if (safeName.test(token)) {
            const lower = token.toLowerCase(), name = Object.hasOwn(ALIASES, lower) ? ALIASES[lower] : lower;
            if (this.tokens[this.at] === '(') {
                if (!OPS.includes(name) && name !== 'adv')
                    throw new Error(`不支持算子 ${token}`);
                this.at++;
                const args: Expr[] = [];
                if (this.tokens[this.at] !== ')') {
                    while (true) {
                        args.push(this.expression(0, depth + 1));
                        if (this.tokens[this.at] !== ',')
                            break;
                        this.at++;
                    }
                }
                if (this.pop() !== ')')
                    throw new Error('算子参数或括号不正确');
                if (name === 'adv') {
                    if (args.length !== 1)
                        throw new Error('adv(n)需要一个窗口');
                    left = call('ts_mean', [{ type: 'name', id: 'amount' }, args[0]]);
                }
                else
                    left = call(name, name === 'scale' && args.length === 1 ? [...args, constant(1)] : args);
            }
            else if (lower === 'returns')
                left = call('returns', [{ type: 'name', id: 'close' }, constant(1)]);
            else if (/^adv\d+$/.test(lower))
                left = call('ts_mean', [{ type: 'name', id: 'amount' }, constant(Number(lower.slice(3)))]);
            else
                left = { type: 'name', id: token };
        }
        else
            throw new Error('非法表达式');
        const priority: Record<string, number> = { '||': 1, '&&': 2, '<': 3, '<=': 3, '>': 3, '>=': 3, '==': 3, '!=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '^': 7, '**': 7 };
        while (this.at < this.tokens.length) {
            const op = this.tokens[this.at], p = Object.hasOwn(priority, op) ? priority[op] : undefined;
            if (p === undefined || p < min)
                break;
            this.at++;
            const right = this.expression(p + (p === 7 ? 0 : 1), depth + 1);
            left = op === '&&' || op === '||' ? call(op === '&&' ? 'logical_and' : 'logical_or', [left, right]) : { type: p === 3 ? 'compare' : 'binary', operator: op === '^' ? '**' : op, left, right };
            if (++this.nodes > 256)
                throw new Error('语法节点过多');
        }
        if (min === 0 && this.tokens[this.at] === '?') {
            this.at++;
            const yes = this.expression(0, depth + 1);
            if (this.pop() !== ':')
                throw new Error('条件表达式缺少:');
            left = call('where', [left, yes, this.expression(0, depth + 1)]);
        }
        return left;
    }
}
type Info = {
    kind: 'scalar' | 'matrix' | 'group';
    value?: number;
    lookback: number;
    deps: string[];
};
const windowed = (name: string) => WINDOWS.includes(name) || PAIRS.includes(name);
function infer(node: Expr, env: Map<string, Info>): Info {
    const scalar = (value: number): Info => ({ kind: 'scalar', value: numeric(value), lookback: 0, deps: [] });
    if (node.type === 'constant')
        return scalar(node.value);
    if (node.type === 'name') {
        const info = env.get(node.id);
        if (!info)
            throw new Error(`未知字段或未定义变量 ${node.id}`);
        return info;
    }
    if (node.type === 'unary') {
        const info = infer(node.operand, env);
        if (info.kind === 'group')
            throw new Error('行业标签只能用于indneutralize');
        return info.kind === 'scalar' ? scalar(node.operator === '-' ? -info.value! : info.value!) : info;
    }
    const items = node.type === 'call' ? node.args.map(x => infer(x, env)) : [infer(node.left, env), infer(node.right, env)];
    let lookback = Math.max(0, ...items.map(x => x.lookback));
    const deps = [...new Set(items.flatMap(x => x.deps))].sort();
    if (node.type === 'binary' || node.type === 'compare') {
        if (items.some(x => x.kind === 'group'))
            throw new Error('行业标签不能参与数值运算');
        if (node.operator === '**' && items[1].kind === 'scalar' && Math.abs(items[1].value!) > 1000)
            throw new Error('常量幂指数绝对值不能超过1000');
        if (node.operator === '/' && items[1].kind === 'scalar' && items[1].value === 0)
            throw new Error('不能除以常量0');
        return items.every(x => x.kind === 'scalar') ? scalar(binary(node.operator, items[0].value!, items[1].value!)) : { kind: 'matrix', lookback, deps };
    }
    if (node.type !== 'call')
        throw new Error('未知语法节点');
    const name = node.function, count = WINDOWS.includes(name) || BINARY.includes(name) || ['scale', 'indneutralize'].includes(name) ? 2 : PAIRS.includes(name) || ['where', 'clip'].includes(name) ? 3 : 1;
    if (['power', 'signed_power'].includes(name) && items[1]?.kind === 'scalar' && Math.abs(items[1].value!) > 1000)
        throw new Error('常量幂指数绝对值不能超过1000');
    if (items.length !== count)
        throw new Error(`${name}需要${count}个位置参数`);
    if (name === 'indneutralize') {
        if (items[0].kind !== 'matrix' || items[1].kind !== 'group')
            throw new Error('indneutralize需要数值与真实分类矩阵');
    }
    else if (items.some(x => x.kind === 'group'))
        throw new Error('行业标签只能用于indneutralize');
    if (windowed(name)) {
        if (items[0].kind !== 'matrix' || (PAIRS.includes(name) && items[1].kind !== 'matrix'))
            throw new Error(`${name}需要数据矩阵`);
        const n = items.at(-1)!;
        if (n.kind !== 'scalar' || !Number.isInteger(n.value) || n.value! < 1 || n.value! > 252 || (['ts_std', 'ts_slope', 'ts_resi', 'ts_rsquare', ...PAIRS].includes(name) && n.value! < 2))
            throw new Error('窗口须为1–252整数（标准差/回归/相关至少2），禁止未来shift；论文小数窗先向下取整');
        lookback += ['delay', 'returns', 'ts_pct', 'delta'].includes(name) ? n.value! : n.value! - 1;
    }
    if (CROSS.includes(name) && items[0].kind !== 'matrix')
        throw new Error(`${name}需要数据矩阵`);
    if (name === 'scale' && (items[1].kind !== 'scalar' || items[1].value! <= 0))
        throw new Error('scale目标绝对和须为正常量');
    if (name === 'clip' && (items[1].kind !== 'scalar' || items[2].kind !== 'scalar' || items[1].value! >= items[2].value!))
        throw new Error('clip上下界须是递增常量');
    if (items.every(x => x.kind === 'scalar'))
        return scalar(element(name, ...items.map(x => x.value!) as [
            number,
            number?,
            number?
        ]));
    return { kind: 'matrix', lookback, deps };
}
export function renderExpression(node: Expr): string { if (node.type === 'constant')
    return String(node.value); if (node.type === 'name')
    return node.id; if (node.type === 'unary')
    return `(${node.operator}${renderExpression(node.operand)})`; if (node.type === 'call')
    return `${node.function}(${node.args.map(renderExpression).join(', ')})`; return `(${renderExpression(node.left)} ${node.operator} ${renderExpression(node.right)})`; }
export function walkExpression(node: Expr): Expr[] { return [node, ...(node.type === 'call' ? node.args.flatMap(walkExpression) : node.type === 'unary' ? walkExpression(node.operand) : node.type === 'binary' || node.type === 'compare' ? [...walkExpression(node.left), ...walkExpression(node.right)] : [])]; }
export function parseExpression(source: string): Expr { if (typeof source !== 'string' || source.length > 12000)
    throw new Error('表达式长度超限'); const p = new Parser(source), x = p.expression(); if (p.at !== p.tokens.length)
    throw new Error(`表达式存在未识别内容 ${p.tokens[p.at]}`); return x; }
export function validateCode(code: string): Row {
    try {
        if (typeof code !== 'string' || new TextEncoder().encode(code).length > 12000)
            throw new Error('代码须为最多12KB文本');
        const lines = code.split(/\r?\n/).map(x => x.replace(/#.*/, '').trim()).filter(Boolean);
        if (!lines.length || lines.length > 32)
            throw new Error('需要1–32行赋值，最后输出factor');
        const env = new Map<string, Info>(FIELDS.map(f => [f, { kind: GROUP_FIELDS.includes(f) ? 'group' : 'matrix', lookback: 0, deps: [f] }]));
        const ast: FactorAST = { schema: 'quant.factor.ast', version: 1, kind: 'restricted', output: 'factor', body: [] };
        const steps: Row[] = [], parameters: Row = {};
        let nodeCount = 0;
        lines.forEach((line, index) => {
            const assignment = /^([A-Za-z][A-Za-z0-9_]{0,47})\s*=\s*(?!=)(.+)$/.exec(line);
            if (!assignment)
                throw new Error(`第${index + 1}行只允许name=expression`);
            const [, target, expression] = assignment;
            if (env.has(target) || OPS.includes(target) || target === 'adv' || /^adv\d+$/.test(target))
                throw new Error(`不能重复赋值或覆盖字段/算子 ${target}`);
            const value = parseExpression(expression);
            nodeCount += walkExpression(value).length;
            if (nodeCount > 256)
                throw new Error('程序超过256语法节点');
            const info = infer(value, env);
            if (info.lookback > 252)
                throw new Error(`累计历史依赖${info.lookback}日超过252日上限`);
            if (target === 'factor' && (index !== lines.length - 1 || info.kind !== 'matrix'))
                throw new Error('最后一行factor必须是数值矩阵');
            env.set(target, info);
            if (info.kind === 'scalar')
                parameters[target] = info.value;
            const nodes = walkExpression(value), calls = nodes.filter((x): x is Extract<Expr, {
                type: 'call';
            }> => x.type === 'call'), windows = calls.filter(x => windowed(x.function)).map(x => infer(x.args.at(-1)!, env).value!);
            steps.push({ index: index + 1, target, code: `${target} = ${renderExpression(value)}`, kind: target === 'factor' ? 'output' : info.kind === 'scalar' ? 'parameter' : 'transform', operation: calls.map(x => x.function).join(', ') || value.type, inputs: [...new Set(nodes.filter((x): x is Extract<Expr, {
                        type: 'name';
                    }> => x.type === 'name').map(x => x.id))], dependencies: info.deps, window: windows.length ? Math.max(...windows) : null, lookback_days: info.lookback });
            ast.body.push({ type: 'assign', target, value });
        });
        if (ast.body.at(-1)?.target !== 'factor')
            throw new Error('最后一行必须为factor=...');
        return { valid: true, ast, code: steps.map(x => x.code).join('\n'), dependencies: [...new Set(steps.flatMap(x => x.dependencies))].sort(), parameters, steps, warmup_days: Math.max(...steps.map(x => x.lookback_days)), language_version: LANGUAGE_VERSION, errors: [] };
    }
    catch (error) {
        return { valid: false, ast: null, code, dependencies: [], parameters: {}, steps: [], warmup_days: null, errors: [error instanceof Error ? error.message : String(error)] };
    }
}
export function ranks(values: number[]): number[] { const ordered = values.map((value, i) => ({ value, i })).filter(x => Number.isFinite(x.value)).sort((a, b) => a.value - b.value || a.i - b.i), result = values.map(() => NaN); let i = 0; while (i < ordered.length) {
    let j = i + 1;
    while (j < ordered.length && ordered[j].value === ordered[i].value)
        j++;
    for (let k = i; k < j; k++)
        result[ordered[k].i] = (i + 1 + j) / 2;
    i = j;
} return result; }
export function correlation(a: number[], b: number[]): number { if (a.length < 2 || a.length !== b.length || a.every(v => v === a[0]) || b.every(v => v === b[0]))
    return NaN; const ma = mean(a), mb = mean(b); let xy = 0, xx = 0, yy = 0; a.forEach((x, i) => { xy += (x - ma) * (b[i] - mb); xx += (x - ma) ** 2; yy += (b[i] - mb) ** 2; }); return xx > 0 && yy > 0 ? finite(xy / Math.sqrt(xx * yy)) : NaN; }
function regression(y: number[], x: number[]) {
    if (x.every(v => v === x[0])) return { slope: NaN, resi: NaN, rsquare: NaN };
    if (y.every(v => v === y[0])) return { slope: 0, resi: 0, rsquare: NaN };
    const mx = mean(x), my = mean(y), xx = x.reduce((s, v) => s + (v - mx) ** 2, 0), xy = x.reduce((s, v, k) => s + (v - mx) * (y[k] - my), 0); if (!(xx > 0))
    return { slope: NaN, resi: NaN, rsquare: NaN }; const slope = xy / xx, res = y.map((v, k) => v - (my + slope * (x[k] - mx))), total = y.reduce((s, v) => s + (v - my) ** 2, 0); return { slope, resi: res.at(-1)!, rsquare: total > 0 ? Math.max(0, Math.min(1, 1 - res.reduce((s, v) => s + v * v, 0) / total)) : NaN }; }
export function evaluateCode(code: string, frames: Frames, frozenAst?: FactorAST): Matrix {
    const parsed = validateCode(code);
    if (!parsed.valid)
        throw new Error(parsed.errors.join('；'));
    if (frozenAst && JSON.stringify(frozenAst) !== JSON.stringify(parsed.ast))
        throw new Error('冻结 AST 与代码不一致，拒绝执行');
    const first = frames[parsed.dependencies[0]];
    if (!first?.length || !first[0]?.length || first.length * first[0].length > 100000)
        throw new Error('数据矩阵为空或超过浏览器计算上限');
    const rows = first.length, cols = first[0].length, env = new Map<string, number | Matrix | GroupMatrix>(), scalarEnv = new Map<string, Info>(Object.entries(parsed.parameters).map(([name, value]) => [name, { kind: 'scalar', value: value as number, lookback: 0, deps: [] }]));
    const work = (parsed.ast as FactorAST).body.flatMap(s => walkExpression(s.value)).reduce((sum, node) => { if (node.type !== 'call')
        return sum + (['unary', 'binary', 'compare'].includes(node.type) ? 1 : 0); if (windowed(node.function)) {
        const n = infer(node.args.at(-1)!, scalarEnv).value!;
        return sum + n * (node.function === 'ts_rank' ? Math.max(1, Math.ceil(Math.log2(n))) : PAIRS.includes(node.function) ? 3 : 1);
    } return sum + (node.function === 'rank' ? Math.max(1, Math.ceil(Math.log2(cols))) : 1); }, 0);
    if (work * rows * cols > 40000000)
        throw new Error('公式与数据规模超过浏览器计算预算，请减少滚动步骤或缩短窗口');
    for (const field of parsed.dependencies) {
        const value = frames[field];
        if (!value || value.length !== rows || value.some(x => x.length !== cols))
            throw new Error(`字段${field}缺失或未对齐`);
        const valid = GROUP_FIELDS.includes(field) ? (v: unknown) => (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v)) : Number.isFinite;
        if (!value.some(row => row.some(valid)))
            throw new Error(`字段${field}在当前数据中完全缺失，不能以0或其他代理替代`);
        env.set(field, GROUP_FIELDS.includes(field) ? value : value.map(row => row.map(v => typeof v === 'number' ? finite(v) : NaN)));
    }
    const cell = (v: number | Matrix | GroupMatrix, i: number, j: number): number => typeof v === 'number' ? v : typeof v[i][j] === 'number' ? v[i][j] as number : NaN;
    const map = (fn: (i: number, j: number) => number): Matrix => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => finite(fn(i, j))));
    function execute(node: Expr): number | Matrix | GroupMatrix {
        if (node.type === 'constant')
            return node.value;
        if (node.type === 'name')
            return env.get(node.id)!;
        if (node.type === 'unary') {
            const x = execute(node.operand);
            return typeof x === 'number' ? (node.operator === '-' ? -x : x) : map((i, j) => node.operator === '-' ? -cell(x, i, j) : cell(x, i, j));
        }
        if (node.type === 'binary' || node.type === 'compare') {
            const a = execute(node.left), b = execute(node.right);
            return typeof a === 'number' && typeof b === 'number' ? binary(node.operator, a, b) : map((i, j) => binary(node.operator, cell(a, i, j), cell(b, i, j)));
        }
        if (node.type !== 'call')
            throw new Error('未知语法节点');
        const args = node.args.map(execute), x = args[0] as Matrix, name = node.function, n = args.at(-1) as number;
        if (name === 'delay')
            return map((i, j) => i >= n ? x[i - n][j] : NaN);
        if (name === 'returns' || name === 'ts_pct')
            return map((i, j) => i >= n ? binary('/', x[i][j], x[i - n][j]) - 1 : NaN);
        if (name === 'delta')
            return map((i, j) => i >= n ? binary('-', x[i][j], x[i - n][j]) : NaN);
        if (windowed(name))
            return map((i, j) => {
                if (i < n - 1)
                    return NaN;
                const v = Array.from({ length: n }, (_, k) => cell(x, i - n + 1 + k, j));
                if (v.some(a => !Number.isFinite(a)))
                    return NaN;
                if (name === 'ts_mean')
                    return mean(v);
                if (name === 'ts_sum')
                    return v.reduce((a, b) => a + b, 0);
                if (name === 'ts_std')
                    return std(v);
                if (name === 'ts_min')
                    return Math.min(...v);
                if (name === 'ts_max')
                    return Math.max(...v);
                if (name === 'ts_rank')
                    return ranks(v).at(-1)!;
                if (name === 'ts_argmax')
                    return v.indexOf(Math.max(...v)) + 1;
                if (name === 'ts_argmin')
                    return v.indexOf(Math.min(...v)) + 1;
                if (name === 'ts_product')
                    return v.reduce((a, b) => a * b, 1);
                if (name === 'decay_linear')
                    return v.reduce((s, a, k) => s + a * (k + 1), 0) / (n * (n + 1) / 2);
                if (name === 'ts_ema') {
                    const a = 2 / (n + 1);
                    return v.slice(1).reduce((e, z) => a * z + (1 - a) * e, v[0]);
                }
                if (['ts_slope', 'ts_resi', 'ts_rsquare'].includes(name))
                    return regression(v, v.map((_, k) => k + 1))[name.slice(3) as 'slope' | 'resi' | 'rsquare'];
                const other = Array.from({ length: n }, (_, k) => cell(args[1], i - n + 1 + k, j));
                if (!other.every(Number.isFinite))
                    return NaN;
                if (name === 'ts_corr')
                    return correlation(v, other);
                if (name === 'ts_cov') {
                    const a = mean(v), b = mean(other);
                    return v.reduce((s, z, k) => s + (z - a) * (other[k] - b), 0) / (n - 1);
                }
                return regression(v, other)[name === 'ts_beta' || name === 'ts_regression_slope' ? 'slope' : name === 'ts_regression_resi' ? 'resi' : 'rsquare'];
            });
        if (name === 'rank')
            return x.map(row => { const rank = ranks(row), count = rank.filter(Number.isFinite).length; return rank.map(v => v / count); });
        if (name === 'zscore')
            return x.map(row => { const good = row.filter(Number.isFinite), m = mean(good), s = std(good); return row.map(v => s > 0 ? finite((v - m) / s) : NaN); });
        if (name === 'scale')
            return x.map(row => { const total = row.filter(Number.isFinite).reduce((s, v) => s + Math.abs(v), 0); return row.map(v => total > 0 ? finite(v * (args[1] as number) / total) : NaN); });
        if (name === 'indneutralize')
            return x.map((row, i) => { const labels = (args[1] as GroupMatrix)[i], groups = new Map<string | number, {
                sum: number;
                count: number;
            }>(); row.forEach((v, j) => { const g = labels[j]; if (Number.isFinite(v) && ((typeof g === 'string' && g.length) || (typeof g === 'number' && Number.isFinite(g)))) {
                const old = groups.get(g!) || { sum: 0, count: 0 };
                old.sum += v;
                old.count++;
                groups.set(g!, old);
            } }); const centers = new Map([...groups].map(([g, v]) => [g, v.sum / v.count])); return row.map((v, j) => { const m = centers.get(labels[j]!); return m === undefined ? NaN : finite(v - m); }); });
        if (args.every(a => typeof a === 'number'))
            return element(name, ...args as [
                number,
                number?,
                number?
            ]);
        return map((i, j) => element(name, ...args.map(a => cell(a, i, j)) as [
            number,
            number?,
            number?
        ]));
    }
    parsed.ast.body.forEach((s: FactorAST['body'][number]) => env.set(s.target, execute(s.value)));
    return (env.get('factor') as Matrix).map(row => row.slice());
}
/** Manual numeric formulas cannot access market, windows, cross-sections, or arbitrary functions. */
export function evaluateScalar(expression: string, inputs: Record<string, number>): number {
    if (!inputs || Object.keys(inputs).length > 64)
        throw new Error('输入数量超限');
    const env = new Map<string, number>();
    for (const [key, value] of Object.entries(inputs)) {
        if (!safeName.test(key) || OPS.includes(key))
            throw new Error('非法输入名称');
        env.set(key, numeric(value));
    }
    function run(node: Expr): number { if (node.type === 'constant')
        return node.value; if (node.type === 'name') {
        if (!env.has(node.id))
            throw new Error(`缺少输入${node.id}`);
        return env.get(node.id)!;
    } if (node.type === 'unary') {
        const x = run(node.operand);
        return node.operator === '-' ? -x : x;
    } if (node.type === 'binary' || node.type === 'compare')
        return binary(node.operator, run(node.left), run(node.right)); if (node.type !== 'call' || ![...UNARY, ...BINARY, 'where', 'clip'].includes(node.function))
        throw new Error('手动计算仅支持基础数值白名单，不允许时序、截面或数据字段'); const n = UNARY.includes(node.function) ? 1 : ['where', 'clip'].includes(node.function) ? 3 : 2; if (node.args.length !== n)
        throw new Error('算子参数数量错误'); return finite(element(node.function, ...node.args.map(run) as [
        number,
        number?,
        number?
    ])); }
    return finite(run(parseExpression(expression)));
}
export function languageOperators(): Row[] {
    const descriptions: Record<string, string> = { delay: 'x[t-n]，禁止未来位移。', returns: 'x[t]/x[t-n]-1；零分母缺失。', delta: 'x[t]-x[t-n]。', ts_mean: '完整窗口均值。', ts_std: '完整窗口总体标准差ddof=0。', ts_sum: '完整窗口和。', ts_min: '完整窗口最小值。', ts_max: '完整窗口最大值。', ts_product: '完整窗口连乘；溢出缺失。', ts_rank: '当前值的1起始平均并列秩，不归一化。', ts_pct: 'x[t]/x[t-n]-1，当前相对n期前变化率；零分母缺失。', ts_argmax: '最早最大值位置：最旧日1，最新日n。', ts_argmin: '最早最小值位置：最旧日1，最新日n。', decay_linear: '最旧到最新权重1..n并归一化。', ts_ema: '有限n日窗EMA；alpha=2/(n+1)，最旧值初始化，非无限递推。', ts_slope: 'x对时间1..n含截距OLS斜率。', ts_resi: 'x对时间含截距OLS末日残差。', ts_rsquare: 'x对时间OLS的R²；常量响应缺失。', ts_corr: '完整配对窗口Pearson；常量序列缺失。', ts_cov: '完整窗口样本协方差ddof=1。', ts_beta: 'y对x含截距OLS斜率，参数顺序(y,x,n)。', ts_regression_slope: 'y对x含截距OLS斜率。', ts_regression_resi: 'y对x含截距OLS末日残差。', ts_regression_rsquare: 'y对x含截距OLS的R²，常量响应缺失。', rank: '截面平均并列秩/有效数量，范围(0,1]。', zscore: '截面总体标准化，常量截面缺失。', scale: '截面sum(abs(x))缩放为a（默认1）；全零缺失。', indneutralize: '按当日真实分类组内去均值，缺标签缺失，单成员组0。', signed_power: '按原论文x^a实现普通实数幂；不自行添加保留符号语义。', power: '普通实数幂；非实数结果/溢出缺失。', where: '非零条件为真，条件缺失传播。', clip: '常量上下界裁剪。', minimum: '逐元素最小，与ts_min不同。', maximum: '逐元素最大，与ts_max不同。', safe_div: 'a/b；零分母缺失，不隐加epsilon。', spread: '(a-b)/(abs(a)+abs(b))；双零缺失。', geom_mean: 'sqrt(a*b)，两数非负。', harm_mean: '2ab/(a+b)，两数为正。', abs: '绝对值。', log: '自然对数；非正值缺失。', sign: '数值符号。', logical_and: '两个非零条件皆真为1，缺失传播。', logical_or: '任一非零为1，缺失传播。', logical_not: '零为1，非零为0，缺失传播。' };
    return [...OPS.map(name => ({ name, category: windowed(name) ? '时间序列' : '截面与数值', signature: `${name}(${WINDOWS.includes(name) ? 'x, n' : PAIRS.includes(name) ? 'y, x, n' : name === 'indneutralize' ? 'x, group' : name === 'scale' ? 'x, a=1' : name === 'where' ? 'condition, a, b' : name === 'clip' ? 'x, lower, upper' : BINARY.includes(name) ? 'a, b' : 'x'})`, description: descriptions[name] })), { name: 'adv', category: '时间序列', signature: 'adv(n)', description: '原论文平均日成交额=ts_mean(amount,n)；不能用volume替代。' }, ...FIELDS.map(name => ({ name, category: '字段', signature: name, description: GROUP_FIELDS.includes(name) ? '真实历史时点分类标签；缺失不编造。' : name === 'vwap' ? '真实日成交量加权均价，不用典型价替代。' : name === 'cap' ? '真实总市值，区别于float_cap。' : name === 'amount' ? '真实成交额；当前公开样本缺失。' : name === 'volume' ? '成交股数，不是换手率或成交额。' : '按名称口径提供真实历史矩阵；缺失拒绝执行，不自动替代。' }))];
}
