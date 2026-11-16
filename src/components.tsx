import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight, Database, LoaderCircle, Search } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Brush, ReferenceLine } from 'recharts';
import { type RecordData, type Run, go } from './api';
export const metricNames: Record<string, string> = { annual_return: '年化收益', annualized_return: '年化收益', cagr: '年化收益', total_return: '累计收益', sharpe: 'Sharpe', max_drawdown: '最大回撤', annual_volatility: '年化波动', annualized_volatility: '年化波动', volatility: '波动率', ic_mean: 'IC 均值', rank_ic_mean: 'RankIC 均值', mean_ic: 'IC 均值', mean_rank_ic: 'RankIC 均值', ic_ir: 'ICIR', icir: 'ICIR', rank_icir: 'RankICIR', rank_ic_ir: 'RankICIR', trade_count: '成交笔数', turnover: '换手率', mean_turnover: '平均换手率', win_rate: '胜率', n_days: '交易日', n_stocks: '股票数', coverage: '覆盖率', final_nav: '期末净值', benchmark_return: '基准收益', excess_return: '超额收益', total_cost: '交易成本', period: '时期', date: '日期', year: '年份', month: '月份', return: '收益率', strategy_return: '策略收益', benchmark: '基准净值', drawdown: '回撤', nav: '策略净值', gross_nav: '费前净值', symbol: '证券代码', code: '代码', side: '方向', quantity: '数量', price: '价格', cost: '成本', amount: '金额', weight: '权重', market_value: '市值', cash: '现金', exposure: '仓位', ic: 'IC', rank_ic: 'RankIC', status: '状态', signal_date: '信号日', execution_date: '成交日', reason: '原因' };
Object.assign(metricNames, { information_ratio:'信息比率 IR', tracking_error:'跟踪误差', alpha_annual:'年化 Alpha', beta:'Beta', ic_rolling_20:'20日滚动 IC', ic_rolling_60:'60日滚动 IC', rank_ic_rolling_20:'20日滚动 RankIC', rank_ic_rolling_60:'60日滚动 RankIC', cumulative_ic:'累计 IC', cumulative_rank_ic:'累计 RankIC', LongShort:'最高组 − 最低组', sortino: 'Sortino', calmar: 'Calmar', daily_win_rate: '日收益胜率', trading_days: '交易日数', start_date: '开始日期', end_date: '结束日期', risk_free_rate: '无风险利率', buy_count: '买入笔数', sell_count: '卖出笔数', transaction_costs: '累计费税', slippage_costs: '累计滑点成本', turnover_total: '累计换手率', average_exposure: '平均仓位', final_cash: '期末现金', final_positions: '期末持股数', rejected_orders: '未成交委托', gross_total_return: '费前对照收益', stale_valuation_days: '缺报价估值天数', ic_positive_ratio: 'IC 正值比例', ic_observations: 'IC 观测数', ts_code: '代码', quantity_unit: '数量单位', notional: '成交额', fees: '费税', commission: '佣金', stamp_tax: '印花税', transfer_fee: '过户费', slippage_cost: '滑点成本', cash_after: '成交后现金', last_quote_date: '最新报价日', stale: '缺失最新报价', days: '交易日', positions: '持股数', observations: '观测数', group: '分组', mean_return: '平均远期收益', rolling_ic_20: '20 日滚动 IC', version: '版本', updated_at: '更新时间', name: '名称', description: '说明', code_hash: '代码指纹' });
const percentages = new Set(['percent','annual_return', 'annualized_return', 'cagr', 'total_return', 'max_drawdown', 'annual_volatility', 'annualized_volatility', 'volatility', 'ic_mean', 'rank_ic_mean', 'mean_ic', 'mean_rank_ic', 'turnover', 'mean_turnover', 'win_rate', 'coverage', 'benchmark_return', 'excess_return', 'return', 'strategy_return', 'drawdown', 'weight', 'exposure', 'ic', 'rank_ic']);
['daily_win_rate', 'risk_free_rate', 'turnover_total', 'average_exposure', 'gross_total_return', 'ic_positive_ratio', 'mean_return', 'rolling_ic_20'].forEach(key => percentages.add(key));
export function fmt(value: any, key = '') { if (value === null || value === undefined || value === '')
    return '—'; if (typeof value === 'boolean')
    return value ? '是' : '否'; if (typeof value === 'number') {
    if (!Number.isFinite(value))
        return '—';
    if (percentages.has(key))
        return (value * 100).toFixed(2) + '%';
    return value.toLocaleString('zh-CN', { maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 4 });
} if (typeof value === 'object')
    return JSON.stringify(value); return String(value); }
