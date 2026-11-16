import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Download, FileText, FlaskConical, GitBranch, Play, Plus, RefreshCw, Save, ShieldCheck, Square, Trash2 } from 'lucide-react';
import { api, errorMessage, exportRun, type Factor, go, type RecordData, type Run, useApi } from './api';
import { DataTable, Empty, ErrorBox, Field, JsonView, Loading, MetricGrid, PageHead, Panel, RunTable, SearchInput, Status, Tabs, Tag, TimeChart, dateTime } from './components';
import { EvidencePanels } from './FactorEvidence';
const defaults: RecordData = { start_date: '2024-01-01', end_date: '2024-12-31', horizon: 5, quantiles: 10, top_n: 20, rebalance_days: 5, initial_cash: 1000000, commission_bps: 3, slippage_bps: 5, stamp_tax_bps: 5, transfer_fee_bps: 0.1, min_commission: 5, max_weight: 0.1, max_participation: 0.01, min_ipo_days: 120, exclude_st: true, corporate_action_mode: 'adjusted_units' };
const numericFields = [['top_n', '目标持股数', '只'], ['rebalance_days', '调仓间隔', '交易日'], ['initial_cash', '初始资金', '元'], ['max_weight', '单只最大权重', '0–1'], ['max_participation', '最大成交参与率', '0–1'], ['min_ipo_days', '上市观察期', '天，按源字段'], ['commission_bps', '佣金', 'bps'], ['min_commission', '最低佣金', '元/笔'], ['slippage_bps', '滑点', 'bps'], ['stamp_tax_bps', '卖出印花税', 'bps'], ['transfer_fee_bps', '过户费', 'bps']];
export function ResearchForm({ kind, initialFactor, notify, publicMode = false }: {
    kind: 'factor' | 'strategy';
    initialFactor?: string;
    publicMode?: boolean;
    notify: (s: string) => void;
}) {
    const formDefaults = publicMode ? { ...defaults, top_n: 3, max_weight: 0.4, min_ipo_days: 0, exclude_st: false, corporate_action_mode: 'price_only' } : defaults;
    const factorQuery = useApi<Factor[]>('/factors'), strategiesQuery = useApi<RecordData[]>(kind === 'strategy' ? '/strategies' : null);
    const factors = (factorQuery.data || []).filter(f => !f.deleted && (f.source_kind === 'native_ast' || !publicMode && f.source_kind === 'legacy' && f.output_metadata?.exists && f.code_hash === f.original_code_hash));
    const dataQuery = useApi('/data');
    const [name, setName] = useState(''), [description, setDescription] = useState(''), [config, setConfig] = useState<RecordData>({ ...formDefaults, factor_id: initialFactor || '' }), [components, setComponents] = useState<{
        factor_id: string;
        weight: number;
    }[]>([]);
    const [selected, setSelected] = useState<RecordData | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [advanced, setAdvanced] = useState(false);
    useEffect(() => { if (factors.length && !config.factor_id)
        setConfig(c => ({ ...c, factor_id: initialFactor || factors[0].id })); if (kind === 'strategy' && factors.length && !components.length)
        setComponents([{ factor_id: initialFactor || factors[0].id, weight: 1 }]); }, [factorQuery.data]);
    const update = (key: string, value: any) => setConfig(c => ({ ...c, [key]: value }));
    function choose(strategy: RecordData | null) { setSelected(strategy); setName(strategy?.name || ''); setDescription(strategy?.description || ''); setConfig({ ...formDefaults, ...strategy?.config, factor_id: strategy?.config?.factor_id || factors[0]?.id || '' }); setComponents(strategy?.config?.factors?.length ? strategy.config.factors : [{ factor_id: strategy?.config?.factor_id || factors[0]?.id || '', weight: 1 }]); setError(''); }
    function requestConfig() { return { ...config, ...(factors.some(f => (kind === 'factor' ? f.id === config.factor_id : components.some(x => x.factor_id === f.id)) && f.source_kind === 'legacy') ? { work_replay: true } : {}), ...(kind === 'strategy' ? { factors: components, factor_id: components[0]?.factor_id } : {}), corporate_action_mode: config.corporate_action_mode || (publicMode ? 'price_only' : 'adjusted_units') }; }
    function validate() { if (!name.trim())
        return '请填写任务或策略名称。'; if (config.start_date > config.end_date)
        return '开始日期不能晚于结束日期。'; if (kind === 'factor' && !config.factor_id)
        return '请选择一个可运行因子。'; if (kind === 'strategy' && (!components.length || components.some(c => !c.factor_id)))
        return '请为组合选择因子。'; if (kind === 'strategy' && components.every(c => c.weight === 0))
        return '组合权重不能全部为 0。'; if (kind === 'strategy' && new Set(components.map(c => c.factor_id)).size !== components.length)
        return '同一个因子不能重复加入组合。'; return ''; }
    async function submit() { const invalid = validate(); if (invalid) {
        setError(invalid);
        return;
    } setBusy('run'); setError(''); try {
        const run = await api<Run>('/runs', 'POST', { name, kind, config: requestConfig() });
        notify('任务已提交，参数与因子版本已冻结。');
        go('/runs/' + run.id);
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy('');
    } }
    async function save() { const invalid = validate(); if (invalid) {
        setError(invalid);
        return;
    } setBusy('save'); setError(''); try {
        const strategy = await api(selected ? '/strategies/' + selected.id : '/strategies', selected ? 'PUT' : 'POST', { name, description, config: requestConfig(), base_version: selected?.version });
        setSelected(strategy);
        strategiesQuery.refresh();
        notify('策略配置已保存。');
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy('');
    } }
    const selectedFactor = factors.find(f => f.id === config.factor_id);
    return <><PageHead eyebrow={kind === 'strategy' ? 'STRATEGY LAB' : 'RESEARCH LAB'} title={kind === 'strategy' ? '多因子量化策略' : '新建因子评测'} description={kind === 'strategy' ? '组合因子、定义持仓与成交约束，用同一口径检验研究假设。' : '固定研究区间与参数，计算因子相关性和分组表现。'} actions={<button className="button" onClick={() => go('/runs')}>查看研究任务 <ArrowRight size={15}/></button>}/>
    {publicMode && <div className="notice amber"><ShieldCheck size={17}/><span>公开研究版 · 固定 12 股小样本 · 未复权价格收益研究，不代表全 A 股。ST、上市日期与完整公司行动数据未接入；配置和结果仅保存在本机浏览器。</span></div>}{(error || factorQuery.error) && <ErrorBox message={error || factorQuery.error} retry={factorQuery.error ? factorQuery.refresh : undefined}/>}
    {factorQuery.loading ? <Loading /> : !factors.length ? <Empty title="还没有可运行因子" description="先创建并校验一个原生因子，再开始研究。历史归档因子只读。" action={<button className="button primary" onClick={() => go('/factors/new')}>创建因子</button>}/> : <div className={'research-layout ' + (kind === 'strategy' ? 'with-list' : '')}>
      {kind === 'strategy' && <aside className="strategy-list"><div className="section-label">保存的策略 <button className="icon-button" aria-label="新建策略" onClick={() => choose(null)}><Plus size={15}/></button></div><button className={'strategy-item ' + (!selected ? 'active' : '')} onClick={() => choose(null)}><Plus size={17}/><div><strong>新建研究策略</strong><small>定义新的组合</small></div></button>{strategiesQuery.error && <ErrorBox message={strategiesQuery.error} retry={strategiesQuery.refresh}/>} {(strategiesQuery.data || []).map(strategy => <button key={strategy.id} className={'strategy-item ' + (selected?.id === strategy.id ? 'active' : '')} onClick={() => choose(strategy)}><GitBranch size={17}/><div><strong>{strategy.name}</strong><small>v{strategy.version} · {dateTime(strategy.updated_at || strategy.created_at)}</small></div></button>)}</aside>}
      <div className="form-column"><Panel title="01  研究定义" actions={<Tag tone="purple">{kind === 'factor' ? '单因子研究' : '多因子策略'}</Tag>}><div className="padded"><div className="form-grid"><Field label={kind === 'factor' ? '任务名称' : '策略 / 任务名称'}><input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'factor' ? '例如：短期反转 · 2024 年研究' : '例如：量价多因子 · 等权组合'}/></Field>{kind === 'factor' ? <Field label="研究因子"><select value={config.factor_id} onChange={e => update('factor_id', e.target.value)}>{factors.map(f => <option key={f.id} value={f.id}>{f.name} · v{f.version}</option>)}</select></Field> : <Field label="策略说明"><input value={description} onChange={e => setDescription(e.target.value)} placeholder="记录研究假设与适用条件"/></Field>}</div>
        {kind === 'factor' && selectedFactor && <div className="factor-summary"><span className="factor-glyph"><FlaskConical size={21}/></span><div><strong>{selectedFactor.name}</strong><p>{selectedFactor.description}</p><code>{selectedFactor.code}</code></div><Tag tone="green">AST</Tag></div>}
        {kind === 'strategy' && <><div className="weight-header"><span>因子组合</span><small>权重方向决定信号方向；最终合成口径以任务记录为准。</small></div>{components.map((item, i) => <div className="weight-row" key={i}><span className="step-index">{String(i + 1).padStart(2, '0')}</span><select aria-label={'第 ' + (i + 1) + ' 个因子'} value={item.factor_id} onChange={e => setComponents(items => items.map((v, j) => j === i ? { ...v, factor_id: e.target.value } : v))}>{factors.map(f => <option key={f.id} value={f.id}>{f.name} · v{f.version}</option>)}</select><label>权重 <input aria-label={'第 ' + (i + 1) + ' 个因子权重'} type="number" step="0.1" value={item.weight} onChange={e => setComponents(items => items.map((v, j) => j === i ? { ...v, weight: Number(e.target.value) } : v))}/></label><button className="icon-button" disabled={components.length <= 1} aria-label="移除此因子" onClick={() => setComponents(items => items.filter((_, j) => j !== i))}><Trash2 size={16}/></button></div>)}<button className="text-button add-factor" disabled={components.length >= Math.min(8, factors.length)} onClick={() => setComponents(items => [...items, { factor_id: factors.find(f => !items.some(item => item.factor_id === f.id))?.id || '', weight: 1 }])}><Plus size={15}/> 添加因子</button></>}
      </div></Panel>
      <Panel title="02  样本与评测参数"><div className="padded"><div className="notice purple compact"><span>{publicMode ? "当前数据：公开固定股票样本" : "当前数据：本地 data 全市场日线"} · {dataQuery.data?.start_date} — {dataQuery.data?.end_date}{!publicMode && "；单次任务最多三年，可按区间分别研究。"} <button className="text-button" onClick={() => go("/data")}>查看目录与字段</button></span></div>{selectedFactor?.source_kind === "legacy" && <div className="notice amber compact"><span>本次使用既有因子值快照回放，读取原 Parquet 并按历史交易资格过滤；不会执行当前 Python 源码。原值生成的时点正确性尚待完整核验，修改代码不会自动改变原值。</span></div>}<div className="form-grid"><Field label="开始日期"><input type="date" value={config.start_date} onChange={e => update('start_date', e.target.value)}/></Field><Field label="结束日期"><input type="date" value={config.end_date} onChange={e => update('end_date', e.target.value)}/></Field><Field label="预测持有期" hint="交易日；信号与未来收益的时序由引擎固定。"><input type="number" min="1" max="60" value={config.horizon} onChange={e => update('horizon', Number(e.target.value))}/></Field><Field label="分组数量"><select value={config.quantiles} onChange={e => update('quantiles', Number(e.target.value))}><option value="5">5 组</option><option value="10">10 组</option></select></Field></div>{!publicMode && <label className="checkbox-field"><input type="checkbox" checked={config.exclude_st} onChange={e => update('exclude_st', e.target.checked)}/><span>排除 ST 股票</span></label>}</div></Panel>
      <Panel title="03  成交与成本假设" actions={<button className="text-button" onClick={() => setAdvanced(!advanced)}>{advanced ? '收起参数' : '展开参数'} <ChevronDown size={15} className={advanced ? 'rotated' : ''}/></button>}><div className="padded"><div className="assumption-strip"><span>次日开盘执行</span><span>A 股 T+1</span>{publicMode ? <span>原始价格 · 不模拟停牌和涨跌停</span> : <span>停牌 / 涨跌停约束</span>}<span>显式交易成本</span></div>{advanced && <div className="form-grid three">{numericFields.filter(([key]) => !publicMode || key !== 'min_ipo_days').map(([key, label, unit]) => <Field key={key} label={label + '（' + unit + '）'}><input type="number" min={['top_n', 'rebalance_days', 'initial_cash'].includes(key) ? 1 : 0} step={['max_weight', 'max_participation'].includes(key) ? 0.01 : key.endsWith('bps') ? 0.1 : 1} max={['max_weight', 'max_participation'].includes(key) ? 1 : undefined} value={config[key]} onChange={e => update(key, Number(e.target.value))}/></Field>)}</div>}{!publicMode && <><Field label="公司行动处理"><select value={config.corporate_action_mode} onChange={e => update('corporate_action_mode', e.target.value)}><option value="adjusted_units">复权等价份额 · 研究回测</option><option value="strict">严格模式 · 缺少公司行动明细则失败</option></select></Field><div className="notice amber compact"><ShieldCheck size={17}/><span>复权等价份额用于研究收益，不代表真实股数交割。分红、送转实施明细不完整时，严格模式会拒绝继续计算。</span></div></>}<p className="form-footnote">成本为本次研究的可配置假设；1 bps = 0.01%。所有参数与数据来源会写入任务记录。</p></div></Panel>
      <div className="submit-bar"><div><ShieldCheck size={18}/><span>提交后冻结参数与因子版本，保留每次研究结果。</span></div><div className="actions">{kind === 'strategy' && <button className="button" disabled={!!busy} onClick={save}><Save size={16}/>{busy === 'save' ? '保存中…' : '保存策略'}</button>}<button className="button primary" disabled={!!busy} onClick={submit}><Play size={16}/>{busy === 'run' ? '正在提交…' : kind === 'factor' ? '提交因子评测' : '启动策略回测'}</button></div></div></div>
    </div>}
  </>;
}
export function Runs() { const query = useApi<Run[]>('/runs', 5000); const [status, setStatus] = useState('all'), [search, setSearch] = useState(''); const runs = (query.data || []).filter(run => (status === 'all' || run.status === status) && `${run.name} ${run.id}`.toLowerCase().includes(search.toLowerCase())); return <><PageHead eyebrow="EXPERIMENTS" title="研究任务" description="每一次计算都有独立记录。查看进度、结果与冻结的实验参数。" actions={<><button className="button" onClick={query.refresh}><RefreshCw size={15}/> 刷新</button><button className="button primary" onClick={() => go('/research')}><Plus size={17}/> 新建评测</button></>}/>{query.error && <ErrorBox message={query.error} retry={query.refresh}/>}<Panel><div className="filter-bar"><SearchInput value={search} onChange={setSearch} placeholder="搜索研究任务"/><select aria-label="任务状态" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option><option value="queued">排队中</option><option value="running">运行中</option><option value="completed">已完成</option><option value="failed">失败</option><option value="cancelled">已取消</option><option value="interrupted">已中断</option></select><Tag>每 5 秒更新</Tag></div>{query.loading ? <Loading /> : <RunTable runs={runs}/>}</Panel></>; }
export function RunDetail({ id, notify, publicMode = false }: {
    id: string;
    publicMode?: boolean;
    notify: (s: string) => void;
}) {
    const [poll, setPoll] = useState(4000);
    const query = useApi<Run>('/runs/' + id, poll);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState('performance');
    const run = query.data;
    useEffect(() => { if (run && ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status))
        setPoll(0); }, [run?.status]);
    async function cancel() { setBusy(true); try {
        await api('/runs/' + id + '/cancel', 'POST');
        notify('取消请求已提交。');
        query.refresh();
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy(false);
    } }
    if (query.loading)
        return <Loading />;
    if (query.error && !run)
        return <ErrorBox message={query.error} retry={query.refresh}/>;
    if (!run)
        return <Empty />;
    const result = run.result;
    const tabs = [{ id: 'performance', label: '收益与回撤' }, { id: 'factor', label: '因子详情与十分组' }, { id: 'periods', label: '分期表现' }, { id: 'positions', label: '成交与持仓' }, { id: 'protocol', label: '参数与数据来源' }];
    return <><button className="back-link" onClick={() => go('/runs')}><ArrowLeft size={15}/> 研究任务</button><PageHead eyebrow={run.kind === 'factor' ? 'FACTOR EVALUATION' : 'STRATEGY BACKTEST'} title={run.name} description={`${run.config?.start_date} — ${run.config?.end_date} · ${run.kind === 'factor' ? '因子评测' : '策略研究回测'}`} actions={<>{['queued', 'running', 'pending'].includes(run.status) && <button className="button" disabled={busy} onClick={cancel}><Square size={14}/> 取消任务</button>}{result && <><button className="button" onClick={async () => { try { await exportRun(id); } catch (e) { setError(errorMessage(e)); } }}><Download size={15}/> 导出结果</button><button className="button primary" onClick={() => go('/reports?run=' + id)}><FileText size={15}/> 撰写研究报告</button></>}</>}/>
    {(error || query.error) && <ErrorBox message={error || query.error}/>}<div className="run-status"><Status status={run.status}/><span>{run.message}</span><span className="mono">{id}</span><small>{dateTime(run.created_at)}</small></div>
    {!result && <Panel>{['failed', 'cancelled', 'interrupted'].includes(run.status) ? <div className="padded"><ErrorBox message={run.error || run.message || '任务已结束，未生成研究结果。'}/><details className="raw-detail" open><summary>冻结的参数</summary><JsonView value={run.config}/></details></div> : <div className="run-pending"><span className="large-factor-icon"><FlaskConical size={34}/></span><h2>{run.status === 'queued' ? '任务正在排队' : '正在计算真实研究结果'}</h2><p>{run.message || (publicMode ? '正在当前浏览器中计算，完成前请保持此页面打开。' : '后台正在读取数据并计算。你可以离开本页，任务会继续运行。')}</p><div className="progress"><i style={{ width: Math.min(100, Math.max(0, run.progress || 0)) + '%' }}/></div><small>{Math.round(run.progress || 0)}%</small></div>}</Panel>}
    {result && <><ResearchWarnings warnings={result.warnings || []}/><Panel className="result-metrics"><MetricGrid metrics={result.metrics || run.metrics || {}}/></Panel><Panel><Tabs items={tabs} value={tab} onChange={setTab}/><div className="padded result-panels">{tab === 'performance' && <><ChartSection title="净值表现" description={result.diagnostics?.gross_nav_definition || "研究回测 · 费后策略净值与基准；口径详见参数与数据来源。"} data={result.curves} keys={['nav', 'benchmark', 'gross_nav']}/><ChartSection title="策略回撤" data={result.curves} keys={['drawdown']} percent/><ChartSection title="换手与仓位" data={result.curves} keys={['turnover', 'exposure']} percent/></>}{tab === 'factor' && <EvidencePanels result={result} config={run.config}/>}{tab === 'periods' && <><h3>年度表现</h3><DataTable rows={arrayRows(result.yearly)} empty="本任务没有年度统计"/><h3>月度表现</h3><DataTable rows={arrayRows(result.monthly)} empty="本任务没有月度统计"/></>}{tab === 'positions' && <><h3>成交记录</h3><p className="muted">{run.config?.corporate_action_mode === 'price_only' ? '公开样本原始价格研究，未计入分红送转等公司行动；不代表实际账户交割。' : '复权等价份额模式下，数量为研究模型份额，不代表实际交割股数。'}</p><DataTable rows={arrayRows(result.trades)} empty="本任务没有成交记录"/><h3>持仓记录</h3><DataTable rows={arrayRows(result.holdings)} empty="本任务没有持仓记录"/></>}{tab === 'protocol' && <><h3>冻结的实验参数</h3><JsonView value={run.config}/><h3>数据与代码来源</h3><JsonView value={result.provenance}/><h3>研究诊断与可用性限制</h3><JsonView value={result.diagnostics}/></>}</div></Panel></>}
  </>;
}
function arrayRows(value: any): RecordData[] { if (Array.isArray(value))
    return value; return value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => typeof item === 'object' && item ? { period: key, ...item } : { period: key, value: item }) : []; }
