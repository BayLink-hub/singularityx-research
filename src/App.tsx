import { Component, lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowRight, BarChart3, BookOpen, Calculator, Check, ChevronLeft, ChevronRight, Database, Download, FileText, FlaskConical, LockKeyhole, LogOut, Menu, Plus, RefreshCw, Save, Settings, ShieldCheck, SlidersHorizontal, Sparkles, X, Zap } from 'lucide-react';
import { api, downloadFile, errorMessage, go, isPublicBuild, type RecordData, type Run, useApi, useRoute } from './api';
import { DataTable, Empty, ErrorBox, Field, JsonView, Loading, PageHead, Pagination, Panel, SearchInput, Status, Tag, dateTime, fmt } from './components';
const FactorDetail = lazy(() => import('./Factors').then(m => ({ default: m.FactorDetail })));
const FactorLibrary = lazy(() => import('./Factors').then(m => ({ default: m.FactorLibrary })));
const LocalEngine = lazy(() => import('./LocalEngine').then(m => ({ default: m.LocalEngine })));
const DataQuality = lazy(() => import('./DataCenter').then(m => ({ default: m.DataQuality })));
const ResearchForm = lazy(() => import('./Research').then(m => ({ default: m.ResearchForm })));
const RunDetail = lazy(() => import('./Research').then(m => ({ default: m.RunDetail })));
const Runs = lazy(() => import('./Research').then(m => ({ default: m.Runs })));
const OperatorLibrary = lazy(() => import('./ResearchModules').then(m => ({ default: m.OperatorLibrary })));
const IpoCalculator = lazy(() => import('./ResearchModules').then(m => ({ default: m.IpoCalculator })));
const EventResearch = lazy(() => import('./ResearchModules').then(m => ({ default: m.EventResearch })));
const ReplicationPipeline = lazy(() => import('./ResearchModules').then(m => ({ default: m.ReplicationPipeline })));
const SystemStatus = lazy(() => import('./ResearchModules').then(m => ({ default: m.SystemStatus })));
class PageBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
    state = {failed: false};
    static getDerivedStateFromError() { return {failed: true}; }
    render() { return this.state.failed ? <Panel><ErrorBox message="页面未能完整加载，请重新加载后再试。" retry={() => window.location.reload()}/></Panel> : this.props.children; }
}
const navItems = [
    { path: '/factors', label: '因子投资研究系统', icon: FlaskConical },
    { path: '/replication', label: 'AI因子复现流水线', icon: Sparkles },
    { path: '/events', label: '事件驱动研究', icon: Zap },
    { path: '/reports', label: '研究报告和结论', icon: FileText },
    { path: '/ipo', label: '打新市值计算器', icon: Calculator },
    { path: '/operators', label: '人工算子', icon: SlidersHorizontal },
    { path: '/strategies', label: '多因子量化策略', icon: BarChart3 },
    { path: '/runs', label: '研究任务', icon: Activity },
    { path: '/data', label: '数据中心与字段', icon: Database },
    { path: '/engine', label: '本地计算连接', icon: Database },
    { path: '/system', label: '系统状态', icon: Settings },
];
function BrandLogo() {
    const base = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
    return <span className="brand-symbol logo-crop"><img src={base + 'brand/logo.png'} alt="SINGULARITYX 标志"/></span>;
}
export default function App() {
    const route = useRoute(), [requestedPath, search] = route.split('?');
    const path = requestedPath === '/' ? '/factors' : requestedPath;
    const params = new URLSearchParams(search), session = useApi('/session');
    const [sidebar, setSidebar] = useState(false), [collapsed, setCollapsed] = useState(false), [toast, setToast] = useState('');
    const isPublic = session.data?.mode === 'public';
    const modeLabel = isPublic ? '公开研究版 · 本机保存' : session.data?.mode === 'local_bridge' ? '本地完整数据 · 已连接' : session.data?.mode === 'development' ? '本地研究环境' : '研究工作区';
    function notify(message: string) { setToast(message); }
    useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
    useEffect(() => { setSidebar(false); window.scrollTo(0, 0); }, [path]);
    useEffect(() => { const expired = () => session.refresh(); window.addEventListener('quant-session-expired', expired); return () => window.removeEventListener('quant-session-expired', expired); }, [session.refresh]);
    const current = navItems.find(item => path.startsWith(item.path)) || navItems[0];
    if (session.loading) return <div className="app-loading"><strong>SINGULARITYX · 零界演化</strong><Loading/></div>;
    if (session.error) return <div className="login-screen"><Panel title="连接研究服务"><ErrorBox message={session.error} retry={session.refresh}/><p className="muted padded">请确认后台服务已启动，再重新连接。</p></Panel>{isPublicBuild && <PageBoundary><Suspense fallback={<Loading/>}><LocalEngine recovery/></Suspense></PageBoundary>}</div>;
    if (!session.data?.authenticated && !['development', 'public'].includes(session.data?.mode)) return <Login onSuccess={session.refresh}/>;
    return <div className={'app-shell reference-shell ' + (sidebar ? 'sidebar-open ' : '') + (collapsed ? 'sidebar-collapsed' : '')}>
        <aside className="sidebar"><a href="#/factors" className="brand"><BrandLogo/><div><strong>SINGULARITYX</strong><small>零界演化</small></div></a>
            <nav aria-label="主导航">{navItems.map(item => <a key={item.path} title={item.label} href={'#' + item.path} className={current.path === item.path ? 'active' : ''}><item.icon size={21}/><span>{item.label}</span></a>)}</nav>
            <button className="sidebar-collapse" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={19}/> : <ChevronLeft size={19}/>}</button>
            <div className="sidebar-bottom"><span>{modeLabel}</span><small>v0.5.3</small></div>
        </aside>{sidebar && <button className="sidebar-shade" aria-label="关闭导航" onClick={() => setSidebar(false)}/>}
        <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button menu-button" aria-label="展开导航" onClick={() => setSidebar(!sidebar)}><Menu size={20}/></button><a href="#/factors">首页</a><span>/</span><strong>{current.label}</strong></div><div className="topbar-right"><a href="#/engine" className="text-button" title="切换公开样本与本机完整数据"><Tag tone="amber">{modeLabel}</Tag></a><Tag tone="green"><current.icon size={13}/>{current.label}</Tag>{!isPublic && !['development', 'local_bridge'].includes(session.data?.mode) && <button title="退出登录" className="icon-button" onClick={async () => { try { await api('/logout', 'POST'); session.refresh(); } catch (e) { notify(errorMessage(e)); } }}><LogOut size={16}/></button>}</div></header>
            <main key={path} className="workspace">
                <PageBoundary key={path}><Suspense fallback={<Loading/>}>{path === '/factors' ? <FactorLibrary publicMode={isPublic}/> : path.startsWith('/factors/') ? <FactorDetail key={path} id={decodeURIComponent(path.slice(9))} notify={notify}/> : path === '/research' ? <ResearchForm publicMode={isPublic} kind="factor" initialFactor={params.get('factor') || undefined} notify={notify}/> : path === '/strategies' ? <ResearchForm publicMode={isPublic} kind="strategy" notify={notify}/> : path === '/runs' ? <Runs/> : path.startsWith('/runs/') ? <RunDetail publicMode={isPublic} id={decodeURIComponent(path.slice(6))} notify={notify}/> : path === '/reports' ? <Reports initialRun={params.get('run') || undefined} notify={notify}/> : path === '/data' ? <DataQuality publicMode={isPublic}/> : path === '/replication' ? <ReplicationPipeline notify={notify}/> : path === '/events' ? <EventResearch notify={notify}/> : path === '/operators' ? <OperatorLibrary notify={notify}/> : path === '/ipo' ? <IpoCalculator notify={notify}/> : path === '/engine' ? <LocalEngine/> : path === '/system' ? <SystemStatus notify={notify}/> : <Empty title="页面不存在" action={<button className="button" onClick={() => go('/factors')}>返回因子研究</button>}/>}
                </Suspense></PageBoundary><footer className="workspace-footer"><span>SINGULARITYX 零界演化</span><span>{isPublic ? '公开研究版 · 浏览器本机保存 · 不与其他设备自动同步' : '真实研究结果 · 历史表现不代表未来收益'}</span></footer>
            </main>
        </div>{toast && <div role="status" className="toast"><Check size={17}/>{toast}<button aria-label="关闭提示" className="icon-button" onClick={() => setToast('')}><X size={14}/></button></div>}
    </div>;
}
function Login({ onSuccess }: {
    onSuccess: () => void;
}) { const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false); async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); try {
    await api('/login', 'POST', { username, password });
    onSuccess();
}
catch (err) {
    setError(errorMessage(err));
}
finally {
    setBusy(false);
} } return <div className="login-screen"><form className="login-card" onSubmit={submit}><BrandLogo/><div className="eyebrow">SINGULARITYX 零界演化</div><h1>登录研究工作台</h1><p>因子、策略与研究证据，在同一处协作。</p>{error && <ErrorBox message={error}/>}<Field label="用户名"><input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)}/></Field><Field label="密码"><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></Field><button className="button primary" disabled={busy} type="submit"><LockKeyhole size={16}/>{busy ? '验证中…' : '登录'}</button></form></div>; }
function Reports({ initialRun, notify }: { initialRun?: string; notify: (s: string) => void }) {
    const query = useApi<RecordData[]>('/reports'), runs = useApi<Run[]>('/runs');
    const [selected, setSelected] = useState<RecordData | null>(null), [title, setTitle] = useState(''), [body, setBody] = useState(''), [runId, setRunId] = useState(initialRun || ''), [search, setSearch] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [editor, setEditor] = useState(!!initialRun), [category, setCategory] = useState('all'), [page, setPage] = useState(1), [loadedRun, setLoadedRun] = useState<string | null>(null);
    const hydrating = !!initialRun && loadedRun !== initialRun;
    function choose(report: RecordData | null) { setSelected(report); setTitle(report?.title || ''); setBody(report?.body || ''); setRunId(report?.run_id || initialRun || ''); setError(''); setEditor(true); }
    async function save() {
        if (!title.trim() || !runId) { setError('请填写报告标题，并关联一项研究任务。'); return; }
        setBusy(true); setError('');
        try {
            const saved = await api(selected ? '/reports/' + selected.id : '/reports', selected ? 'PUT' : 'POST', { run_id: runId, title, body, base_version: selected?.version });
            setSelected(saved); query.refresh(); notify('研究报告已保存。');
        } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
    }
    function exportReport(report: RecordData = { title, body, run_id: runId }) { downloadFile((report.title || '研究报告').replace(/[\/:*?"<>|]/g, '_') + '.md', `# ${report.title}\n\n关联任务：${report.run_id}\n\n${report.body}\n`, 'text/markdown;charset=utf-8'); }
    const runMap = new Map((runs.data || []).map(run => [run.id, run]));
    const records = (query.data || []).filter(report => `${report.title} ${report.body}`.toLowerCase().includes(search.toLowerCase()) && (category === 'all' || runMap.get(report.run_id)?.kind === category));
    const safePage = Math.min(page, Math.max(1, Math.ceil(records.length / 12)));
    useEffect(() => setPage(1), [search, category]);
    useEffect(() => {
        if (!initialRun) { setLoadedRun(null); return; }
        if (loadedRun === initialRun || !query.data) return;
        const report = query.data.find(item => item.run_id === initialRun);
        setSelected(report || null); setTitle(report?.title || ''); setBody(report?.body || ''); setRunId(initialRun); setEditor(true); setLoadedRun(initialRun);
    }, [initialRun, query.data, loadedRun]);
    return <><div className="reference-page-head"><div><h1>研究报告和结论</h1><Tag tone="blue">研究证据与观点归档</Tag></div><div className="actions"><button className="button" onClick={() => { query.refresh(); runs.refresh(); }}><RefreshCw size={14}/> 刷新</button><button className="button primary" disabled={hydrating} onClick={() => choose(null)}><Plus size={15}/> 新建研究报告</button></div></div>
        <div className="page-tabs"><button className={!editor ? 'active' : ''} onClick={() => setEditor(false)}>报告档案</button><button className={editor ? 'active' : ''} onClick={() => setEditor(true)}>研究结论编辑</button></div>
        {(error || query.error) && <ErrorBox message={error || query.error} retry={query.error ? query.refresh : undefined}/>}{editor && runMap.get(runId)?.validation_status === "invalidated" && <ErrorBox message={runMap.get(runId)?.invalid_reason || "关联结果已作废，仅供审计"}/>}
        {!editor ? <div className="library-layout"><aside className="category-panel"><div className="folder-title"><strong>报告分类</strong></div>{[{id:'all',label:'全部报告'},{id:'factor',label:'单因子研究'},{id:'strategy',label:'策略研究'}].map(item => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}><span>{item.label}</span><small>({(query.data || []).filter(report => item.id === 'all' || runMap.get(report.run_id)?.kind === item.id).length})</small></button>)}</aside>
            <div className="library-content"><Panel><div className="filter-bar"><SearchInput value={search} onChange={setSearch} placeholder="搜索报告名称或研究结论"/><Tag>实际任务关联</Tag></div>{query.loading ? <Loading/> : <><div className="table-scroll"><table className="report-table"><thead><tr><th>报告名称</th><th>关联研究任务</th><th>任务状态</th><th>结论摘要</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{records.slice((safePage - 1) * 12, safePage * 12).map(report => <tr key={report.id}><td><button className="name-link" onClick={() => choose(report)}><FileText size={15}/>{report.title}</button><small className="cell-sub">报告 v{report.version}</small></td><td><button className="text-button" onClick={() => go('/runs/' + report.run_id)}>{runMap.get(report.run_id)?.name || report.run_id}</button></td><td><Status status={runMap.get(report.run_id)?.validation_status === 'invalidated' ? '结果已作废' : runMap.get(report.run_id)?.status || '未知'}/></td><td><p className="report-summary" title={report.body}>{report.body || '尚未填写结论'}</p></td><td className="date-cell">{dateTime(report.updated_at || report.created_at)}</td><td><div className="table-actions"><button aria-label={'编辑报告 ' + report.title} title="编辑研究报告" onClick={() => choose(report)}><FileText size={15}/></button><button aria-label={'导出报告 ' + report.title} title="导出 Markdown" onClick={() => exportReport(report)}><Download size={15}/></button></div></td></tr>)}</tbody></table></div>{!records.length && <Empty title="暂无研究报告" description="完成因子或策略研究后，关联真实任务，记录研究结论与证据。" action={<button className="button" onClick={() => choose(null)}>创建研究报告</button>}/>}<Pagination page={safePage} total={records.length} onChange={setPage} size={12}/></>}</Panel></div></div> : hydrating ? <Loading/> :
        <Panel title={selected ? '编辑研究结论' : '新建研究结论'} actions={<div className="actions">{selected && <Tag>v{selected.version}</Tag>}<button className="text-button" onClick={() => setEditor(false)}>返回报告档案</button></div>}><div className="padded report-editor"><div className="form-grid"><Field label="报告标题"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="研究问题与结论摘要"/></Field><Field label="关联研究任务"><select value={runId} disabled={!!selected} onChange={e => setRunId(e.target.value)}><option value="">选择任务</option>{(runs.data || []).map(run => <option key={run.id} value={run.id}>{run.name} · {run.status}</option>)}</select></Field></div>{runs.error && <ErrorBox message={runs.error} retry={runs.refresh}/>}<div className="report-writing-note"><BookOpen size={17}/><span>记录研究问题、主要结果、反证与限制、下一步。明确区分数据事实、解释和待验证假设。</span></div><Field label="正文（支持 Markdown 文本）"><textarea className="report-body" rows={17} value={body} onChange={e => setBody(e.target.value)} placeholder="写下你的研究结论。结论强度应与证据一致。"/></Field><div className="actions report-actions">{runId && <button className="text-button" onClick={() => go('/runs/' + runId)}>查看关联证据 <ArrowRight size={14}/></button>}<button className="button" disabled={!title.trim()} onClick={() => exportReport()}><Download size={16}/> 导出 Markdown</button><button className="button primary" disabled={busy || !title.trim() || !runId} onClick={save}><Save size={16}/>{busy ? '保存中…' : '保存报告'}</button></div></div></Panel>}
    </>;
}
const auditNames: Record<string, string> = { data_root: '数据目录', root: '数据目录', sources: '数据源', datasets: '数据集', tables: '数据表', coverage: '覆盖范围', summary: '审计摘要', warnings: '限制与提醒', issues: '待核验问题', limitations: '研究限制', start_date: '开始日期', end_date: '结束日期', data_start: '最早日期', data_end: '最新日期', date_range: '数据区间', row_count: '记录数', file_count: '文件数', stock_count: '证券数', symbol_count: '证券数', rows: '记录数', files: '文件数', columns: '字段', schema: '字段结构', path: '路径', format: '格式', name: '名称', frequency: '频率', status: '状态', available: '可用', sample: '样本', sample_rows: '样本记录', sample_size: '抽样数量', audited_at: '审计时间', updated_at: '更新时间', size_bytes: '文件大小（字节）', total_size_bytes: '总大小（字节）', date_min: '最早日期', date_max: '最新日期', min_date: '最早日期', max_date: '最新日期', primary_key: '主键', semantics: '数据口径', adjustment: '复权口径', is_full_scan: '全量扫描', readable: '可读取', description: '说明' };
function AuditValue({ value, depth = 0 }: {
    value: any;
    depth?: number;
}) { if (value === null || value === undefined)
    return <span className="muted">未提供</span>; if (Array.isArray(value)) {
    if (!value.length)
        return <span className="muted">无记录</span>;
    if (value.every(v => typeof v !== 'object'))
        return <ul className="audit-list">{value.map((v, i) => <li key={i}>{fmt(v)}</li>)}</ul>;
    if (value.length > 12 && value.every(v => v && typeof v === 'object' && !Array.isArray(v)))
        return <DataTable rows={value}/>;
    return <div className="audit-items">{value.map((v, i) => <div key={i} className="audit-item"><AuditValue value={v} depth={depth + 1}/></div>)}</div>;
} if (typeof value === 'object')
    return <div className={'audit-fields depth-' + Math.min(depth, 2)}>{Object.entries(value).map(([key, v]) => <div className={'audit-field ' + (v && typeof v === 'object' ? 'wide' : '')} key={key}><span title={key}>{auditNames[key] || key}</span><div><AuditValue value={v} depth={depth + 1}/></div></div>)}</div>; return <span className={typeof value === 'string' && value.startsWith('/') ? 'mono audit-path' : ''}>{fmt(value)}</span>; }
