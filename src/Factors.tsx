import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Braces, Check, ChevronLeft, Code2, Edit3, FileCode2, FileText, GitBranch, History, Play, Plus, RefreshCw, Save, Trash2, RotateCcw, Copy } from 'lucide-react';
import { api, errorMessage, type Factor, isPublicMode, go, type RecordData, type Run, useApi } from './api';
import { DataTable, Empty, ErrorBox, Field, JsonView, Loading, MetricGrid, PageHead, Pagination, Panel, Tabs, Tag, TimeChart, dateTime, fmt } from './components';
import { FactorResearch } from './FactorEvidence';
export function FactorLibrary({ publicMode = false }: { publicMode?: boolean }) {
    const query = useApi<Factor[]>('/factors'), runsQuery = useApi<Run[]>('/runs');
    const [category, setCategory] = useState('全部因子'), [page, setPage] = useState(1), [folderOpen, setFolderOpen] = useState(true);
    const blankFilters = { search: '', source: 'all', icMin: '', icMax: '', irMin: '', irMax: '' };
    const [draft, setDraft] = useState(blankFilters), [filters, setFilters] = useState(blankFilters), [sort, setSort] = useState<{ key: string; descending: boolean }>({ key: 'name', descending: false });
    const [recycle, setRecycle] = useState(false), [mutationError, setMutationError] = useState('');
    const factors = (query.data || []).filter(f => !!f.deleted === recycle), categories = Array.from(new Set(factors.map(f => f.category || '未分类')));
    const evaluated = factors.map(factor => {
        const latest = [...(runsQuery.data || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).find(run => run.status === 'completed' && run.kind === 'factor' && run.config?.factor_versions?.length === 1 && run.config.factor_versions[0].id === factor.id && run.config.factor_versions[0].version === factor.version && run.config.factor_versions[0].code_hash === factor.code_hash);
        return { factor, run: latest, ic: (latest ? latest.metrics?.ic_mean : factor.version === 1 ? factor.legacy_metrics?.ic_mean : null) ?? null, ir: (latest ? latest.metrics?.icir ?? latest.metrics?.icir_annualized : factor.version === 1 ? factor.legacy_metrics?.icir : null) ?? null };
    });
    const bounded = (value: number | null, low: string, high: string, scale = 1) => !low && !high || value !== null && (!low || value >= Number(low) / scale) && (!high || value <= Number(high) / scale);
    const filtered = evaluated.filter(({ factor, ic, ir }) => (category === '全部因子' || (factor.category || '未分类') === category) && (filters.source === 'all' || (filters.source === 'alpha101' ? factor.definition_origin === 'paper_formula' : filters.source === 'work120' ? factor.catalog_origin === 'work120' || !!factor.source_inventory : factor.source_kind === filters.source)) && `${factor.name} ${factor.id} ${factor.description}`.toLowerCase().includes(filters.search.toLowerCase()) && bounded(ic, filters.icMin, filters.icMax, 100) && bounded(ir, filters.irMin, filters.irMax));
    filtered.sort((a, b) => { const av = sort.key === 'name' ? a.factor.name : sort.key === 'ic' ? a.ic : a.ir, bv = sort.key === 'name' ? b.factor.name : sort.key === 'ic' ? b.ic : b.ir; if (av === null) return bv === null ? 0 : 1; if (bv === null) return -1; return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'zh-CN', { numeric: true })) * (sort.descending ? -1 : 1); });
    useEffect(() => setPage(1), [filters, category]);
    const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 12)));
    const changeDraft = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
    const sortBy = (key: string) => setSort(current => ({ key, descending: current.key === key ? !current.descending : true }));
    const refresh = () => { query.refresh(); runsQuery.refresh(); };
    async function remove(f: Factor) { try { setMutationError(''); await api('/factors/' + f.id, recycle ? 'PUT' : 'DELETE', { base_version: f.version, ...(recycle ? { deleted: false } : {}) }); refresh(); } catch(e) { setMutationError(errorMessage(e)); } }
    return <div className="factor-research-page">
        <div className="reference-page-head"><div><h1>因子研究平台</h1><Tag tone="blue">A 股多因子量化投研</Tag></div><div className="actions"><button className="button" onClick={() => {setRecycle(!recycle);setPage(1);}}>{recycle ? <RotateCcw size={14}/> : <Trash2 size={14}/>} {recycle ? "返回因子库" : "回收站"}</button><button className="button" onClick={refresh}><RefreshCw size={14}/> 刷新</button><button className="button blue-soft" onClick={() => go('/events')}>事件研究</button><button className="button primary" onClick={() => go('/research')}><Plus size={15}/> 提交评测任务</button><button className="button" onClick={() => go('/factors/new')}><Plus size={15}/> 新建因子</button></div></div>
        <div className="page-tabs research-tabs"><button onClick={() => go('/runs')}>评测任务</button><span className="active">因子库</span><button onClick={() => go('/reports')}>回测报告</button><button onClick={() => go('/data')}>数据与股票池</button></div>
        {mutationError && <ErrorBox message={mutationError}/>} {query.error && <ErrorBox message={query.error} retry={refresh}/>}{runsQuery.error && <ErrorBox message={'评测指标暂不可用：' + runsQuery.error} retry={runsQuery.refresh}/>}
        {query.loading ? <Loading/> : <div className={'library-layout reference-library ' + (!folderOpen ? 'folders-collapsed' : '')}>
            <aside className="category-panel"><div className="folder-title"><strong>{folderOpen ? '因子文件夹' : '分类'}</strong><button className="icon-button" aria-label={folderOpen ? '收起因子文件夹' : '展开因子文件夹'} onClick={() => setFolderOpen(!folderOpen)}><ChevronLeft size={17} className={!folderOpen ? 'rotated' : ''}/></button></div>{folderOpen && <>{['全部因子', ...categories].map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}><span>{item}</span><small>({item === '全部因子' ? factors.length : factors.filter(f => (f.category || '未分类') === item).length})</small></button>)}<button className="folder-create" onClick={() => go('/factors/new')}><Plus size={13}/> 新建因子 / 分类</button></>}</aside>
            <div className="library-content"><div className="factor-filters"><div className="range-filter"><span>IC</span><input aria-label="最小 IC 百分比" type="number" placeholder="最小 %" value={draft.icMin} onChange={e => changeDraft('icMin', e.target.value)}/><i>~</i><input aria-label="最大 IC 百分比" type="number" placeholder="最大 %" value={draft.icMax} onChange={e => changeDraft('icMax', e.target.value)}/></div><div className="range-filter"><span>ICIR</span><input aria-label="最小 ICIR" type="number" placeholder="最小" value={draft.irMin} onChange={e => changeDraft('irMin', e.target.value)}/><i>~</i><input aria-label="最大 ICIR" type="number" placeholder="最大" value={draft.irMax} onChange={e => changeDraft('irMax', e.target.value)}/></div><label className="source-filter">来源<select aria-label="因子来源" value={draft.source} onChange={e => changeDraft('source', e.target.value)}><option value="all">全部</option><option value="native_ast">原生可执行</option><option value="alpha101">Alpha101 · 101 定义</option><option value="work120">work · 120 原代码</option><option value="legacy">Python 研究源码</option></select></label><div className="filter-second-row"><label>名称<input aria-label="搜索因子名称或代码" placeholder="搜索因子名称、代码" value={draft.search} onChange={e => changeDraft('search', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setFilters(draft); }}/></label><button className="button primary" onClick={() => setFilters(draft)}>筛选</button><button className="text-button reset-filter" onClick={() => { setDraft(blankFilters); setFilters(blankFilters); setCategory('全部因子'); }}>重置</button><span className="filter-scope">当前版本评测 / 原版历史 IC（保留原口径）</span></div></div>
                <Panel className="library-panel"><div className="table-scroll"><table className="factor-table reference-factor-table"><thead><tr><th><button className="table-sort" onClick={() => sortBy('name')}>名称</button></th><th>factor_code</th><th>标签</th><th><button className="table-sort" onClick={() => sortBy('ic')}>IC {sort.key === 'ic' && !sort.descending ? <ArrowUp size={14}/> : <ArrowDown size={14}/>}</button></th><th><button className="table-sort" onClick={() => sortBy('ir')}>ICIR {sort.key === 'ir' && !sort.descending ? <ArrowUp size={14}/> : <ArrowDown size={14}/>}</button></th><th>说明</th><th>操作</th></tr></thead><tbody>{filtered.slice((safePage - 1) * 12, safePage * 12).map(({ factor: f, run, ic, ir }) => <tr key={f.id}><td><button className="name-link" onClick={() => go('/factors/' + f.id)}>{f.name}</button><small className="cell-sub">v{f.version} · {f.definition_origin === 'paper_formula' ? 'Alpha101' : f.source_kind === 'native_ast' ? '可执行 AST' : 'work 源码'}</small></td><td className="factor-code">{f.id}</td><td><Tag tone="green">{f.category || '未分类'}</Tag></td><td className={ic === null ? 'unmeasured' : ic < 0 ? 'negative' : 'positive'} title={run ? `${run.name}：${run.config.start_date} — ${run.config.end_date}` : f.legacy_metrics && f.version === 1 ? '原始历史 IC，09:33 零成本；方法未独立冻结' : '当前版本尚无评测'}>{fmt(ic, 'ic')}</td><td className="numeric">{fmt(ir)}</td><td><p className="factor-description" title={f.description}>{f.description || '尚未填写说明'}</p></td><td><div className="table-actions"><button aria-label={'编辑 ' + f.name} title={'编辑因子'} onClick={() => go('/factors/' + f.id + '?tab=definition')}><Edit3 size={15}/></button><button aria-label={'查看 ' + f.name + ' 计算结构'} title="计算结构" onClick={() => go('/factors/' + f.id + '?tab=structure')}><Code2 size={16}/></button><button aria-label={'评测 ' + f.name} title={f.source_kind === 'legacy' ? publicMode ? '本地后台可回放既有因子值' : '回放原始因子值快照' : '提交评测'} disabled={f.deleted || !(f.source_kind === 'native_ast' || !publicMode && f.output_metadata?.exists && f.code_hash === f.original_code_hash)} onClick={() => go('/research?factor=' + f.id)}><Play size={14}/></button><button aria-label={'查看 ' + f.name + ' 来源'} title="版本与来源" onClick={() => go('/factors/' + f.id + '?tab=versions')}><FileText size={15}/></button><button aria-label={(recycle ? "恢复 " : "删除 ") + f.name} title={recycle ? "恢复因子" : "移入回收站，保留版本和结果"} onClick={() => remove(f)}>{recycle ? <RotateCcw size={15}/> : <Trash2 size={15}/>}</button></div></td></tr>)}</tbody></table></div>{!filtered.length && <Empty title="没有符合条件的因子" description="修改筛选条件，或创建一个新的研究因子。"/>}<Pagination page={safePage} total={filtered.length} onChange={setPage} size={12}/></Panel>
                <p className="data-scope-note">未评测指标显示 —。work 原版指标来自原 09:33 历史研究，零费用且存在事后样本筛选；新任务指标对应冻结的当前版本。打开详情可查看完整口径、真实图表和数据来源。</p>
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
    const [name, setName] = useState(''), [category, setCategory] = useState('量价'), [description, setDescription] = useState(''), [code, setCode] = useState(''), [tab, setTab] = useState(new URLSearchParams(window.location.hash.split('?')[1]).get('tab') || (isNew ? 'definition' : 'research'));
    const [validation, setValidation] = useState<RecordData | null>(null), [validatedCode, setValidatedCode] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('');
    const factor = query.data;
    const legacy = factor?.source_kind === 'legacy';
    const [language, setLanguage] = useState<'restricted' | 'python'>('restricted');
    useEffect(() => { if (factor) setLanguage(factor.source_kind === 'legacy' ? 'python' : 'restricted'); }, [factor?.id]);
    useEffect(() => { if (isNew) { const draft = sessionStorage.getItem('quant.new.factor.draft'); if (draft) { try { const v = JSON.parse(draft); setName(v.name || ''); setCode(v.code || ''); setDescription(v.description || ''); setLanguage(v.language || 'restricted'); } finally { sessionStorage.removeItem('quant.new.factor.draft'); } } } }, [isNew]);
    function cloneNative() { sessionStorage.setItem('quant.new.factor.draft', JSON.stringify({ name: factor?.name + ' · AST 版本', code: factor?.native_code || 'factor = ', description: factor?.description || '', language: 'restricted' })); go('/factors/new'); }
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
        const v = await api('/factors/validate', 'POST', { code, language });
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
        const v = await api('/factors/validate', 'POST', { code, language });
        setValidation(v);
        setValidatedCode(code);
        if (!v.valid) {
            setError('定义校验未通过，请修正后再保存。');
            return;
        }
        const saved = await api<Factor>(isNew ? '/factors' : '/factors/' + id, isNew ? 'POST' : 'PUT', { name, category, description, code, language, base_version: factor?.version });
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
    const tabs = [...(!isNew ? [{ id: 'research', label: '研究详情' }] : []), { id: 'definition', label: '定义与编辑' }, { id: 'structure', label: '计算结构' }, { id: 'versions', label: '版本记录' }];
    return <><button className="back-link" onClick={() => go('/factors')}><ArrowLeft size={15}/> 因子库</button><PageHead eyebrow={legacy ? 'RESEARCH ARCHIVE' : 'FACTOR WORKSPACE'} title={isNew ? '新建因子' : factor?.name || '因子详情'} description={legacy ? '原始代码、结构与历史研究一并保留；支持编辑修订，执行能力按真实依赖区分。' : '查看因子细节和真实研究图表，编辑代码块与 AST，保存独立版本。'} actions={<><button className="button" disabled={!factor || dirty || factor.deleted || (legacy && (isPublicMode || !factor.output_metadata?.exists || factor.code_hash !== factor.original_code_hash))} title={dirty ? '请先保存当前修改' : '运行已保存版本'} onClick={() => go('/research?factor=' + id)}><Play size={15}/> {legacy ? "回放原因子值" : "评测当前版本"}</button><button className="button primary" disabled={!!busy || !name.trim() || !code.trim()} onClick={save}><Save size={15}/>{busy === 'save' ? '保存中…' : isNew ? '保存因子' : '保存新版本'}</button>{legacy && <button className="button" onClick={cloneNative}><Copy size={14}/> 建立 AST 版本</button>}</>}/>
    {(error || query.error) && <ErrorBox message={error || query.error}/>}<div className="definition-meta"><Tag tone={legacy ? 'amber' : 'green'}>{legacy ? 'Python 源码 · 可编辑' : (isPublicMode ? factor?.capability?.missing_public_fields?.length : factor?.industry_levels?.length) ? 'AST 已实现 · 数据待补' : '原生 AST'}</Tag>{factor && <Tag>版本 {factor.version}</Tag>}{dirty && <Tag tone="amber">有未保存的修改</Tag>}{factor?.source_path && <span className="source-path" title={factor.source_path}>{factor.source_path}</span>}</div>
    {legacy && <div className="notice amber compact"><History size={18}/><span>原版历史结果与修改后的定义分别保留。Python 编辑仅解析语法并保存，不自动执行原模块；依赖详情见计算结构。</span></div>}
    <Panel><Tabs items={tabs} value={tab} onChange={setTab}/>{tab === 'research' && factor && <FactorResearch factor={factor}/>} {tab === 'definition' && <div className="editor-layout"><div className="editor-main"><div className="form-grid"><Field label="因子名称"><input value={name} onChange={e => setName(e.target.value)} placeholder="给这个研究想法一个名称"/></Field><Field label="分类"><input value={category} onChange={e => setCategory(e.target.value)}/></Field></div><Field label="研究假设与说明"><textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="说明经济逻辑、预期方向，以及什么结果会否定这一假设。"/></Field><Field label="定义语言"><select aria-label="因子定义语言" value={language} onChange={e => {setLanguage(e.target.value as any);setValidation(null);}}><option value="restricted">安全 AST · 可执行表达式</option><option value="python">Python 源码 · 保存与语法解析</option></select></Field><div className="code-toolbar"><span><Code2 size={16}/>{language === 'python' ? 'Python 源码 · 语法解析' : '安全 AST · 代码块'}</span>{<button className="text-button" disabled={!!busy || !code.trim()} onClick={validate}><Check size={15}/>{busy === 'validate' ? '校验中…' : '校验定义'}</button>}</div><textarea className="code-editor" aria-label="因子代码" value={code} spellCheck={false} onChange={e => { setCode(e.target.value); setValidation(null); }} placeholder="例如：factor = -returns(close, 5)"/>{validation && <div className={'validation-result ' + (validation.valid ? 'success' : 'invalid')}>{validation.valid ? <><Check size={16}/> {language === 'python' ? 'Python 语法解析通过；依赖和执行尚未验证' : '语法与依赖校验通过'}{code !== validatedCode ? ' · 代码已修改，请重新校验' : ''}</> : <><Braces size={16}/><div>{(validation.errors || ['定义不合法']).map((v: any, i: number) => <p key={i}>{typeof v === 'string' ? v : JSON.stringify(v)}</p>)}</div></>}</div>}</div><aside className="operator-panel"><div className="section-label"><FileCode2 size={15}/> 算子与字段</div><p>表达式经结构化解析后执行。只允许平台支持的字段和算子。</p>{operators.error && <ErrorBox message={operators.error}/>}<div className="operator-list">{(operators.data || []).map((op, i) => <details key={op.name || i}><summary><code>{op.name || op.signature || '算子'}</code></summary><p>{op.description || op.doc || op.docstring}</p>{op.signature && <code>{op.signature}</code>}{op.example && <pre>{typeof op.example === 'string' ? op.example : JSON.stringify(op.example)}</pre>}{!op.description && !op.doc && !op.signature && <JsonView value={op}/>}</details>)}</div></aside></div>}
      {tab === 'structure' && <div className="padded"><div className="structure-heading"><div><h3>字段依赖与计算步骤</h3><p className="muted">{legacy ? '以下结构来自归档代码解析。' : '保存的 AST 与表达式对应；修改后请校验以查看新结构。'}</p></div>{<button className="button" onClick={validate} disabled={!!busy}>解析当前代码</button>}</div>{factor?.original_formula && <div className="source-formula"><strong>文献原式</strong><pre>{factor.original_formula}</pre>{factor.source_reference && <a href={factor.source_reference} target="_blank" rel="noreferrer">原文来源</a>}</div>}{factor?.implementation_notes?.length > 0 && <div className="notice purple compact"><div>{factor?.implementation_notes.map((note:string,i:number)=><p key={i}>{note}</p>)}</div></div>}<div className="dependency-tags large">{(validation?.dependencies || factor?.dependencies || []).map((d: string) => <code key={d}>{d}</code>)}</div>{steps.length > 0 && <ol className="steps">{steps.map((step: any, i: number) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span><div>{typeof step === 'string' ? step : <><code className="step-code">{step.code || step.target || step.operation || step.kind}</code><small className="step-hint">{stepKinds[step.kind] || step.kind} {step.operation ? ' · ' + (step.operation === 'constant' ? '常量' : step.operation) : ''}{step.window ? ' · 窗口 ' + step.window : ''}{typeof step.lookback_days === 'number' ? ' · 累计回看 ' + step.lookback_days + ' 个交易日' : ''}</small>{!step.code && <JsonView value={step}/>}</>}</div></li>)}</ol>}<details className="raw-detail"><summary><Braces size={15}/> 抽象语法树 AST</summary><JsonView value={validation?.ast || factor?.ast || { status: '请先输入定义并校验' }}/></details>{factor?.source_bundle?.length > 0 && <FactorSources id={id}/>} {factor?.dependency_audit && <details className="raw-detail"><summary>原代码递归依赖与数据要求</summary><JsonView value={factor.dependency_audit}/><JsonView value={factor.migration}/></details>}{factor?.capability && <details className="raw-detail"><summary>公式实现与数据可用性</summary><JsonView value={factor.capability}/></details>}{(validation?.parameters || factor?.parameters) && <details className="raw-detail"><summary>参数</summary><JsonView value={validation?.parameters || factor?.parameters}/></details>}</div>}
      {tab === 'versions' && <div className="padded"><p className="muted">每次保存生成独立修订。任务提交后冻结因子版本，后续修改不会改变既有结果。</p>{factor?.versions?.length ? <DataTable rows={factor.versions.map((v: any) => typeof v === 'object' ? {版本:v.version,名称:v.name,保存时间:dateTime(v.updated_at || v.created_at),代码指纹:v.code_hash,状态:v.deleted?'回收站':'已保存'} : { version: v })}/> : factor ? <div className="version-row"><GitBranch size={18}/><strong>v{factor.version}</strong><span>{dateTime(factor.created_at)}</span><Tag tone="purple">当前版本</Tag></div> : <Empty title="保存后建立首个版本"/>}</div>}
      {tab === 'history' && factor && <FactorResearch factor={factor}/>}</Panel>
  </>;
}

function FactorSources({id}: {id:string}) {
    const [open,setOpen]=useState(false), query=useApi<RecordData>(open?'/factors/'+id+'/sources':null);
    return <details className="raw-detail" onToggle={e=>setOpen(e.currentTarget.open)}><summary>查看原始辅助代码模块与指纹</summary>{open && (query.loading?<Loading/>:query.error?<ErrorBox message={query.error}/>:Object.entries(query.data||{}).map(([path,source])=><details className="raw-detail" key={path}><summary>{path}</summary><small className="hash-wrap">SHA256：{source?.sha256}</small><pre className="source-module-code">{source?.code || '未找到源文件'}</pre></details>))}</details>;
}