function ChartSection({ title, description, data, keys, percent = false }: {
    title: string;
    description?: string;
    data?: RecordData[];
    keys: string[];
    percent?: boolean;
}) { const rows = Array.isArray(data) ? data : []; const actual = keys.filter(key => rows.some(row => typeof row[key] === 'number')); return <div className="chart-section"><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{actual.length ? <TimeChart data={rows} keys={actual} percent={percent}/> : <Empty title="本任务未计算此项" description="仅展示任务实际产生的序列。"/>}</div>; }

function ResearchWarnings({ warnings }: { warnings: unknown[] }) {
    const entries = warnings.map((value, index) => ({ index, text: typeof value === 'string' ? value : JSON.stringify(value) }));
    const primary = entries.find(item => item.text.includes('本结果为复权等价份额')) ?? entries.find(item => item.text.includes('复权等价份额')) ?? entries.find(item => /未复权|原始价格|固定.*小样本/.test(item.text));
    const valuation = entries.filter(item => item.index !== primary?.index && /期末.*缺.*报价|期末.*缺价|最终净值.*临时估值/.test(item.text));
    const visible = new Set([primary?.index, ...valuation.map(item => item.index)]);
    const remaining = entries.filter(item => !visible.has(item.index));
    if (!entries.length) return null;
    return <div className="research-warnings">
        {primary && <div className="notice amber"><ShieldCheck size={19}/><p>{primary.text}</p></div>}
        {valuation.map(item => <div className="notice valuation-warning" key={item.index}><ShieldCheck size={19}/><p>{item.text}</p></div>)}
        {remaining.length > 0 && <details className="warning-details"><summary>数据与成交假设（{remaining.length} 项）</summary><div>{remaining.map(item => <p key={item.index}>{item.text}</p>)}</div></details>}
    </div>;
}
