import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Braces, Check, ChevronLeft, Code2, Edit3, FileCode2, FileText, GitBranch, History, Play, Plus, RefreshCw, Save } from 'lucide-react';
import { api, errorMessage, type Factor, go, type RecordData, type Run, useApi } from './api';
import { DataTable, Empty, ErrorBox, Field, JsonView, Loading, MetricGrid, PageHead, Pagination, Panel, Tabs, Tag, TimeChart, dateTime, fmt } from './components';
export function FactorLibrary({ publicMode = false }: { publicMode?: boolean }) {
    const query = useApi<Factor[]>('/factors'), runsQuery = useApi<Run[]>('/runs');
    const [category, setCategory] = useState('全部因子'), [page, setPage] = useState(1), [folderOpen, setFolderOpen] = useState(true);
    const blankFilters = { search: '', source: 'all', icMin: '', icMax: '', irMin: '', irMax: '' };
    const [draft, setDraft] = useState(blankFilters), [filters, setFilters] = useState(blankFilters), [sort, setSort] = useState<{ key: string; descending: boolean }>({ key: 'name', descending: false });
    const factors = query.data || [], categories = Array.from(new Set(factors.map(f => f.category || '未分类')));
    const evaluated = factors.map(factor => {
        const latest = [...(runsQuery.data || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).find(run => run.status === 'completed' && run.kind === 'factor' && run.config?.factor_versions?.length === 1 && run.config.factor_versions[0].id === factor.id && run.config.factor_versions[0].version === factor.version);
        return { factor, run: latest, ic: latest?.metrics?.ic_mean ?? null, ir: latest?.metrics?.ic_ir ?? latest?.metrics?.icir ?? null };
    });
    const bounded = (value: number | null, low: string, high: string, scale = 1) => !low && !high || value !== null && (!low || value >= Number(low) / scale) && (!high || value <= Number(high) / scale);
    const filtered = evaluated.filter(({ factor, ic, ir }) => (category === '全部因子' || (factor.category || '未分类') === category) && (filters.source === 'all' || factor.source_kind === filters.source) && `${factor.name} ${factor.id} ${factor.description}`.toLowerCase().includes(filters.search.toLowerCase()) && bounded(ic, filters.icMin, filters.icMax, 100) && bounded(ir, filters.irMin, filters.irMax));
    filtered.sort((a, b) => { const av = sort.key === 'name' ? a.factor.name : sort.key === 'ic' ? a.ic : a.ir, bv = sort.key === 'name' ? b.factor.name : sort.key === 'ic' ? b.ic : b.ir; if (av === null) return bv === null ? 0 : 1; if (bv === null) return -1; return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'zh-CN')) * (sort.descending ? -1 : 1); });
    useEffect(() => setPage(1), [filters, category]);
    const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 12)));
    const changeDraft = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
    const sortBy = (key: string) => setSort(current => ({ key, descending: current.key === key ? !current.descending : true }));
    const refresh = () => { query.refresh(); runsQuery.refresh(); };
    return <div className="factor-research-page">
        <div className="reference-page-head"><div><h1>因子研究平台</h1><Tag tone="blue">A 股多因子量化投研</Tag></div><div className="actions"><button className="button" onClick={refresh}><RefreshCw size={14}/> 刷新</button><button className="button blue-soft" onClick={() => go('/events')}>事件研究</button><button className="button primary" onClick={() => go('/research')}><Plus size={15}/> 提交评测任务</button><button className="button" onClick={() => go('/factors/new')}><Plus size={15}/> 新建因子</button></div></div>
        <div className="page-tabs research-tabs"><button onClick={() => go('/runs')}>评测任务</button><span className="active">因子库</span><button onClick={() => go('/reports')}>回测报告</button><button onClick={() => go('/data')}>数据与股票池</button></div>
        {query.error && <ErrorBox message={query.error} retry={refresh}/>}{runsQuery.error && <ErrorBox message={'评测指标暂不可用：' + runsQuery.error} retry={runsQuery.refresh}/>}
        {query.loading ? <Loading/> : <div className={'library-layout reference-library ' + (!folderOpen ? 'folders-collapsed' : '')}>
            <aside className="category-panel"><div className="folder-title"><strong>{folderOpen ? '因子文件夹' : '分类'}</strong><button className="icon-button" aria-label={folderOpen ? '收起因子文件夹' : '展开因子文件夹'} onClick={() => setFolderOpen(!folderOpen)}><ChevronLeft size={17} className={!folderOpen ? 'rotated' : ''}/></button></div>{folderOpen && <>{['全部因子', ...categories].map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}><span>{item}</span><small>({item === '全部因子' ? factors.length : factors.filter(f => (f.category || '未分类') === item).length})</small></button>)}<button className="folder-create" onClick={() => go('/factors/new')}><Plus size={13}/> 新建因子 / 分类</button></>}</aside>
            <div className="library-content"><div className="factor-filters"><div className="range-filter"><span>IC</span><input aria-label="最小 IC 百分比" type="number" placeholder="最小 %" value={draft.icMin} onChange={e => changeDraft('icMin', e.target.value)}/><i>~</i><input aria-label="最大 IC 百分比" type="number" placeholder="最大 %" value={draft.icMax} onChange={e => changeDraft('icMax', e.target.value)}/></div><div className="range-filter"><span>ICIR</span><input aria-label="最小 ICIR" type="number" placeholder="最小" value={draft.irMin} onChange={e => changeDraft('irMin', e.target.value)}/><i>~</i><input aria-label="最大 ICIR" type="number" placeholder="最大" value={draft.irMax} onChange={e => changeDraft('irMax', e.target.value)}/></div><label className="source-filter">来源<select aria-label="因子来源" value={draft.source} onChange={e => changeDraft('source', e.target.value)}><option value="all">全部</option><option value="native_ast">原生可执行</option><option value="legacy">历史只读归档</option></select></label><div className="filter-second-row"><label>名称<input aria-label="搜索因子名称或代码" placeholder="搜索因子名称、代码" value={draft.search} onChange={e => changeDraft('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setFilters(draft); }}/></label><button className="button primary" onClick={() => setFilters(draft)}>筛选</button><button className="text-button reset-filter" onClick={() => { setDraft(blankFilters); setFilters(blankFilters); setCategory('全部因子'); }}>重置</button><span className="filter-scope">IC 口径：当前版本最近一次单因子评测</span></div></div>
                <Panel className="library-panel"><div className="table-scroll"><table className="factor-table reference-factor-table"><thead><tr><th><button className="table-sort" onClick={() => sortBy('name')}>名称</button></th><th>factor_code</th><th>标签</th><th><button className="table-sort" onClick={() => sortBy('ic')}>IC {sort.key === 'ic' && !sort.descending ? <ArrowUp size={14}/> : <ArrowDown size={14}/>}</button></th><th><button className="table-sort" onClick={() => sortBy('ir')}>ICIR {sort.key === 'ir' && !sort.descending ? <ArrowUp size={14}/> : <ArrowDown size={14}/>}</button></th><th>说明</th><th>操作</th></tr></thead><tbody>{filtered.slice((safePage - 1) * 12, safePage * 12).map(({ factor: f, run, ic, ir }) => <tr key={f.id}><td><button className="name-link" onClick={() => go('/factors/' + f.id)}>{f.name}</button><small className="cell-sub">v{f.version} · {f.source_kind === 'native_ast' ? '原生因子' : '历史归档'}</small></td><td className="factor-code">{f.id}</td><td><Tag tone="green">{f.category || '未分类'}</Tag></td><td className={ic === null ? 'unmeasured' : ic < 0 ? 'negative' : 'positive'} title={run ? `${run.name}：${run.config.start_date} — ${run.config.end_date}` : '当前版本尚无评测'}>{fmt(ic, 'ic')}</td><td className="numeric">{fmt(ir)}</td><td><p className="factor-description" title={f.description}>{f.description || '尚未填写说明'}</p></td><td><div className="table-actions"><button aria-label={'编辑 ' + f.name} title={f.source_kind === 'legacy' ? '查看原始定义' : '编辑因子'} onClick={() => go('/factors/' + f.id)}><Edit3 size={15}/></button><button aria-label={'查看 ' + f.name + ' 计算结构'} title="计算结构" onClick={() => go('/factors/' + f.id + '?tab=structure')}><Code2 size={16}/></button><button aria-label={'评测 ' + f.name} title={f.source_kind === 'legacy' ? '历史代码尚未适配执行' : '提交评测'} disabled={f.source_kind !== 'native_ast'} onClick={() => go('/research?factor=' + f.id)}><Play size={14}/></button><button aria-label={'查看 ' + f.name + ' 来源'} title="版本与来源" onClick={() => go('/factors/' + f.id + '?tab=versions')}><FileText size={15}/></button></div></td></tr>)}</tbody></table></div>{!filtered.length && <Empty title="没有符合条件的因子" description="修改筛选条件，或创建一个新的研究因子。"/>}<Pagination page={safePage} total={filtered.length} onChange={setPage} size={12}/></Panel>
                <p className="data-scope-note">{publicMode ? '固定 12 股公开小样本 · 未复权价格收益研究。' : ''}未评测指标显示 —。IC 与 ICIR 对应当前版本最近一次单因子评测，研究任务保留完整数据范围与计算口径。</p>
            </div>
        </div>}
    </div>;
}
export function FactorDetail({ id, notify }: {
    id: string;
    notify: (s: string) => void;
}) {
    const isNew = id === 'new';
    const query = useApi<Factor>(isNew ? null : '/factors/' + encodeURIComponent(id));
    const operators = useApi<RecordData[]>('/operators');
    const [name, setName] = useState(''), [category, setCategory] = useState('量价'), [description, setDescription] = useState(''), [code, setCode] = useState(''), [tab, setTab] = useState(new URLSearchParams(window.location.hash.split('?')[1]).get('tab') || 'definition');
    const [validation, setValidation] = useState<RecordData | null>(null), [validatedCode, setValidatedCode] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('');
    const factor = query.data;
    const legacy = factor?.source_kind === 'legacy';
    useEffect(() => { if (factor) {
        setName(factor.name);
        setCategory(factor.category);
        setDescription(factor.description || '');
        setCode(factor.code || '');
        setValidation(null);
        setValidatedCode('');
    } }, [factor]);
    const dirty = isNew ? !!(name.trim() || code.trim() || description.trim()) : !!factor && (code !== factor.code || name !== factor.name || category !== factor.category || description !== (factor.description || ''));
    const steps = validation?.steps ?? factor?.steps ?? [];
    const stepKinds: Record<string, string> = { assignment: '变量赋值', parameter: '参数', transform: '变换', output: '输出' };
    useEffect(() => { if (!dirty)
        return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
    async function validate() { setBusy('validate'); setError(''); try {
        const v = await api('/factors/validate', 'POST', { code });
        setValidation(v);
        setValidatedCode(code);
        if (v.valid)
            notify('定义校验通过，可以保存新版本。');
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy('');
    } }
    async function save() { setBusy('save'); setError(''); try {
        const v = await api('/factors/validate', 'POST', { code });
        setValidation(v);
        setValidatedCode(code);
        if (!v.valid) {
            setError('定义校验未通过，请修正后再保存。');
            return;
        }
        const saved = await api<Factor>(isNew ? '/factors' : '/factors/' + id, isNew ? 'POST' : 'PUT', { name, category, description, code, base_version: factor?.version });
        notify('已保存因子 v' + saved.version);
        if (isNew)
            go('/factors/' + saved.id);
        else
            query.refresh();
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy('');
    } }
    if (!isNew && query.loading)
        return <Loading />;
    if (query.error)
        return <ErrorBox message={query.error} retry={query.refresh}/>;
    const tabs = [{ id: 'definition', label: legacy ? '原始定义' : '定义与编辑' }, { id: 'structure', label: '计算结构' }, { id: 'versions', label: '版本记录' }, ...(legacy ? [{ id: 'history', label: '历史研究结果' }] : [])];
    return <><button className="back-link" onClick={() => go('/factors')}><ArrowLeft size={15}/> 因子库</button><PageHead eyebrow={legacy ? 'RESEARCH ARCHIVE' : 'FACTOR WORKSPACE'} title={isNew ? '新建因子' : factor?.name || '因子详情'} description={legacy ? '原始研究资产只读展示。历史结果保留原计算口径与局限。' : '编辑可执行因子定义，校验计算结构，保存独立的新版本。'} actions={!legacy && <><button className="button" disabled={!factor || dirty} title={dirty ? '请先保存当前修改' : '运行已保存版本'} onClick={() => go('/research?factor=' + id)}><Play size={15}/> 评测当前版本</button><button className="button primary" disabled={!!busy || !name.trim() || !code.trim()} onClick={save}><Save size={15}/>{busy === 'save' ? '保存中…' : isNew ? '保存因子' : '保存新版本'}</button></>}/>
    {(error || query.error) && <ErrorBox message={error || query.error}/>}<div className="definition-meta"><Tag tone={legacy ? 'amber' : 'green'}>{legacy ? '历史代码 · 只读' : '原生 AST · 可运行'}</Tag>{factor && <Tag>版本 {factor.version}</Tag>}{dirty && <Tag tone="amber">有未保存的修改</Tag>}{factor?.source_path && <span className="source-path" title={factor.source_path}>{factor.source_path}</span>}</div>
    {legacy && <div className="notice amber"><History size={18}/><div>历史研究结果不等于已通过当前平台复现。{(factor?.limitations || []).map((v: any, i: number) => <p key={i}>{typeof v === 'string' ? v : JSON.stringify(v)}</p>)}</div></div>}
    <Panel><Tabs items={tabs} value={tab} onChange={setTab}/>{tab === 'definition' && <div className="editor-layout"><div className="editor-main"><div className="form-grid"><Field label="因子名称"><input value={name} readOnly={legacy} onChange={e => setName(e.target.value)} placeholder="给这个研究想法一个名称"/></Field><Field label="分类"><input value={category} readOnly={legacy} onChange={e => setCategory(e.target.value)}/></Field></div><Field label="研究假设与说明"><textarea rows={3} value={description} readOnly={legacy} onChange={e => setDescription(e.target.value)} placeholder="说明经济逻辑、预期方向，以及什么结果会否定这一假设。"/></Field><div className="code-toolbar"><span><Code2 size={16}/>{legacy ? '原始 Python 定义' : '因子表达式'}</span>{!legacy && <button className="text-button" disabled={!!busy || !code.trim()} onClick={validate}><Check size={15}/>{busy === 'validate' ? '校验中…' : '校验定义'}</button>}</div><textarea className="code-editor" aria-label="因子代码" value={code} readOnly={legacy} spellCheck={false} onChange={e => { setCode(e.target.value); setValidation(null); }} placeholder="例如：factor = -returns(close, 5)"/>{validation && <div className={'validation-result ' + (validation.valid ? 'success' : 'invalid')}>{validation.valid ? <><Check size={16}/> 语法与依赖校验通过{code !== validatedCode ? ' · 代码已修改，请重新校验' : ''}</> : <><Braces size={16}/><div>{(validation.errors || ['定义不合法']).map((v: any, i: number) => <p key={i}>{typeof v === 'string' ? v : JSON.stringify(v)}</p>)}</div></>}</div>}</div><aside className="operator-panel"><div className="section-label"><FileCode2 size={15}/> 算子与字段</div><p>表达式经结构化解析后执行。只允许平台支持的字段和算子。</p>{operators.error && <ErrorBox message={operators.error}/>}<div className="operator-list">{(operators.data || []).map((op, i) => <details key={op.name || i}><summary><code>{op.name || op.signature || '算子'}</code></summary><p>{op.description || op.doc || op.docstring}</p>{op.signature && <code>{op.signature}</code>}{op.example && <pre>{typeof op.example === 'string' ? op.example : JSON.stringify(op.example)}</pre>}{!op.description && !op.doc && !op.signature && <JsonView value={op}/>}</details>)}</div></aside></div>}
      {tab === 'structure' && <div className="padded"><div className="structure-heading"><div><h3>字段依赖与计算步骤</h3><p className="muted">{legacy ? '以下结构来自归档代码解析。' : '保存的 AST 与表达式对应；修改后请校验以查看新结构。'}</p></div>{!legacy && <button className="button" onClick={validate} disabled={!!busy}>解析当前代码</button>}</div><div className="dependency-tags large">{(validation?.dependencies || factor?.dependencies || []).map((d: string) => <code key={d}>{d}</code>)}</div>{steps.length > 0 && <ol className="steps">{steps.map((step: any, i: number) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span><div>{typeof step === 'string' ? step : <><code className="step-code">{step.code || step.target || step.operation || step.kind}</code><small className="step-hint">{stepKinds[step.kind] || step.kind} {step.operation ? ' · ' + (step.operation === 'constant' ? '常量' : step.operation) : ''}{step.window ? ' · 窗口 ' + step.window : ''}{typeof step.lookback_days === 'number' ? ' · 累计回看 ' + step.lookback_days + ' 个交易日' : ''}</small>{!step.code && <JsonView value={step}/>}</>}</div></li>)}</ol>}<details className="raw-detail"><summary><Braces size={15}/> 抽象语法树 AST</summary><JsonView value={validation?.ast || factor?.ast || { status: '请先输入定义并校验' }}/></details>{(validation?.parameters || factor?.parameters) && <details className="raw-detail"><summary>参数</summary><JsonView value={validation?.parameters || factor?.parameters}/></details>}</div>}
      {tab === 'versions' && <div className="padded"><p className="muted">每次保存生成独立修订。任务提交后冻结因子版本，后续修改不会改变既有结果。</p>{factor?.versions?.length ? <DataTable rows={factor.versions.map((v: any) => typeof v === 'object' ? v : { version: v })}/> : factor ? <div className="version-row"><GitBranch size={18}/><strong>v{factor.version}</strong><span>{dateTime(factor.created_at)}</span><Tag tone="purple">当前版本</Tag></div> : <Empty title="保存后建立首个版本"/>}</div>}
      {tab === 'history' && factor && <LegacyHistory id={id}/>}</Panel>
  </>;
}
function LegacyHistory({ id }: {
    id: string;
}) { const { data, error, loading, refresh } = useApi('/factors/' + id + '/history'); if (loading)
    return <Loading />; if (error)
    return <div className="padded"><ErrorBox message={error} retry={refresh}/></div>; if (!data)
    return <Empty />; const curves = Array.isArray(data.curves) ? data.curves : []; const keys = Array.from(new Set(curves.flatMap((r: RecordData) => Object.keys(r)))).filter(k => k !== 'date' && curves.some((r: RecordData) => typeof r[k] === 'number')) as string[]; return <div className="padded"><div className="notice amber"><History size={18}/><span>历史存档 · 按原研究口径展示，未经过当前执行引擎重新验证。</span></div>{data.summary && <MetricGrid metrics={data.summary}/>}<Panel title="历史研究序列"><TimeChart data={curves} keys={keys}/></Panel>{Array.isArray(data.ic) && data.ic.length > 0 && <Panel title="历史 IC"><TimeChart data={data.ic} keys={['ic', 'rank_ic']} percent/></Panel>}<details className="raw-detail"><summary>原始结果与来源</summary><JsonView value={data}/></details></div>; }