export function dateTime(value?: string) { if (!value)
    return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
export function Tag({ children, tone = 'neutral' }: {
    children: ReactNode;
    tone?: string;
}) { return <span className={'tag ' + tone}>{children}</span>; }
export function Status({ status }: {
    status: string;
}) { const labels: Record<string, string> = { queued: '排队中', pending: '等待中', running: '运行中', completed: '已完成', success: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断', cancelling: '取消中', ready: '可运行', available: '可用', legacy: '历史归档' }; const tone = ['completed', 'success', 'ready', 'available'].includes(status) ? 'green' : ['running'].includes(status) ? 'purple' : ['failed', 'interrupted'].includes(status) ? 'red' : 'neutral'; return <Tag tone={tone}>{status === 'running' && <LoaderCircle size={12} className="spin"/>}{labels[status] || status}</Tag>; }
export function ErrorBox({ message, retry }: {
    message: string;
    retry?: () => void;
}) { return <div role="alert" className="error-box"><AlertCircle size={17}/><span>{message}</span>{retry && <button className="text-button" onClick={retry}>重试</button>}</div>; }
export function Loading() { return <div className="loading"><LoaderCircle size={23} className="spin"/><span>读取研究数据…</span></div>; }
export function Empty({ title = '暂无数据', description = '完成研究任务后，真实计算结果将在这里显示。', action }: {
    title?: string;
    description?: string;
    action?: ReactNode;
}) { return <div className="empty"><span className="empty-icon"><Database size={27}/></span><h3>{title}</h3><p>{description}</p>{action}</div>; }
export function PageHead({ eyebrow, title, description, actions }: {
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: ReactNode;
}) { return <div className="page-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div><div className="actions">{actions}</div></div>; }
export function Panel({ title, description, actions, children, className = '' }: {
    title?: string;
    description?: string;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
}) { return <section className={'panel ' + className}>{(title || actions) && <div className="panel-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions}</div>}{children}</section>; }
export function Tabs({ items, value, onChange }: {
    items: {
        id: string;
        label: string;
    }[];
    value: string;
    onChange: (value: string) => void;
}) { return <div className="tabs" role="tablist">{items.map(item => <button type="button" role="tab" aria-selected={value === item.id} className={value === item.id ? 'active' : ''} key={item.id} onClick={() => onChange(item.id)}>{item.label}</button>)}</div>; }
export function Field({ label, hint, children }: {
    label: string;
    hint?: string;
    children: ReactNode;
}) {
    const control = isValidElement(children) && typeof children.type === 'string' && ['input', 'textarea', 'select'].includes(children.type)
        ? cloneElement(children as ReactElement<{ 'aria-label'?: string }>, { 'aria-label': label })
        : children;
    return <label className="field"><span>{label}</span>{control}{hint && <small>{hint}</small>}</label>;
}
export function SearchInput({ value, onChange, placeholder = '搜索名称、代码或描述' }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) { return <div className="search-input"><Search size={17}/><input aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/></div>; }
export function Pagination({ total, page, onChange, size = 10 }: {
    total: number;
    page: number;
    onChange: (n: number) => void;
    size?: number;
}) { const pages = Math.max(1, Math.ceil(total / size)); const visible = Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - page) <= 1); return <div className="pagination"><span>共 {total} 条记录 · 每页 {size} 条</span><div><button aria-label="上一页" className="icon-button" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16}/></button>{visible.map((n, i) => <span className="page-number-wrap" key={n}>{i > 0 && n - visible[i - 1] > 1 && <span className="page-ellipsis">…</span>}<button aria-label={'第 ' + n + ' 页'} aria-current={page === n ? 'page' : undefined} className={'page-number ' + (page === n ? 'active' : '')} onClick={() => onChange(n)}>{n}</button></span>)}<button aria-label="下一页" className="icon-button" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={16}/></button></div></div>; }
export function MetricGrid({ metrics, result = {} }: {
    metrics: RecordData;
    result?: RecordData;
}) {
    const label = (key: string) => {
        if (!/^(?:rank_)?ic_?ir(?:_daily|_annualized)?$/.test(key)) return metricNames[key] || key;
        const definition = String(result.diagnostics?.metric_definitions?.[key] || (key === 'ic_ir' ? result.diagnostics?.ic_ir_definition : '') || result.provenance?.[key] || (key === 'ic_ir' && String(result.provenance?.engine || '').startsWith('public-price-') ? result.provenance?.icir : '') || '');
        const basis = result.legacy ? '原口径' : key.endsWith('_daily') || /未年化|非年化/.test(definition) ? '非年化' : key.endsWith('_annualized') || /年化|sqrt\(252\)|√252/.test(definition) ? '年化' : '原口径';
        return (key.startsWith('rank_') ? 'RankICIR' : 'ICIR') + ' · ' + basis;
    };
    const entries = Object.entries(metrics || {}).filter(([, v]) => typeof v !== 'object' || v === null);
    const priority = ['annualized_return', 'annual_return', 'total_return', 'sharpe', 'max_drawdown', 'rank_ic_mean', 'ic_mean', 'ic_ir', 'trade_count'];
    const ordered = [...priority.filter(key => entries.some(([k]) => key === k)).map(key => [key, metrics[key]] as [
            string,
            any
        ]), ...entries.filter(([key]) => !priority.includes(key))];
    const grid = (items: [
        string,
        any
    ][]) => <div className="metric-grid">{items.map(([key, value]) => <div className="metric" key={key}><span title={key}>{label(key)}</span><strong className={typeof value === 'number' && value < 0 ? 'negative' : ''}>{fmt(value, key)}</strong></div>)}</div>;
    return <>{grid(ordered.slice(0, 8))}{ordered.length > 8 && <details className="more-metrics"><summary>更多研究指标 · {ordered.length - 8} 项</summary>{grid(ordered.slice(8))}</details>}</>;
}
export function JsonView({ value }: {
    value: unknown;
}) { return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>; }
export function DataTable({ rows, empty = '暂无记录' }: {
    rows: RecordData[];
    empty?: string;
}) { const [page, setPage] = useState(1); if (!rows?.length)
    return <Empty title={empty}/>; const keys = Array.from(new Set(rows.slice(0, 20).flatMap(Object.keys))); const safePage = Math.min(page, Math.ceil(rows.length / 15)); return <><div className="table-scroll"><table><thead><tr>{keys.map(key => <th key={key} title={key}>{metricNames[key] || key}</th>)}</tr></thead><tbody>{rows.slice((safePage - 1) * 15, safePage * 15).map((row, i) => <tr key={i}>{keys.map(key => <td key={key} title={fmt(row[key], key)}>{fmt(row[key], key)}</td>)}</tr>)}</tbody></table></div><Pagination page={safePage} total={rows.length} onChange={setPage} size={15}/></>; }
const colors = ['#7364d9', '#3da19b', '#e4b960', '#dd7f91', '#6098d5', '#a2b575', '#be8bd7', '#f2a579', '#76948a', '#8c8cdb'];
/** Read only the result's recorded benchmark metadata; never infer one from the current environment. */
export function benchmarkDescriptor(result: RecordData, config: RecordData = {}) {
    const candidate = result.benchmark || result.provenance?.benchmark || result.benchmark_source;
    const metadata = candidate && typeof candidate === 'object' ? candidate : {};
    const recordedName = typeof candidate === 'string' ? candidate : metadata.name || result.provenance?.source?.benchmark;
    const id = metadata.id || config.benchmark_id || (metadata.code ? 'index:' + metadata.code : '');
    const name = typeof recordedName === 'string' && recordedName ? recordedName : id ? '基准 ' + id : '历史任务未记录基准名称';
    const basis = metadata.basis || metadata.provenance?.basis || metadata.return_basis || metadata.return_definition || result.provenance?.benchmark_alignment || (typeof recordedName === 'string' && recordedName.includes('价格指数') ? '价格指数收盘收益，不含分红；首个研究日收盘归一为 1。' : '此历史任务未冻结完整基准口径，请查看数据来源或独立计算对比基准。');
    return { id, name, basis: String(basis), provenance: metadata.provenance || metadata };
}
export function TimeChart({ data, keys, labels = {}, percent = false, height = 310 }: {
    data: RecordData[];
    keys: string[];
    labels?: Record<string, string>;
    percent?: boolean;
    height?: number;
}) { if (!data?.length)
    return <Empty title="尚无可绘制的序列"/>; return <div className="time-chart" style={{ height }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 4 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e9edf4"/><XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8892a3' }} tickLine={false} axisLine={false} minTickGap={65} tickFormatter={value => String(value).slice(0, 10)}/><YAxis tick={{ fontSize: 11, fill: '#8892a3' }} tickLine={false} axisLine={false} width={58} tickFormatter={value => percent ? (value * 100).toFixed(0) + '%' : Number(value).toFixed(2)} domain={['auto', 'auto']}/><Tooltip contentStyle={{ border: '1px solid #eceaf6', borderRadius: 10, fontSize: 12, boxShadow: '0 8px 30px #18213a10' }} formatter={(value: any, name: any) => [typeof value === 'number' ? (percent ? (value * 100).toFixed(3) + '%' : value.toFixed(4)) : value, name]}/><Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="circle" iconSize={7}/><ReferenceLine y={0} stroke="#e4e7ee"/>{keys.map((key, i) => <Line key={key} dataKey={key} name={labels[key] || metricNames[key] || key} stroke={colors[i % colors.length]} strokeWidth={1.8} dot={false} connectNulls={false} isAnimationActive={false}/>)}{data.length > 40 && <Brush dataKey="date" height={20} stroke="#d9d4ee" fill="#faf9ff" travellerWidth={5} tickFormatter={value => String(value).slice(0, 10)}/>}</LineChart></ResponsiveContainer></div>; }
export function RunTable({ runs }: {
    runs: Run[];
}) { return !runs.length ? <Empty title="从第一个研究任务开始" description="选择因子、设置样本区间并提交评测。指标和图表将由后台真实计算。" action={<button className="button primary" onClick={() => go('/research')}>新建评测 <ArrowRight size={15}/></button>}/> : <div className="table-scroll"><table><thead><tr><th>任务 / 研究区间</th><th>类型</th><th>状态</th><th>进度</th><th>提交时间</th><th></th></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td><button className="name-link" onClick={() => go('/runs/' + run.id)}>{run.name}</button><small className="cell-sub">{run.config?.start_date} — {run.config?.end_date}</small></td><td><Tag>{run.kind === 'factor' ? '因子评测' : '策略回测'}</Tag></td><td><Status status={run.status}/></td><td><div className="progress"><i style={{ width: Math.min(100, Math.max(0, run.progress || 0)) + '%' }}/></div><small className="cell-sub">{run.message || '—'}</small></td><td className="muted">{dateTime(run.created_at)}</td><td><button className="icon-button" aria-label={'查看 ' + run.name} onClick={() => go('/runs/' + run.id)}><ArrowRight size={17}/></button></td></tr>)}</tbody></table></div>; }
