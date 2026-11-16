import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Download, FileText, FlaskConical, GitBranch, Play, Plus, RefreshCw, Save, ShieldCheck, Square, Trash2 } from 'lucide-react';
import { api, errorMessage, exportRun, type Factor, go, type RecordData, type Run, useApi } from './api';
import { DataTable, Empty, ErrorBox, Field, JsonView, Loading, MetricGrid, PageHead, Panel, RunTable, SearchInput, Status, Tabs, Tag, TimeChart, benchmarkDescriptor, dateTime, fmt } from './components';
const EvidencePanels = lazy(() => import('./FactorEvidence').then(m => ({ default: m.EvidencePanels }))); 
const defaults: RecordData = { start_date: '2024-01-01', end_date: '2024-12-31', horizon: 5, quantiles: 10, top_n: 20, rebalance_days: 5, initial_cash: 1000000, commission_bps: 3, slippage_bps: 5, stamp_tax_bps: 5, transfer_fee_bps: 0.1, min_commission: 5, max_weight: 0.1, max_participation: 0.01, min_ipo_days: 120, exclude_st: true, corporate_action_mode: 'adjusted_units' };
const numericFields = [['top_n', '目标持股数', '只'], ['rebalance_days', '调仓间隔', '交易日'], ['initial_cash', '初始资金', '元'], ['max_weight', '单只股票最大仓位', '0–1，资金比例'], ['max_participation', '最大成交参与率', '0–1'], ['min_ipo_days', '上市观察期', '天，按源字段'], ['commission_bps', '佣金', 'bps'], ['min_commission', '最低佣金', '元/笔'], ['slippage_bps', '滑点', 'bps'], ['stamp_tax_bps', '卖出印花税', 'bps'], ['transfer_fee_bps', '过户费', 'bps']];
type FactorReadiness = { available: boolean; label: string; reason: string };
function factorReadiness(factor: Factor | undefined, publicMode: boolean, availableFields?: string[]): FactorReadiness {
    if (!factor) return { available: false, label: '定义不可用', reason: '该因子不存在或已删除，请重新选择。' };
    if (factor.source_kind === 'legacy') {
        if (publicMode) return { available: false, label: '需连接本地引擎', reason: '公开版只有原始研究汇总，没有股票级 work 因子值，不能从历史净值拼接策略。连接有原 Parquet 的本地引擎后可组合回放。' };
        if (!factor.output_metadata?.exists) return { available: false, label: '缺少原因子值', reason: '本地未找到可回放的原始因子值快照。' };
        if (!factor.original_code_hash || factor.code_hash !== factor.original_code_hash) return { available: false, label: '定义与原值不一致', reason: '源码已修改，旧因子值不能作为新版信号；需要重算原值或恢复原始定义。' };
        return { available: true, label: '本地原值回放', reason: '使用本地股票级 Parquet 快照，不执行原 Python 源码；任务冻结各因子的原值来源。' };
    }
    if (!availableFields) return { available: false, label: '读取环境能力中', reason: '等待当前引擎返回已验证的数据字段。' };
    const required = Array.from(new Set([...(factor.dependencies || []), ...(factor.required_fields || []), ...(factor.industry_levels || [])]));
    const missing = required.filter(field => !availableFields.includes(field));
    if (missing.length) return { available: false, label: '缺少 ' + missing.join(' / '), reason: '当前引擎未接入已验证字段：' + missing.join('、') + '。请更换因子或连接具备这些字段的本地引擎；缺失数据不会补造。' };
    if (factor.status === 'invalid' || factor.validation?.valid === false) return { available: false, label: '定义校验未通过', reason: '请先在因子编辑器修复并校验当前定义。' };
    return { available: true, label: '当前引擎可运行', reason: '依赖字段已接入；研究区间的真实数据覆盖仍由任务校验。' };
}
function FactorOptions({ factors, value, search, publicMode, availableFields }: { factors: Factor[]; value: string; search: string; publicMode: boolean; availableFields?: string[] }) {
    const groups = [['native', '原生与自定义因子'], ['alpha101', 'Alpha101 · 公开公式'], ['work', 'work · 原始因子值']] as const;
    const category = (factor: Factor) => factor.source_kind === 'legacy' ? 'work' : factor.category === 'Alpha101' || factor.id.startsWith('alpha101_') ? 'alpha101' : 'native';
    const shown = factors.filter(factor => factor.id === value || `${factor.name} ${factor.id} ${factor.category}`.toLowerCase().includes(search.toLowerCase()));
    return <>{!value && <option value="">请选择因子</option>}{value && !factors.some(factor => factor.id === value) && <option value={value}>定义已删除或不可用 · {value}</option>}{groups.map(([id, label]) => { const entries = shown.filter(factor => category(factor) === id); return entries.length ? <optgroup key={id} label={`${label}（${entries.length}）`}>{entries.map(factor => <option key={factor.id} value={factor.id}>{factor.name} · v{factor.version} · {factorReadiness(factor, publicMode, availableFields).label}</option>)}</optgroup> : null; })}</>;
}
export function ResearchForm({ kind, initialFactor, notify, publicMode = false }: {
    kind: 'factor' | 'strategy';
    initialFactor?: string;
    publicMode?: boolean;
    notify: (s: string) => void;
}) {
    const formDefaults = publicMode ? { ...defaults, top_n: 3, max_weight: 0.4, min_ipo_days: 0, exclude_st: false, corporate_action_mode: 'price_only' } : defaults;
    const factorQuery = useApi<Factor[]>('/factors'), strategiesQuery = useApi<RecordData[]>(kind === 'strategy' ? '/strategies' : null);
    const factors = (factorQuery.data || []).filter(f => !f.deleted);
    const dataQuery = useApi('/data'), optionsQuery = useApi<RecordData>('/research/options');
    const options = optionsQuery.data, availableFields = options?.available_fields as string[] | undefined;
    const universes = (options?.universes || []) as RecordData[], benchmarks = (options?.benchmarks || []) as RecordData[];
    const defaultUniverse = options?.default_universe_id || universes.find(item => item.available !== false)?.id || '';
    const defaultBenchmark = options?.default_benchmark_id || benchmarks.find(item => item.available !== false)?.id || '';
    const [name, setName] = useState(''), [description, setDescription] = useState(''), [config, setConfig] = useState<RecordData>({ ...formDefaults, factor_id: initialFactor || '' }), [components, setComponents] = useState<{
        factor_id: string;
        weight: number;
    }[]>([]);
    const [selected, setSelected] = useState<RecordData | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [advanced, setAdvanced] = useState(false), [factorSearch, setFactorSearch] = useState('');
    useEffect(() => { if (factors.length && !config.factor_id)
        setConfig(c => ({ ...c, factor_id: initialFactor || factors[0].id })); if (kind === 'strategy' && factors.length && !components.length)
        setComponents([{ factor_id: initialFactor || factors[0].id, weight: 1 }]); }, [factorQuery.data]);
    useEffect(() => { if (options) setConfig(current => ({ ...current, universe_id: current.universe_id || defaultUniverse, benchmark_id: current.benchmark_id || defaultBenchmark })); }, [options]);
    const chosenFactors = (kind === 'factor' ? [{ factor_id: config.factor_id, weight: 1 }] : components).map(item => ({ ...item, factor: factors.find(factor => factor.id === item.factor_id), readiness: factorReadiness(factors.find(factor => factor.id === item.factor_id), publicMode, availableFields) }));
    const unavailable = chosenFactors.filter(item => item.weight !== 0 && !item.readiness.available);
    const hasWork = chosenFactors.some(item => item.weight !== 0 && item.factor?.source_kind === 'legacy');
    const weightSum = components.reduce((sum, item) => sum + (Number.isFinite(item.weight) ? Math.abs(item.weight) : 0), 0);
    const activeCount = components.filter(item => Number.isFinite(item.weight) && item.weight !== 0).length;
    const selectedUniverse = universes.find(item => item.id === config.universe_id), selectedBenchmark = benchmarks.find(item => item.id === config.benchmark_id);
    const runBlocked = !options || unavailable.length > 0 || !selectedUniverse || selectedUniverse.available === false || !selectedBenchmark || selectedBenchmark.available === false;
    const update = (key: string, value: any) => setConfig(c => ({ ...c, [key]: value }));
    function choose(strategy: RecordData | null) { setSelected(strategy); setFactorSearch(''); setName(strategy?.name || ''); setDescription(strategy?.description || ''); setConfig({ ...formDefaults, universe_id: defaultUniverse, benchmark_id: defaultBenchmark, ...strategy?.config, factor_id: strategy?.config?.factor_id || factors[0]?.id || '' }); setComponents(strategy?.config?.factors?.length ? strategy.config.factors : [{ factor_id: strategy?.config?.factor_id || factors[0]?.id || '', weight: 1 }]); setError(''); }
    function requestConfig() { return { ...config, work_replay: factors.some(f => (kind === 'factor' ? f.id === config.factor_id : components.some(x => x.factor_id === f.id && x.weight !== 0)) && f.source_kind === 'legacy'), ...(kind === 'strategy' ? { factors: components, factor_id: components[0]?.factor_id } : {}), corporate_action_mode: config.corporate_action_mode || (publicMode ? 'price_only' : 'adjusted_units') }; }
    function validate(forRun = true) { if (!name.trim())
        return '请填写任务或策略名称。'; if (config.start_date > config.end_date)
        return '开始日期不能晚于结束日期。'; if (kind === 'factor' && !config.factor_id)
        return '请选择一个可运行因子。'; if (kind === 'strategy' && (!components.length || components.some(c => !c.factor_id)))
        return '请为组合选择因子。'; if (kind === 'strategy' && components.some(c => !Number.isFinite(c.weight) || Math.abs(c.weight) > 100))
        return '信号权重必须是 -100 至 100 的有限数字（无量纲）。'; if (kind === 'strategy' && components.every(c => c.weight === 0))
        return '组合权重不能全部为 0。'; if (kind === 'strategy' && new Set(components.map(c => c.factor_id)).size !== components.length)
        return '同一个因子不能重复加入组合。'; if (forRun && unavailable.length)
        return unavailable.map(item => `${item.factor?.name || item.factor_id}：${item.readiness.reason}`).join('\n'); if (forRun && runBlocked)
        return '请先选择当前引擎可用的股票池和基准。'; return ''; }
    async function submit() { const invalid = validate(); if (invalid) {
        setError(invalid);
        return;
    } setBusy('run'); setError(''); try {
        const payload = { name, kind, config: requestConfig() };
        const check = await api<RecordData>('/research/preflight', 'POST', payload);
        if (!check.ready) { setError(check.errors?.length ? check.errors.join('\n') : '当前研究配置未通过数据预检。'); return; }
        const run = await api<Run>('/runs', 'POST', payload);
        notify('任务已提交，参数与因子版本已冻结。');
        go('/runs/' + run.id);
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy('');
    } }
    async function save() { const invalid = validate(false); if (invalid) {
        setError(invalid);
        return;
    } setBusy('save'); setError(''); try {
        const strategy = await api(selected ? '/strategies/' + selected.id : '/strategies', selected ? 'PUT' : 'POST', { name, description, config: requestConfig(), base_version: selected?.version });
        setSelected(strategy);
        strategiesQuery.refresh();
        notify('策略配置已保存；运行时会重新检查数据可用性。');
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy('');
    } }
    const selectedFactor = factors.find(f => f.id === config.factor_id);
    return <><PageHead eyebrow={kind === 'strategy' ? 'STRATEGY LAB' : 'RESEARCH LAB'} title={kind === 'strategy' ? '多因子量化策略' : '新建因子评测'} description={kind === 'strategy' ? '组合因子、定义持仓与成交约束，用同一口径检验研究假设。' : '固定研究区间与参数，计算因子相关性和分组表现。'} actions={<button className="button" onClick={() => go('/runs')}>查看研究任务 <ArrowRight size={15}/></button>}/>
    {publicMode && <div className="notice amber"><ShieldCheck size={17}/><span>公开研究版 · 固定 12 股小样本 · 未复权价格收益研究，不代表全 A 股。ST、上市日期与完整公司行动数据未接入；配置和结果仅保存在本机浏览器。</span></div>}{(error || factorQuery.error || optionsQuery.error) && <ErrorBox message={error || factorQuery.error || optionsQuery.error} retry={factorQuery.error ? factorQuery.refresh : optionsQuery.error ? optionsQuery.refresh : undefined}/>}
    {factorQuery.loading ? <Loading /> : !factors.length ? <Empty title="还没有因子定义" description="先创建并校验一个原生因子，再开始研究。" action={<button className="button primary" onClick={() => go('/factors/new')}>创建因子</button>}/> : <div className={'research-layout ' + (kind === 'strategy' ? 'with-list' : '')}>
      {kind === 'strategy' && <aside className="strategy-list"><div className="section-label">保存的策略 <button className="icon-button" aria-label="新建策略" onClick={() => choose(null)}><Plus size={15}/></button></div><button className={'strategy-item ' + (!selected ? 'active' : '')} onClick={() => choose(null)}><Plus size={17}/><div><strong>新建研究策略</strong><small>定义新的组合</small></div></button>{strategiesQuery.error && <ErrorBox message={strategiesQuery.error} retry={strategiesQuery.refresh}/>} {(strategiesQuery.data || []).map(strategy => <button key={strategy.id} className={'strategy-item ' + (selected?.id === strategy.id ? 'active' : '')} onClick={() => choose(strategy)}><GitBranch size={17}/><div><strong>{strategy.name}</strong><small>v{strategy.version} · {dateTime(strategy.updated_at || strategy.created_at)}</small></div></button>)}</aside>}
      <div className="form-column"><Panel title="01  研究定义" actions={<Tag tone="purple">{kind === 'factor' ? '单因子研究' : '多因子策略'}</Tag>}><div className="padded"><div className="research-factor-search"><SearchInput value={factorSearch} onChange={setFactorSearch} placeholder="搜索因子名称、代码或分类"/><span>{factors.length} 个未删除定义 · 包含 work 与 Alpha101</span></div><div className="form-grid"><Field label={kind === 'factor' ? '任务名称' : '策略 / 任务名称'}><input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'factor' ? '例如：短期反转 · 2024 年研究' : '例如：量价多因子 · 等权组合'}/></Field>{kind === 'factor' ? <Field label="研究因子"><select value={config.factor_id} onChange={e => update('factor_id', e.target.value)}><FactorOptions factors={factors} value={config.factor_id} search={factorSearch} publicMode={publicMode} availableFields={availableFields}/></select></Field> : <Field label="策略说明"><input value={description} onChange={e => setDescription(e.target.value)} placeholder="记录研究假设与适用条件"/></Field>}</div>
        {kind === 'factor' && selectedFactor && <div className="factor-summary"><span className="factor-glyph"><FlaskConical size={21}/></span><div><strong>{selectedFactor.name}</strong><p>{selectedFactor.description}</p><code>{selectedFactor.code}</code></div><Tag tone={chosenFactors[0]?.readiness.available ? "green" : "amber"}>{chosenFactors[0]?.readiness.label}</Tag></div>}
        {kind === 'strategy' && <>
          <div className="weight-header"><span>因子组合</span><small>信号权重（无量纲） · 不是资金比例或持仓比例</small></div>
          <div className="notice purple compact research-weight-definition"><span>多因子先对各自当日有效截面做百分位排名，再按 w / Σ|w| 合成，合成只保留共同有效样本。例：2 : 1 的合成系数为 66.67% : 33.33%；负权重反向。资金分配由下方“单只股票最大仓位”约束。</span></div>
          {components.map((item, i) => { const readiness = chosenFactors[i]?.readiness; return <div className="research-factor-item" key={i}>
            <div className="weight-row"><span className="step-index">{String(i + 1).padStart(2, '0')}</span><select aria-label={'第 ' + (i + 1) + ' 个因子'} value={item.factor_id} onChange={e => setComponents(items => items.map((v, j) => j === i ? { ...v, factor_id: e.target.value } : v))}><FactorOptions factors={factors} value={item.factor_id} search={factorSearch} publicMode={publicMode} availableFields={availableFields}/></select><label>信号权重（无量纲）<input aria-label={'第 ' + (i + 1) + ' 个因子信号权重（无量纲）'} type="number" min="-100" max="100" step="0.1" value={item.weight} onChange={e => setComponents(items => items.map((v, j) => j === i ? { ...v, weight: Number(e.target.value) } : v))}/></label><button className="icon-button" disabled={components.length <= 1} aria-label="移除此因子" onClick={() => setComponents(items => items.filter((_, j) => j !== i))}><Trash2 size={16}/></button></div>
            <div className="research-factor-status"><Tag tone={readiness?.available ? 'green' : 'amber'}>{readiness?.label}</Tag><span>{item.weight === 0 ? '权重为 0，不参与信号合成。' : `标准化合成系数 ${weightSum && Number.isFinite(item.weight) ? (item.weight / weightSum * 100).toFixed(2) + '%' : '—'}（非仓位）`}</span><button className="text-button" onClick={() => go('/factors/' + item.factor_id)}>查看定义</button></div>
          </div>; })}
          <button className="text-button add-factor" disabled={components.length >= Math.min(8, factors.length)} onClick={() => setComponents(items => [...items, { factor_id: factors.find(f => !items.some(item => item.factor_id === f.id) && factorReadiness(f, publicMode, availableFields).available)?.id || factors.find(f => !items.some(item => item.factor_id === f.id))?.id || '', weight: 1 }])}><Plus size={15}/> 添加因子</button>
          {activeCount === 1 && <p className="form-footnote">当前仅 1 个非零权重因子：保留原始因子值并按权重符号定向，正权重 1、2、100 结果相同；负值反转方向。</p>}
        </>}
        {unavailable.length > 0 && <div className="research-blockers notice amber"><ShieldCheck size={17}/><div><strong>{kind === 'strategy' ? '当前组合暂不能运行，可先保存研究设计' : '当前因子暂不能运行'}</strong>{unavailable.map((item, i) => <p key={i}>{item.factor?.name || item.factor_id}：{item.readiness.reason}</p>)}{publicMode && <button className="text-button" onClick={() => go('/engine')}>连接本地研究引擎 <ArrowRight size={13}/></button>}</div></div>}

      </div></Panel>
      <Panel title="02  样本与评测参数"><div className="padded"><div className="notice purple compact"><span>{publicMode ? "当前数据：公开固定股票样本" : "当前数据：本地 data 全市场日线"} · {dataQuery.data?.start_date} — {dataQuery.data?.end_date}{!publicMode && "；单次任务最多三年，可按区间分别研究。"} <button className="text-button" onClick={() => go("/data")}>查看目录与字段</button></span></div>{hasWork && !publicMode && <div className="notice amber compact"><span>本次使用既有因子值快照回放，读取原 Parquet 并按历史交易资格过滤；不会执行当前 Python 源码。原值生成的时点正确性尚待完整核验，修改代码不会自动改变原值。</span></div>}<div className="form-grid"><Field label="股票池" hint={selectedUniverse?.description || '按所选股票池历史成员与交易资格确定可选证券。'}><select value={config.universe_id || ''} onChange={e => update('universe_id', e.target.value)} disabled={optionsQuery.loading}><option value="" disabled>选择股票池</option>{config.universe_id && !universes.some(item => item.id === config.universe_id) && <option value={config.universe_id}>当前环境不可用 · {config.universe_id}</option>}{universes.map(item => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name}{item.available === false ? ' · 不可用' : ''}</option>)}</select></Field><Field label="研究基准" hint={selectedBenchmark?.basis || selectedBenchmark?.description || '基准的名称、收益口径和来源写入任务记录。'}><select value={config.benchmark_id || ''} onChange={e => update('benchmark_id', e.target.value)} disabled={optionsQuery.loading}><option value="" disabled>选择研究基准</option>{config.benchmark_id && !benchmarks.some(item => item.id === config.benchmark_id) && <option value={config.benchmark_id}>当前环境不可用 · {config.benchmark_id}</option>}{benchmarks.map(item => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name}{item.available === false ? ' · 不可用' : ''}</option>)}</select></Field><Field label="开始日期"><input type="date" value={config.start_date} onChange={e => update('start_date', e.target.value)}/></Field><Field label="结束日期"><input type="date" value={config.end_date} onChange={e => update('end_date', e.target.value)}/></Field><Field label="预测持有期" hint="交易日；信号与未来收益的时序由引擎固定。"><input type="number" min="1" max="60" value={config.horizon} onChange={e => update('horizon', Number(e.target.value))}/></Field><Field label="分组数量"><select value={config.quantiles} onChange={e => update('quantiles', Number(e.target.value))}><option value="5">5 组</option><option value="10">10 组</option></select></Field></div>{!publicMode && <label className="checkbox-field"><input type="checkbox" checked={config.exclude_st} onChange={e => update('exclude_st', e.target.checked)}/><span>排除 ST 股票</span></label>}</div></Panel>
      <Panel title="03  成交与成本假设" actions={<button className="text-button" onClick={() => setAdvanced(!advanced)}>{advanced ? '收起参数' : '展开参数'} <ChevronDown size={15} className={advanced ? 'rotated' : ''}/></button>}><div className="padded"><div className="assumption-strip"><span>次日开盘执行</span><span>A 股 T+1</span>{publicMode ? <span>原始价格 · 不模拟停牌和涨跌停</span> : <span>停牌 / 涨跌停约束</span>}<span>显式交易成本</span></div>{advanced && <div className="form-grid three">{numericFields.filter(([key]) => !publicMode || key !== 'min_ipo_days').map(([key, label, unit]) => <Field key={key} label={label + '（' + unit + '）'}><input type="number" min={['top_n', 'rebalance_days', 'initial_cash'].includes(key) ? 1 : 0} step={['max_weight', 'max_participation'].includes(key) ? 0.01 : key.endsWith('bps') ? 0.1 : 1} max={['max_weight', 'max_participation'].includes(key) ? 1 : undefined} value={config[key]} onChange={e => update(key, Number(e.target.value))}/></Field>)}</div>}{!publicMode && <><Field label="公司行动处理"><select value={config.corporate_action_mode} onChange={e => update('corporate_action_mode', e.target.value)}><option value="adjusted_units">复权等价份额 · 研究回测</option><option value="strict">严格模式 · 缺少公司行动明细则失败</option></select></Field><div className="notice amber compact"><ShieldCheck size={17}/><span>复权等价份额用于研究收益，不代表真实股数交割。分红、送转实施明细不完整时，严格模式会拒绝继续计算。</span></div></>}<p className="form-footnote">成本为本次研究的可配置假设；1 bps = 0.01%。所有参数与数据来源会写入任务记录。</p></div></Panel>
      <div className="submit-bar"><div><ShieldCheck size={18}/><span>提交后冻结参数与因子版本，保留每次研究结果。</span></div><div className="actions">{kind === 'strategy' && <button className="button" disabled={!!busy} onClick={save}><Save size={16}/>{busy === 'save' ? '保存中…' : '保存策略'}</button>}<button className="button primary" disabled={!!busy || runBlocked} onClick={submit}><Play size={16}/>{busy === 'run' ? '正在预检与提交…' : kind === 'factor' ? '提交因子评测' : '启动策略回测'}</button></div></div></div>
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
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState('performance'), [comparisonId, setComparisonId] = useState('');
    const optionsQuery = useApi<RecordData>('/research/options');
    const comparisonQuery = useApi<RecordData>(comparisonId ? '/runs/' + encodeURIComponent(id) + '/benchmark?benchmark_id=' + encodeURIComponent(comparisonId) : null);
    const run = query.data;
    useEffect(() => { setComparisonId(''); }, [id]);
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
    const originalBenchmark = result ? benchmarkDescriptor(result, run.config) : null;
    const comparison = comparisonId && comparisonQuery.data?.benchmark?.id === comparisonId ? comparisonQuery.data : null;
    const shownBenchmark = comparison ? benchmarkDescriptor({ benchmark: comparison.benchmark }) : originalBenchmark;
    const comparisonByDate = new Map<string, RecordData>((comparison?.curves || []).map((row: RecordData) => [row.date, row]));
    const shownCurves = comparison ? (result?.curves || []).map((row: RecordData) => ({ ...row, benchmark: comparisonByDate.get(row.date)?.benchmark ?? null })) : result?.curves;
    const shownProvenance = (comparison?.benchmark || result?.benchmark)?.provenance;
    const firstMissing = shownProvenance?.missing?.[0];
    const benchmarkMissing = firstMissing ? `基准数据不完整：${firstMissing.date} ${firstMissing.reason || ''}${firstMissing.missing_open?.length ? '；缺开盘价 ' + firstMissing.missing_open.join('、') : ''}${firstMissing.missing_close?.length ? '；缺收盘价 ' + firstMissing.missing_close.join('、') : ''}。${shownProvenance?.missing_policy || '缺失值不填补。'}` : '';
    const benchmarkChoices = (optionsQuery.data?.benchmarks || []) as RecordData[];
    const tabs = [{ id: 'performance', label: '收益与回撤' }, { id: 'factor', label: '因子详情与十分组' }, { id: 'periods', label: '分期表现' }, { id: 'positions', label: '成交与持仓' }, { id: 'protocol', label: '参数与数据来源' }];
    return <><button className="back-link" onClick={() => go('/runs')}><ArrowLeft size={15}/> 研究任务</button><PageHead eyebrow={run.kind === 'factor' ? 'FACTOR EVALUATION' : 'STRATEGY BACKTEST'} title={run.name} description={`${run.config?.start_date} — ${run.config?.end_date} · ${run.kind === 'factor' ? '因子评测' : '策略研究回测'}`} actions={<>{['queued', 'running', 'pending'].includes(run.status) && <button className="button" disabled={busy} onClick={cancel}><Square size={14}/> 取消任务</button>}{result && <><button className="button" onClick={async () => { try { await exportRun(id); } catch (e) { setError(errorMessage(e)); } }}><Download size={15}/> 导出结果</button><button className="button primary" onClick={() => go('/reports?run=' + id)}><FileText size={15}/> 撰写研究报告</button></>}</>}/>
    {(error || query.error) && <ErrorBox message={error || query.error}/>}<div className="run-status"><Status status={run.status}/>{run.validation_status === 'invalidated' && <Tag tone="red">已作废 · 仅供审计</Tag>}<span>{run.message}</span><span className="mono">{id}</span><small>{dateTime(run.created_at)}</small></div>
    {run.validation_status === 'invalidated' && <ErrorBox message={run.invalid_reason || '此研究结果已作废，仅供审计；请查看修正后的新任务。'}/>}
    {!result && <Panel>{['failed', 'cancelled', 'interrupted'].includes(run.status) ? <div className="padded"><ErrorBox message={run.error || run.message || '任务已结束，未生成研究结果。'}/><details className="raw-detail" open><summary>冻结的参数</summary><JsonView value={run.config}/></details></div> : <div className="run-pending"><span className="large-factor-icon"><FlaskConical size={34}/></span><h2>{run.status === 'queued' ? '任务正在排队' : '正在计算真实研究结果'}</h2><p>{run.message || (publicMode ? '正在当前浏览器中计算，完成前请保持此页面打开。' : '后台正在读取数据并计算。你可以离开本页，任务会继续运行。')}</p><div className="progress"><i style={{ width: Math.min(100, Math.max(0, run.progress || 0)) + '%' }}/></div><small>{Math.round(run.progress || 0)}%</small></div>}</Panel>}
    {result && <><ResearchWarnings warnings={result.warnings || []}/><Panel className="result-metrics" title="任务指标 · 原冻结基准" description={originalBenchmark ? `${originalBenchmark.name} · ${originalBenchmark.basis}` : undefined}><MetricGrid metrics={result.metrics || run.metrics || {}} result={result}/></Panel><Panel><Tabs items={tabs} value={tab} onChange={setTab}/><div className="padded result-panels">{tab === 'performance' && <><div className="research-benchmark-comparison"><div><h3>基准对比</h3><p>选择其它基准独立计算这张净值图的比较序列。任务指标、因子诊断、成交和导出继续使用原冻结结果。</p></div><Field label="对比基准"><select value={comparisonId} onChange={e => setComparisonId(e.target.value)}><option value="">原冻结基准 · {originalBenchmark?.name}</option>{benchmarkChoices.map(item => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name}{item.available === false ? ' · 不可用' : ''}</option>)}</select></Field>{optionsQuery.error && <ErrorBox message={optionsQuery.error} retry={optionsQuery.refresh}/>}{comparisonQuery.error && <ErrorBox message={comparisonQuery.error} retry={comparisonQuery.refresh}/>}{comparisonId && comparisonQuery.loading && <p className="muted">正在读取对比基准；当前图仍显示原冻结基准。</p>}{comparison && <div className="research-comparison-summary"><Tag tone="purple">独立对比 · 未覆盖原任务</Tag><span>{shownBenchmark?.name} · {shownBenchmark?.basis}</span><span>基准区间收益 {fmt(comparison.metrics?.benchmark_return, 'percent')}</span><span>策略减基准累计收益 {fmt(comparison.metrics?.excess_return, 'percent')}</span></div>}{benchmarkMissing && <p className="muted" role="status">{benchmarkMissing}</p>}</div><ChartSection title="净值表现" description={`${shownBenchmark?.name || '基准未记录'} · ${shownBenchmark?.basis || ''}${result.diagnostics?.gross_nav_definition ? '；' + result.diagnostics.gross_nav_definition : ''}`} data={shownCurves} keys={['nav', 'benchmark', 'gross_nav']} labels={{ benchmark: shownBenchmark?.name || '基准未记录' }}/><ChartSection title="策略回撤" data={result.curves} keys={['drawdown']} percent/><ChartSection title="换手与仓位" data={result.curves} keys={['turnover', 'exposure']} percent/></>}{tab === 'factor' && <Suspense fallback={<Loading/>}><EvidencePanels result={result} config={run.config}/></Suspense>}{tab === 'periods' && <><h3>年度表现</h3><DataTable rows={arrayRows(result.yearly)} empty="本任务没有年度统计"/><h3>月度表现</h3><DataTable rows={arrayRows(result.monthly)} empty="本任务没有月度统计"/></>}{tab === 'positions' && <><h3>成交记录</h3><p className="muted">{run.config?.corporate_action_mode === 'price_only' ? '公开样本原始价格研究，未计入分红送转等公司行动；不代表实际账户交割。' : '复权等价份额模式下，数量为研究模型份额，不代表实际交割股数。'}</p><DataTable rows={arrayRows(result.trades)} empty="本任务没有成交记录"/><h3>持仓记录</h3><DataTable rows={arrayRows(result.holdings)} empty="本任务没有持仓记录"/></>}{tab === 'protocol' && <><h3>冻结的实验参数</h3><JsonView value={run.config}/><h3>数据与代码来源</h3><JsonView value={result.provenance}/><h3>研究诊断与可用性限制</h3><JsonView value={result.diagnostics}/></>}</div></Panel></>}
  </>;
}
function arrayRows(value: any): RecordData[] { if (Array.isArray(value))
    return value; return value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => typeof item === 'object' && item ? { period: key, ...item } : { period: key, value: item }) : []; }
function ChartSection({ title, description, data, keys, labels, percent = false }: {
    title: string;
    description?: string;
    data?: RecordData[];
    keys: string[];
    labels?: Record<string, string>;
    percent?: boolean;
}) { const rows = Array.isArray(data) ? data : []; const actual = keys.filter(key => rows.some(row => typeof row[key] === 'number')); return <div className="chart-section"><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{actual.length ? <TimeChart data={rows} keys={actual} labels={labels} percent={percent}/> : <Empty title="本任务未计算此项" description="仅展示任务实际产生的序列。"/>}</div>; }

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
