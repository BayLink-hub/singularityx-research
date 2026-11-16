import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Code2, ExternalLink, FlaskConical, RefreshCw, Save, Send, Settings, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { api, errorMessage, go, isPublicMode, type RecordData, useApi, useRoute } from './api';
import { DataTable, Empty, ErrorBox, Field, JsonView, Loading, PageHead, Panel, SearchInput, Tabs, Tag, dateTime } from './components';
import { DRAFT_KEY } from './researchTools';

type Props = { notify: (message: string) => void; oldView: ReactNode };
type RequestDraft = { idea: string; source_excerpt: string; operator_ids: string[]; provider: string };
type Preview = RecordData & { request: RequestDraft };
const providerName = (provider: string) => provider === 'openai' ? 'OpenAI' : provider === 'deepseek' ? 'DeepSeek' : provider;
const labels: Record<string, string> = { generating: 'AI 正在生成', validated: '候选待确认', failed: '生成失败', saved: 'AST 因子已保存' };
const emptyRequest: RequestDraft = { idea: '', source_excerpt: '', operator_ids: [], provider: '' };
function viewFromRoute(route: string) { const params = new URLSearchParams(route.split('?')[1] || ''); return params.has('manual') ? 'manual' : params.has('settings') ? 'settings' : params.has('new') || params.has('generation') ? 'new' : 'tasks'; }
function templateHandoff(route: string) {
    if (new URLSearchParams(route.split('?')[1] || '').get('template') !== '1') return null;
    try { const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return value?.handoff === 'operator_template' ? value : null; } catch { return null; }
}

function ProviderSettings({ item, canConfigure, refresh, notify }: { item: RecordData; canConfigure: boolean; refresh: () => void; notify: Props['notify'] }) {
    const [model, setModel] = useState(item.model || ''), [apiKey, setApiKey] = useState(''), [limit, setLimit] = useState(item.max_output_tokens || 4096);
    const [busy, setBusy] = useState(''), [error, setError] = useState(''), [tested, setTested] = useState<RecordData | null>(null);
    useEffect(() => { setModel(item.model || ''); setLimit(item.max_output_tokens || 4096); setTested(null); }, [item.model, item.max_output_tokens, item.key_configured]);
    async function act(action: 'save' | 'delete' | 'test') {
        setBusy(action); setError(''); setTested(null);
        const key = apiKey.trim(); setApiKey('');
        try {
            const path = '/ai/providers/' + encodeURIComponent(item.provider);
            if (action === 'test') { const response = await api(path + '/test', 'POST'); setTested(response); notify(providerName(item.provider) + ' 模型列表接口测试已返回。'); }
            else if (action === 'delete') { await api(path, 'DELETE'); notify(providerName(item.provider) + ' 的本机配置已移除。'); }
            else { await api(path, 'PUT', { model: model.trim(), max_output_tokens: limit, ...(key ? { api_key: key } : {}) }); notify(providerName(item.provider) + ' 配置已保存到本地后端。'); }
            refresh();
        } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); }
    }
    return <Panel title={providerName(item.provider)} className="ai-provider-card" actions={<Tag tone={item.key_configured ? 'green' : 'amber'}>{item.key_configured ? 'Key 已在后端配置' : '尚未配置 Key'}</Tag>}><div className="padded ai-stack">
        <p className="muted ai-endpoint">官方接口：{item.base_url}</p>
        {error && <ErrorBox message={error}/>}
        {canConfigure ? <><Field label={providerName(item.provider) + ' 模型'}><input value={model} onChange={event => setModel(event.target.value)} disabled={!!busy} autoComplete="off"/></Field><Field label={providerName(item.provider) + ' API Key'} hint={item.key_configured ? '留空保留现有 Key；输入只用于提交到本地后端，提交后清空。' : '仅由本地后端保管；不会写入浏览器存储、草稿或导出记录。'}><input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={!!busy} autoComplete="new-password" spellCheck={false}/></Field><Field label={providerName(item.provider) + ' 最大输出 token'}><input type="number" min="1024" max="16000" step="1" value={limit} onChange={event => setLimit(Number(event.target.value))} disabled={!!busy}/></Field><div className="actions"><button className="button primary" disabled={!!busy || !model.trim() || !Number.isInteger(limit) || limit < 1024 || limit > 16000 || !item.key_configured && !apiKey.trim()} onClick={() => act('save')}><Save size={15}/>{busy === 'save' ? '保存中…' : '保存本机配置'}</button><button className="button" disabled={!!busy || !item.key_configured} onClick={() => act('test')}>{busy === 'test' ? '测试中…' : '测试模型列表接口'}</button><button className="icon-button" title="移除本机配置" aria-label={'移除 ' + providerName(item.provider) + ' 本机配置'} disabled={!!busy || !item.key_configured} onClick={() => act('delete')}><Trash2 size={16}/></button></div></> : <><p>已配置模型：<strong>{item.model || '—'}</strong></p><p className="muted">Key 仅可在本机管理员页面配置，本页不会读取或回显。</p></>}
        {tested && <div className="notice compact"><span>{tested.connection_tested ? '模型列表接口可访问' : '模型列表接口未验证'} · {tested.model_listed ? '模型在返回列表中' : '模型未出现在返回列表中，请核对模型名称'} · {dateTime(tested.tested_at)}</span></div>}
        {!tested && <small className="muted">{item.connection_tested ? '上次模型列表接口验证：' + dateTime(item.tested_at) : '尚未验证当前配置的模型列表接口'}</small>}
    </div></Panel>;
}

export function AIWorkbench({ notify, oldView }: Props) {
    const route = useRoute(), [view, setView] = useState(() => viewFromRoute(route));
    const requestedGeneration = new URLSearchParams(route.split('?')[1] || '').get('generation');
    const status = useApi<RecordData>(isPublicMode ? null : '/ai/status'), operators = useApi<RecordData[]>(isPublicMode ? null : '/ai/operators');
    const [generation, setGeneration] = useState<RecordData | null>(null);
    const history = useApi<RecordData[]>(isPublicMode ? null : '/ai/generations', generation?.status === 'generating' ? 3000 : 0);
    const detailId = requestedGeneration || generation?.id;
    const detail = useApi<RecordData>(!isPublicMode && detailId ? '/ai/generations/' + encodeURIComponent(detailId) : null, generation?.status === 'generating' ? 2000 : 0);
    const [request, setRequest] = useState<RequestDraft>({ ...emptyRequest }), [operatorSearch, setOperatorSearch] = useState(''), [taskSearch, setTaskSearch] = useState('');
    const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
    const [name, setName] = useState(''), [description, setDescription] = useState(''), [code, setCode] = useState(''), [checkedCode, setCheckedCode] = useState(''), [validation, setValidation] = useState<RecordData | null>(null);
    const initializedOperators = useRef(false), hydratedGeneration = useRef(''), handoffRead = useRef('');
    const providers = (status.data?.providers || []) as RecordData[], definitions = operators.data || [], activeProvider = providers.find(item => item.provider === request.provider);
    const canGenerate = !!activeProvider?.key_configured && !!activeProvider?.model && request.idea.trim().length > 0 && request.operator_ids.length > 0 && !isPublicMode;
    const previewCurrent = !!preview && JSON.stringify(preview.request) === JSON.stringify(request);
    const currentValidation = checkedCode === code ? validation : null;
    const validAST = !!currentValidation?.valid && !!currentValidation?.ast;
    function switchView(next: string) { setView(next); go('/replication' + (next === 'new' ? '?new=1' : next === 'settings' ? '?settings=1' : next === 'manual' ? '?manual=1' : '')); }
    function clearCandidate() { setPreview(null); setGeneration(null); hydratedGeneration.current = ''; setName(''); setDescription(''); setCode(''); setCheckedCode(''); setValidation(null); setError(''); }
    function updateRequest(patch: Partial<RequestDraft>) { setRequest(current => ({ ...current, ...patch })); clearCandidate(); if (requestedGeneration) switchView('new'); }
    function hydrate(item: RecordData) {
        if (!item.proposal?.code || hydratedGeneration.current === item.id) return;
        const proposal = item.proposal; hydratedGeneration.current = item.id;
        setName(proposal.name || ''); setDescription(proposal.hypothesis || ''); setCode(proposal.code); setCheckedCode(proposal.code);
        setValidation({ ...proposal.validation, ast: proposal.ast, dependencies: proposal.dependencies || [], warmup_days: proposal.warmup_days });
    }
    function choose(item: RecordData) { clearCandidate(); setGeneration(item); hydrate(item); setRequest({ idea: item.idea || '', source_excerpt: item.source_excerpt || '', provider: item.provider || '', operator_ids: (item.proposal?.operator_refs || item.request_payload?.operator_refs || item.operator_refs || []).map((op: RecordData) => op.id) }); switchView('new'); }
    function openNew() { clearCandidate(); setRequest(current => ({ ...emptyRequest, provider: current.provider || providers.find(item => item.key_configured)?.provider || providers[0]?.provider || '', operator_ids: definitions.filter(item => item.available).map(item => item.id) })); switchView('new'); }
    useEffect(() => { setView(viewFromRoute(route)); if (requestedGeneration && requestedGeneration !== generation?.id) clearCandidate(); }, [route]);
    useEffect(() => { if (providers.length) setRequest(current => current.provider ? current : { ...current, provider: providers.find(item => item.key_configured)?.provider || providers[0].provider }); }, [status.data]);
    useEffect(() => { setPreview(null); }, [status.data]);
    useEffect(() => {
        if (!operators.data || initializedOperators.current) return;
        const handoff = templateHandoff(route); initializedOperators.current = true;
        setRequest(current => ({ ...current, operator_ids: handoff?.operator_ids || (current.operator_ids.length ? current.operator_ids : definitions.filter(item => item.available).map(item => item.id)) }));
    }, [operators.data]);
    useEffect(() => {
        const handoff = templateHandoff(route); if (!handoff || handoffRead.current === route) return;
        handoffRead.current = route; clearCandidate();
        setRequest(current => ({ ...current, idea: [handoff.name, handoff.definition].filter(Boolean).join('\n\n'), source_excerpt: [handoff.sourceTitle, handoff.sourceUrl].filter(Boolean).join('\n'), operator_ids: handoff.operator_ids || [] }));
    }, [route]);
    useEffect(() => { if (detail.data && detail.data.id === detailId) { setGeneration(detail.data); hydrate(detail.data); if (requestedGeneration) setRequest({ idea: detail.data.idea || '', source_excerpt: detail.data.source_excerpt || '', provider: detail.data.provider || '', operator_ids: (detail.data.proposal?.operator_refs || detail.data.request_payload?.operator_refs || detail.data.operator_refs || []).map((op: RecordData) => op.id) }); } }, [detail.data]);
    async function createPreview() {
        setBusy('preview'); setError(''); setPreview(null);
        try { const snapshot = { ...request, operator_ids: [...request.operator_ids] }; const response = await api('/ai/preview', 'POST', snapshot); setPreview({ ...response, request: snapshot }); }
        catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); }
    }
    async function generate() {
        if (!preview || !previewCurrent) { setError('输入已变更，请重新预览将发送的内容。'); return; }
        setBusy('generate'); setError('');
        try { const item = await api('/ai/generations', 'POST', { ...preview.request, payload_hash: preview.payload_hash, consent: true }); setGeneration(item); hydrate(item); setPreview(null); history.refresh(); if (item.status !== 'failed') notify(item.status === 'generating' ? '生成请求已提交到所选服务。' : '候选已返回；尚未保存为因子，也未进行回测。'); }
        catch (cause) { setError(errorMessage(cause)); setPreview(null); history.refresh(); } finally { setBusy(''); }
    }
    async function validateCode() {
        setBusy('validate'); setError(''); setValidation(null); setCheckedCode('');
        try { const result = await api('/factors/validate', 'POST', { code, language: 'restricted' }); const normalized = result.valid ? result.code || code : code; const dependencies = result.dependencies || []; const missing = dependencies.filter((field: string) => !(status.data?.available_fields || []).includes(field)); setCode(normalized); setCheckedCode(normalized); setValidation({ ...result, missing_fields: missing, fields_ready: !!result.valid && missing.length === 0 }); if (result.valid) notify('当前代码已通过本地 AST 校验。'); }
        catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); }
    }
    async function saveFactor() {
        if (!generation || !validAST || !currentValidation?.fields_ready || !name.trim()) { setError('请先校验当前代码的 AST 与字段可用性，并填写因子名称。'); return; }
        setBusy('save'); setError('');
        try { const factor = await api('/ai/generations/' + encodeURIComponent(generation.id) + '/save', 'POST', { name: name.trim(), description, code }); notify('AST 因子已保存；请核对股票池、基准与参数后提交真实评测。'); go('/research?factor=' + encodeURIComponent(factor.id)); }
        catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); }
    }
    const items = (history.data || []).filter(item => `${item.idea} ${item.proposal?.name || ''} ${item.model}`.toLowerCase().includes(taskSearch.toLowerCase()));
    const shownOperators = definitions.filter(item => `${item.name} ${item.id} ${item.description}`.toLowerCase().includes(operatorSearch.toLowerCase()));
    const unavailableSelections = request.operator_ids.filter(id => !definitions.some(item => item.id === id && item.available));
    if (view === 'manual') return <div className="ai-workbench"><button className="back-link" onClick={() => switchView('tasks')}><ArrowLeft size={15}/> 返回 AI 工作台</button>{oldView}</div>;
    return <div className="ai-workbench"><PageHead title="AI 因子复现流水线" description="让真实 AI 从已登记算子中提出组合计划，由本地引擎编译 AST；人工确认后再进入真实评测。" actions={<><button className="button" onClick={() => switchView('settings')}><Settings size={15}/> API 配置</button><button className="button primary" onClick={openNew}><Sparkles size={15}/> 新建候选因子</button></>}/>
        <Panel><Tabs items={[{ id: 'tasks', label: 'AI 候选记录' }, { id: 'new', label: '生成与确认' }, { id: 'settings', label: 'API 配置' }, { id: 'manual', label: '人工模板与历史' }]} value={view} onChange={switchView}/></Panel>
        {isPublicMode ? <Panel><Empty title="连接本机后使用真实 AI" description="API Key 由本地后端保管。连接后选择已配置的 OpenAI 或 DeepSeek，预览外发内容并确认生成；公开页面不会自行调用模型。" action={<button className="button primary" onClick={() => go('/engine')}>连接本地研究引擎 <ArrowRight size={15}/></button>}/><p className="ai-caption">原人工模板、草稿与历史任务仍可从“人工模板与历史”打开。</p></Panel> : <>
            {(status.error || operators.error) && <ErrorBox message={status.error || operators.error} retry={() => { status.refresh(); operators.refresh(); }}/>}
            {view === 'settings' ? <><div className="notice purple"><ShieldCheck size={17}/><span>{status.data?.can_configure ? '仅连接两家固定官方接口。Key 提交后只由本地后端保管，本页不会回显已保存 Key。' : '当前连接可使用已配置模型。请在这台电脑的本机管理员页面设置或修改 Key。'}</span></div>{status.loading ? <Loading/> : <div className="ai-provider-grid">{providers.map(item => <ProviderSettings key={item.provider} item={item} canConfigure={!!status.data?.can_configure} refresh={status.refresh} notify={notify}/>)}</div>}</> : view === 'tasks' ? <Panel title="AI 生成记录" description="生成失败、未保存的候选与已保存 AST 因子均保留记录。" actions={<button className="text-button" onClick={history.refresh}><RefreshCw size={14}/> 刷新</button>}><div className="filter-bar"><SearchInput value={taskSearch} onChange={setTaskSearch} placeholder="搜索研究想法、候选名称或模型"/><Tag>{items.length} 条实际记录</Tag></div>{history.error && <ErrorBox message={history.error} retry={history.refresh}/>}{history.loading ? <Loading/> : !items.length ? <Empty title="尚无 AI 候选记录" description="先选择模型与算子范围，预览外发内容后再生成。" action={<button className="button primary" onClick={openNew}>新建候选因子</button>}/> : <div className="table-scroll"><table className="ai-history-table"><thead><tr><th>候选 / 研究想法</th><th>实际服务与模型</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><button className="name-link" onClick={() => choose(item)}>{item.proposal?.name || '研究候选'}</button><small className="cell-sub ai-truncate" title={item.idea}>{item.idea}</small></td><td>{providerName(item.provider)}<small className="cell-sub">{item.model}</small></td><td><Tag tone={item.status === 'failed' ? 'red' : item.status === 'saved' ? 'green' : 'purple'}>{labels[item.status] || item.status}</Tag></td><td>{dateTime(item.created_at)}</td><td><button className="text-button" onClick={() => choose(item)}>查看记录</button>{item.factor_id && <button className="text-button" onClick={() => go('/factors/' + item.factor_id)}>查看因子 <ArrowRight size={13}/></button>}</td></tr>)}</tbody></table></div>}</Panel> : <>
                {(error || detail.error) && <ErrorBox message={error || detail.error} retry={detail.error ? detail.refresh : undefined}/>}
                <Panel title="1 · 研究想法与算子范围" actions={<Tag tone={activeProvider?.key_configured ? 'green' : 'amber'}>{activeProvider?.key_configured ? providerName(activeProvider.provider) + ' · 已配置' : '先配置可用模型'}</Tag>}><div className="padded ai-stack">
                    <div className="form-grid"><Field label="AI 服务"><select value={request.provider} disabled={!!busy} onChange={event => updateRequest({ provider: event.target.value })}><option value="" disabled>选择已配置服务</option>{providers.map(item => <option key={item.provider} value={item.provider} disabled={!item.key_configured}>{providerName(item.provider)} · {item.key_configured ? item.model : '未配置'}</option>)}</select></Field><div className="ai-model-summary"><span>调用模型</span><strong>{activeProvider?.model || '—'}</strong><small>{activeProvider?.base_url || '从本地配置读取'}</small></div></div>
                    <Field label="研究想法" hint="描述经济假设、信号方向、时间窗口和希望检验的问题。"><textarea rows={4} value={request.idea} disabled={!!busy} onChange={event => updateRequest({ idea: event.target.value })} placeholder="例如：研究价格反转是否在成交量明显收缩时更强，使用短期收益和成交量稳定性组合。"/></Field>
                    <Field label="参考内容（可选）" hint="可粘贴需要复现的公式或短摘录；仅输入 URL 不代表已经自动读取全文。"><textarea rows={3} value={request.source_excerpt} disabled={!!busy} onChange={event => updateRequest({ source_excerpt: event.target.value })}/></Field>
                    <div className="ai-operator-heading"><div><h3>允许 AI 使用的人工算子</h3><p>动态读取当前目录版本；手填标量和不可用条目不会被当作历史因子计算。</p></div><Tag>{request.operator_ids.length} 项已选</Tag></div>
                    <div className="filter-bar ai-operator-filter"><SearchInput value={operatorSearch} onChange={setOperatorSearch} placeholder="搜索可组合算子"/><button className="text-button" disabled={!!busy || operators.loading} onClick={() => updateRequest({ operator_ids: definitions.filter(item => item.available).map(item => item.id) })}>全选可用</button><button className="text-button" disabled={!!busy || operators.loading} onClick={() => updateRequest({ operator_ids: [] })}>清空</button></div>
                    {operators.loading ? <Loading/> : <div className="ai-operator-grid">{shownOperators.map(item => <label key={item.id} className={'ai-operator-choice ' + (!item.available ? 'unavailable' : '')}><input type="checkbox" aria-label={'允许算子 ' + item.name} checked={request.operator_ids.includes(item.id)} disabled={!!busy || !item.available} onChange={event => updateRequest({ operator_ids: event.target.checked ? [...request.operator_ids, item.id] : request.operator_ids.filter(id => id !== item.id) })}/><span><strong>{item.name}</strong><small>{item.id} · v{item.version}</small><small>{item.available ? item.description : item.reason || '当前不能编译为可用 AST'}</small></span></label>)}</div>}
                    {unavailableSelections.length > 0 && <ErrorBox message={'带入的算子当前不可用：' + unavailableSelections.join('、') + '。请按当前目录重新选择。'}/>}
                    <p className="ai-caption">下一步先展示将发送给所选服务的研究想法、参考内容、算子定义与可用字段名称，再由你确认。行情和股票级因子值不作为这次请求输入。</p>
                    <div className="actions"><button className="button primary" disabled={!!busy || !canGenerate || unavailableSelections.length > 0} onClick={createPreview}><Send size={15}/>{busy === 'preview' ? '准备预览…' : '预览将发送的内容'}</button>{!activeProvider?.key_configured && <button className="text-button" onClick={() => switchView('settings')}>查看 API 配置 <ArrowRight size={14}/></button>}</div>
                </div></Panel>
                {previewCurrent && preview && <Panel title="确认外发内容" description={`${providerName(preview.provider)} · ${preview.model} · ${preview.operator_refs?.length || 0} 个算子版本`}><div className="padded ai-stack"><p>以下为本次发送的研究内容与约束，包含输出 schema 和用量上限。确认后由本地后端按所选官方 API 协议发送，可能产生该服务的用量费用。</p><details className="raw-detail ai-payload" open><summary>本次发送的研究内容与约束</summary><JsonView value={Object.fromEntries(Object.entries(preview).filter(([key]) => key !== 'request'))}/></details><small className="mono ai-hash">本次确认指纹：{preview.payload_hash}</small><div className="actions"><button className="button primary" disabled={!!busy} onClick={generate}><Sparkles size={15}/>{busy === 'generate' ? '正在请求真实 AI…' : '确认发送并生成候选因子'}</button><button className="button" disabled={!!busy} onClick={() => setPreview(null)}>返回修改</button></div></div></Panel>}
                {generation && <Panel title="2 · 候选计划与 AST 确认" description={`${providerName(generation.provider)} · ${generation.model} · ${dateTime(generation.created_at)}`} actions={<Tag tone={generation.status === 'failed' ? 'red' : generation.status === 'saved' ? 'green' : 'purple'}>{labels[generation.status] || generation.status}</Tag>}><div className="padded ai-stack">
                    {generation.status === 'generating' && <div className="notice purple"><Sparkles size={17}/><span>服务请求正在进行；返回后由本地编译器生成并检查 AST。此阶段没有运行回测。</span></div>}
                    {generation.error && <ErrorBox message={generation.error}/>}{generation.status === 'saved' && <p className="muted">这里保留 AI 候选原稿；最终保存的 AST 以关联因子为准，人工修改会记录在因子来源中。</p>}
                    {generation.proposal && <><p>{generation.proposal.explanation}</p>{generation.proposal.limitations && <div className="notice amber"><ShieldCheck size={17}/><span>{Array.isArray(generation.proposal.limitations) ? generation.proposal.limitations.join('；') : generation.proposal.limitations}</span></div>}<h3>算子映射与组合计划</h3><DataTable rows={(generation.proposal.plan?.steps || []).map((step: RecordData) => ({ 步骤: step.id, 算子: step.operator_id, 输入: (step.inputs || []).map((input: RecordData) => `${input.field} ← ${input.value}`).join('、'), 参数: (step.parameters || []).map((parameter: RecordData) => `${parameter.name}=${parameter.value}`).join('；'), 组合理由: step.reason }))}/><p className="muted">输出节点：{generation.proposal.plan?.output || '—'}。映射引用版本见下方冻结记录。</p>
                        <div className="form-grid"><Field label="候选因子名称"><input value={name} disabled={!!busy || generation.status === 'saved'} onChange={event => setName(event.target.value)}/></Field><Field label="研究假设与说明"><input value={description} disabled={!!busy || generation.status === 'saved'} onChange={event => setDescription(event.target.value)}/></Field></div>
                        <Field label="AST 的可读代码" hint="保存主体为本地验证的 AST；代码是可读视图。手动修改后须重新校验，并记录为人工编辑。"><textarea className="code-editor" rows={10} value={code} disabled={!!busy || generation.status === 'saved'} spellCheck={false} onChange={event => { setCode(event.target.value); setCheckedCode(''); setValidation(null); }}/></Field>
                        {currentValidation ? <div className="ai-stack"><div className="actions"><Tag tone={validAST ? 'green' : 'red'}>{validAST ? '本地 AST 校验通过' : 'AST 校验未通过'}</Tag><Tag tone={currentValidation.fields_ready ? 'green' : 'amber'}>{currentValidation.fields_ready ? '字段已接入' : '字段尚不可用'}</Tag></div>{currentValidation.errors?.length > 0 && <ErrorBox message={currentValidation.errors.join('；')}/>}{currentValidation.missing_fields?.length > 0 && <ErrorBox message={'缺少已验证字段：' + currentValidation.missing_fields.join('、') + '；当前候选不能保存为可运行因子，请修改输入或字段后重新校验。'}/>}<p className="muted">依赖字段：{(currentValidation.dependencies || []).join('、') || '—'} · 预热观测：{currentValidation.warmup_days ?? '—'}</p><details className="raw-detail"><summary>查看本地编译的 AST</summary><JsonView value={currentValidation.ast}/></details></div> : <div className="notice amber compact"><Code2 size={16}/><span>当前代码未验证；旧的 AST 通过状态不适用于此版本。</span></div>}
                        {generation.status === 'saved' && generation.factor_id ? <div className="actions"><Tag tone="green">AST 因子已保存</Tag><button className="button" onClick={() => go('/factors/' + generation.factor_id)}>查看因子</button><button className="button primary" onClick={() => go('/research?factor=' + encodeURIComponent(generation.factor_id))}><FlaskConical size={15}/> 配置真实评测</button></div> : <div className="actions"><button className="button" disabled={!!busy || !code.trim()} onClick={validateCode}><Check size={15}/>{busy === 'validate' ? '校验中…' : '重新校验当前 AST'}</button><button className="button primary" disabled={!!busy || !validAST || !currentValidation?.fields_ready || !name.trim()} onClick={saveFactor}><Save size={15}/>{busy === 'save' ? '保存中…' : '确认保存 AST 因子，进入评测'}</button></div>}
                    </>}
                    {generation.returned_plan && <details className="raw-detail"><summary>模型返回的组合计划</summary><JsonView value={generation.returned_plan}/></details>}{generation.request_payload && <details className="raw-detail ai-payload"><summary>本次已确认的外发内容</summary><JsonView value={generation.request_payload}/></details>}<p className="ai-caption">AI 生成的是候选定义，不是收益或有效性结论。保存后在现有研究页核对真实数据、股票池和基准，再提交回测。</p><details className="raw-detail"><summary>本次服务调用与冻结算子记录</summary><JsonView value={{ id: generation.id, provider: generation.provider, model: generation.model, status: generation.status, request_id: generation.request_id, usage: generation.usage, operator_refs: generation.proposal?.operator_refs || generation.request_payload?.operator_refs || generation.operator_refs, created_at: generation.created_at }}/></details>
                </div></Panel>}
            </>}
        </>}
    </div>;
}
