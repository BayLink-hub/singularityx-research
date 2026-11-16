import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ClipboardCheck, Download, ExternalLink, Pencil, Play, Plus, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { api, downloadFile, errorMessage, go, type RecordData, type Run, useApi, useRoute } from './api';
import { DataTable, Empty, ErrorBox, Field, JsonView, Loading, MetricGrid, PageHead, Pagination, Panel, RunTable, SearchInput, Status, Tabs, Tag, TimeChart, fmt, dateTime } from './components';
import { ALPHA101_CODE, calculateFundamental, DRAFT_KEY, eventWindow, ipoQuota, parseMarketValues, operatorCode, SOURCES, VERIFIED_AT, type MarketName, type PublicMarket } from './researchTools';

import { AIWorkbench } from './AIWorkbench';
import type { OperatorDefinition, OperatorInput, OperatorParameter } from './operatorCatalog';

type Props = { notify: (message: string) => void };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 16 };
const spacing = { display: 'grid', gap: 16 };
const pct = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(3) + '%';
function SourceLink({ url, children }: { url: string; children: React.ReactNode }) { return <a className="text-button" href={url} target="_blank" rel="noreferrer">{children}<ExternalLink size={13}/></a>; }
let marketRequest: Promise<PublicMarket> | null = null;
function usePublicMarket() {
  const [data, setData] = useState<PublicMarket | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const base = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
    marketRequest ??= fetch(base + 'research/public-market.json').then(async r => { if (!r.ok) throw new Error('公开行情文件暂不可用；没有生成替代数据。'); const d = await r.json(); if (!Array.isArray(d.bars) || !Array.isArray(d.benchmark)) throw new Error('公开行情结构不完整。'); return d as PublicMarket; }).catch(e => { marketRequest = null; throw e; });
    marketRequest.then(d => { if (active) setData(d); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);
  return { data, error, loading: !data && !error };
}
function downloadJSON(name: string, value: unknown) { downloadFile(name, JSON.stringify(value, null, 2), 'application/json;charset=utf-8'); }

export function OperatorLibrary({ notify }: Props) {
  const query = useApi<OperatorDefinition[]>('/operator-definitions');
  const [category, setCategory] = useState('全部'), [search, setSearch] = useState(''), [deleted, setDeleted] = useState(false), [page, setPage] = useState(1), [selectedId, setSelectedId] = useState('safe_div');
  const [draft, setDraft] = useState<OperatorDefinition | null>(null), [editingId, setEditingId] = useState<string | null>(null), [mode, setMode] = useState('code');
  const [parameters, setParameters] = useState<Record<string, string>>({}), [values, setValues] = useState<Record<string, string>>({}), [announced, setAnnounced] = useState(''), [asOf, setAsOf] = useState('');
  const [result, setResult] = useState<RecordData | null>(null), [validation, setValidation] = useState<RecordData | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const definitions = query.data || [], categories = Array.from(new Set(definitions.map(op => op.category)));
  const rows = definitions.filter(op => !!op.deleted === deleted && (category === '全部' || op.category === category) && `${op.name} ${op.id} ${op.formula} ${op.fields}`.toLowerCase().includes(search.toLowerCase()));
  const selected = rows.find(op => op.id === selectedId) || rows[0];
  const safePage = Math.min(page, Math.max(1, Math.ceil(rows.length / 12)));
  useEffect(() => setPage(1), [category, search, deleted]);
  useEffect(() => { setValues({}); setParameters({}); setResult(null); setValidation(null); }, [selected?.id, selected?.version]);
  let previewCode = selected?.code || '';
  if (selected?.code) { try { previewCode = operatorCode(selected, parameters); } catch (e) { previewCode = '# 参数尚未通过校验：' + errorMessage(e); } }
  function select(op: OperatorDefinition) { setSelectedId(op.id); setValues({}); setParameters({}); setResult(null); setValidation(null); setError(''); }
  function edit(op?: OperatorDefinition) {
    setEditingId(op?.id || null); setMode(op?.manual ? 'manual' : 'code'); setError(''); setValidation(null);
    setDraft(op ? JSON.parse(JSON.stringify(op)) : { id: '', name: '', category: '自定义', formula: '', description: '', fields: 'close', window: 'n 个交易日', timing: '当日收盘后可得，最早次日交易。', source: '', sourceLabel: '自定义研究定义', code: 'n = 20\nfactor = safe_div(close, ts_mean(close, n))', parameters: [{ name: 'n', default: 20, min: 1, max: 252, description: '历史窗口' }], custom: true });
  }
  function update(key: keyof OperatorDefinition, value: unknown) { setDraft(current => current ? { ...current, [key]: value } : current); setValidation(null); }
  function changeMode(value: string) { setMode(value); if (!draft) return; setDraft(value === 'manual' ? { ...draft, code: undefined, parameters: [], manual: draft.manual || { expression: 'safe_div(x, y)', inputs: [{ key: 'x', label: '真实输入x' }, { key: 'y', label: '真实输入y' }] }, timing: '所有输入须在分析日期前已公告；这里只计算手填值，不是财务历史回测。' } : { ...draft, manual: undefined, code: draft.code || 'factor = safe_div(close, open)', parameters: draft.parameters || [], timing: '当日收盘后完整可得，最早次日交易。' }); setValidation(null); }
  async function validateDefinition(op: OperatorDefinition) {
    if (op.manual) {
      if (!op.manual.inputs.length || op.manual.inputs.length > 20 || new Set(op.manual.inputs.map(x => x.key)).size !== op.manual.inputs.length) throw new Error('手填输入须为1至20个不重复名称。');
      for (const x of op.manual.inputs) if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(x.key) || !x.label.trim() || x.min != null && !Number.isFinite(x.min) || x.max != null && !Number.isFinite(x.max) || x.min != null && x.max != null && x.min > x.max) throw new Error('请检查输入标识符、标签和数值范围。');
      const { evaluateScalar } = await import('./browserEngine');
      evaluateScalar(op.manual.expression, Object.fromEntries(op.manual.inputs.map(x => [x.key, 1])));
      return { valid: true, dependencies: op.manual.inputs.map(x => x.key), mode: '标量白名单' };
    }
    const checked = await api('/factors/validate', 'POST', { code: operatorCode(op) });
    if (!checked.valid) throw new Error((checked.errors || ['AST模板校验未通过']).join('；'));
    return checked;
  }
  async function save() {
    if (!draft) return; setBusy('save'); setError('');
    try {
      if (![draft.name, draft.category, draft.formula, draft.timing, draft.sourceLabel].every(x => x.trim())) throw new Error('名称、分类、公式、可得时点和来源说明不能为空。');
      if (draft.source && !/^https?:\/\//i.test(draft.source)) throw new Error('来源链接应为公开HTTP(S)地址，或留空并说明来源。');
      const checked = await validateDefinition(draft); setValidation(checked);
      const { id: _id, version: _version, custom: _custom, deleted: _deleted, ...payload } = draft;
      const saved = await api<OperatorDefinition>(editingId ? '/operator-definitions/' + encodeURIComponent(editingId) : '/operator-definitions', editingId ? 'PUT' : 'POST', { ...payload, base_version: draft.version });
      setDraft(null); setSelectedId(saved.id); setDeleted(false); setCategory('全部'); setSearch(saved.name); query.refresh(); notify('算子目录已保存为 v' + saved.version + '。');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  async function toggleDeleted(op: OperatorDefinition) {
    setBusy('delete'); setError('');
    try { await api('/operator-definitions/' + encodeURIComponent(op.id), op.deleted ? 'PUT' : 'DELETE', { base_version: op.version, ...(op.deleted ? { deleted: false } : {}) }); query.refresh(); setResult(null); notify(op.deleted ? '算子条目已恢复。' : '算子条目已移入回收站，已保存任务的定义保持不变。'); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  async function useTemplate(create: boolean) {
    if (!selected) return; setBusy(create ? 'factor' : 'template'); setError('');
    try {
      const code = operatorCode(selected, parameters), checked = await api('/factors/validate', 'POST', { code }); setValidation(checked);
      if (!checked.valid) throw new Error((checked.errors || ['AST模板无法执行']).join('；'));
      if (create) {
        const factor = await api('/factors', 'POST', { name: selected.name + ' · 因子模板', category: '算子模板', description: `${selected.description}\n目录定义：${selected.id} v${selected.version}\n来源：${selected.sourceLabel} ${selected.source}\n时间口径：${selected.timing}`, code });
        notify('已从当前算子版本创建可编辑因子。'); go('/factors/' + factor.id);
      } else {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ sourceTitle: selected.sourceLabel, sourceUrl: selected.source, name: selected.name, definition: `${selected.formula}\n${selected.timing}\n目录：${selected.id} v${selected.version}`, code, sourceRegistered: false, confirmed: false, handoff: 'operator_template', operator_ids: [selected.id], operator_refs: [{ id: selected.id, version: selected.version }] }));
        go('/replication?new=1&template=1'); notify('算子和研究说明已带入；请先预览外发内容。');
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  function compute() { if (!selected) return; try { setResult(calculateFundamental(selected, values, announced, asOf)); setError(''); } catch (e) { setResult(null); setError(errorMessage(e)); } }
  const patchParameter = (index: number, patch: Partial<OperatorParameter>) => update('parameters', draft?.parameters?.map((p, i) => i === index ? { ...p, ...patch } : p));
  const patchInput = (index: number, patch: Partial<OperatorInput>) => update('manual', draft?.manual ? { ...draft.manual, inputs: draft.manual.inputs.map((input, i) => i === index ? { ...input, ...patch } : input) } : undefined);
  return <><PageHead title="人工算子" description="管理版本化公式目录；日频模板经 AST 校验，基本面与交叉公式只计算实际输入。" actions={<><button className="button" onClick={query.refresh}><RefreshCw size={15}/> 刷新</button><button className="button primary" onClick={() => edit()}><Plus size={15}/> 新增算子</button></>}/>
    {(error || query.error) && <ErrorBox message={error || query.error} retry={query.error ? query.refresh : undefined}/>}
    <div className="notice compact purple"><ShieldCheck size={17}/><span>目录条目可编辑、删除和恢复；删除不会卸载运行时基础函数，也不会改变已经冻结的因子与任务。自定义条目作为公式模板复用，不执行任意 Python / JavaScript。</span></div>
    {draft ? <Panel title={editingId ? `编辑算子 · v${draft.version}` : '新增算子条目'} actions={<button className="text-button" onClick={() => setDraft(null)}>返回目录</button>}><div className="padded operator-editor">
      <div className="form-grid"><Field label="算子名称"><input value={draft.name} onChange={e => update('name', e.target.value)}/></Field><Field label="分类"><input aria-label="分类" list="operator-categories" value={draft.category} onChange={e => update('category', e.target.value)}/><datalist id="operator-categories">{categories.map(c => <option key={c} value={c}/>)}</datalist></Field><Field label="执行类型"><select value={mode} onChange={e => changeMode(e.target.value)}><option value="code">日频 AST 公式模板</option><option value="manual">真实手填标量公式</option></select></Field><Field label="历史窗口 / 报告期"><input value={draft.window} onChange={e => update('window', e.target.value)}/></Field></div>
      <Field label="公式与定义域"><input value={draft.formula} onChange={e => update('formula', e.target.value)} placeholder="写明分母保护、负数域、排名或回归方向"/></Field><Field label="研究含义与实现约定"><textarea rows={3} value={draft.description} onChange={e => update('description', e.target.value)}/></Field><Field label="字段与量纲"><input value={draft.fields} onChange={e => update('fields', e.target.value)}/></Field><Field label="可得时点与数据边界"><textarea rows={2} value={draft.timing} onChange={e => update('timing', e.target.value)}/></Field>
      <div className="form-grid"><Field label="来源说明"><input value={draft.sourceLabel} onChange={e => update('sourceLabel', e.target.value)}/></Field><Field label="公开来源 URL（可留空）"><input type="url" value={draft.source} onChange={e => update('source', e.target.value)}/></Field></div>
      {mode === 'code' ? <><Field label="白名单 AST 模板"><textarea className="code-editor" rows={6} value={draft.code || ''} onChange={e => update('code', e.target.value)} spellCheck={false}/></Field><div className="operator-section-head"><h3>可调整数值参数</h3><button className="text-button" onClick={() => update('parameters', [...draft.parameters || [], { name: 'n' + ((draft.parameters?.length || 0) + 1), default: 20, min: 1, max: 252, description: '' }])}><Plus size={14}/> 添加参数</button></div><p className="muted">每个参数必须对应模板中独立的数值赋值行，例如 n = 20。参数名称不能充当可执行函数。</p>{(draft.parameters || []).map((parameter, index) => <div className="operator-param-row" key={index}><Field label="参数名"><input value={parameter.name} onChange={e => patchParameter(index, { name: e.target.value })}/></Field><Field label="默认值"><input type="number" value={parameter.default} onChange={e => patchParameter(index, { default: Number(e.target.value) })}/></Field><Field label="最小值"><input type="number" value={parameter.min ?? ''} onChange={e => patchParameter(index, { min: e.target.value === '' ? undefined : Number(e.target.value) })}/></Field><Field label="最大值"><input type="number" value={parameter.max ?? ''} onChange={e => patchParameter(index, { max: e.target.value === '' ? undefined : Number(e.target.value) })}/></Field><Field label="参数含义"><input value={parameter.description} onChange={e => patchParameter(index, { description: e.target.value })}/></Field><button className="icon-button" aria-label={'删除参数 ' + parameter.name} onClick={() => update('parameters', draft.parameters?.filter((_, i) => i !== index))}><Trash2 size={16}/></button></div>)}</> : <><Field label="实际执行的标量表达式"><textarea className="code-editor" rows={3} value={draft.manual?.expression || ''} onChange={e => update('manual', { ...draft.manual, expression: e.target.value })} placeholder="safe_div(cashflow, profit)"/></Field><div className="operator-section-head"><h3>真实输入的名称与范围</h3><button className="text-button" disabled={(draft.manual?.inputs.length || 0) >= 20} onClick={() => update('manual', { ...draft.manual, inputs: [...draft.manual?.inputs || [], { key: 'x' + ((draft.manual?.inputs.length || 0) + 1), label: '' }] })}><Plus size={14}/> 添加输入</button></div>{(draft.manual?.inputs || []).map((input, index) => <div className="operator-param-row" key={index}><Field label="输入名"><input value={input.key} onChange={e => patchInput(index, { key: e.target.value })}/></Field><Field label="输入标签"><input value={input.label} onChange={e => patchInput(index, { label: e.target.value })}/></Field><Field label="最小值"><input type="number" value={input.min ?? ''} onChange={e => patchInput(index, { min: e.target.value === '' ? undefined : Number(e.target.value) })}/></Field><Field label="最大值"><input type="number" value={input.max ?? ''} onChange={e => patchInput(index, { max: e.target.value === '' ? undefined : Number(e.target.value) })}/></Field><label className="check-label"><input type="checkbox" checked={!!input.positive} onChange={e => patchInput(index, { positive: e.target.checked })}/> 严格大于0</label><button className="icon-button" aria-label={'删除输入 ' + input.key} onClick={() => update('manual', { ...draft.manual, inputs: draft.manual?.inputs.filter((_, i) => i !== index) })}><Trash2 size={16}/></button></div>)}</>}
      <div className="actions"><button className="button" disabled={!!busy} onClick={async () => { if (!draft) return; setBusy('validate'); setError(''); try { setValidation(await validateDefinition(draft)); notify('定义通过白名单校验。'); } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); } }}>校验定义</button><button className="button primary" disabled={!!busy} onClick={save}><Save size={15}/>{busy === 'save' ? '保存中…' : editingId ? '保存新版本' : '保存算子'}</button></div>{validation && <Tag tone={validation.valid ? 'green' : 'red'}>{validation.valid ? '定义校验通过' : '校验未通过'}</Tag>}
    </div></Panel> : <>
      <div className="operator-categories">{['全部', ...categories].map(c => <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}<span>{definitions.filter(op => !op.deleted && (c === '全部' || op.category === c)).length}</span></button>)}</div>
      <Panel><div className="filter-bar"><SearchInput value={search} onChange={setSearch} placeholder="搜索算子名称、公式、字段"/><select aria-label="目录状态" value={deleted ? 'deleted' : 'active'} onChange={e => setDeleted(e.target.value === 'deleted')}><option value="active">使用中的条目</option><option value="deleted">回收站</option></select><Tag>{rows.length} 个条目</Tag></div>{query.loading ? <Loading/> : rows.length ? <div className="table-scroll"><table className="operator-table"><thead><tr><th>算子 / 公式模板</th><th>公式与定义域</th><th>字段与窗口</th><th>执行方式</th><th>操作</th></tr></thead><tbody>{rows.slice((safePage - 1) * 12, safePage * 12).map(op => <tr key={op.id} className={selected?.id === op.id ? 'operator-selected' : ''}><td><button className="name-link" onClick={() => select(op)}>{op.name}</button><small className="cell-sub">{op.id} · v{op.version ?? 1}</small></td><td><code className="operator-formula">{op.formula}</code></td><td><span className="operator-fields" title={op.fields}>{op.fields}</span><small className="cell-sub">{op.window}</small></td><td><Tag tone={op.manual ? 'amber' : 'purple'}>{op.manual ? '手填公式计算' : 'AST 模板'}</Tag><small className="cell-sub">{op.custom ? '自定义条目' : '预置目录'}</small></td><td><div className="table-actions"><button aria-label={'查看算子 ' + op.name} title="查看定义" onClick={() => select(op)}><Search size={15}/></button>{!op.deleted && <button aria-label={'编辑算子 ' + op.name} title="编辑目录新版本" onClick={() => edit(op)}><Pencil size={15}/></button>}<button aria-label={(op.deleted ? '恢复算子 ' : '删除算子 ') + op.name} title={op.deleted ? '恢复条目' : '移入回收站'} disabled={!!busy} onClick={() => toggleDeleted(op)}>{op.deleted ? <RotateCcw size={15}/> : <Trash2 size={15}/>}</button></div></td></tr>)}</tbody></table></div> : <Empty title={deleted ? '回收站为空' : '没有符合条件的算子'} description="调整分类或搜索条件，也可以新增自己的公式模板。"/>}<Pagination total={rows.length} page={safePage} size={12} onChange={setPage}/></Panel>
      {selected && <Panel className="operator-detail-panel" title={selected.name} description={`${selected.category} · 目录 v${selected.version ?? 1}`} actions={selected.source ? <SourceLink url={selected.source}>{selected.sourceLabel}</SourceLink> : <Tag>{selected.sourceLabel}</Tag>}><div className="padded operator-detail">
        {selected.deleted && <div className="notice amber compact"><ShieldCheck size={16}/><span>此目录条目已删除。恢复后可继续使用；旧因子和旧任务保留各自冻结代码。</span><button className="text-button" disabled={!!busy} onClick={() => toggleDeleted(selected)}>恢复条目</button></div>}
        <div className="operator-definition-grid"><div><span className="small-label">公式与定义域</span><pre className="code-block">{selected.formula}</pre><p>{selected.description}</p></div><div><span className="small-label">数据与可得时点</span><p>{selected.fields}</p><p className="muted">{selected.timing}</p></div></div>
        {selected.code && <><div className="form-grid three">{(selected.parameters || []).map(parameter => <Field key={parameter.name} label={parameter.name + ' · ' + parameter.description} hint={`默认 ${parameter.default}${parameter.min != null ? '；最小 ' + parameter.min : ''}${parameter.max != null ? '；最大 ' + parameter.max : ''}`}><input type="number" min={parameter.min} max={parameter.max} value={parameters[parameter.name] ?? parameter.default} onChange={e => { setParameters({ ...parameters, [parameter.name]: e.target.value }); setValidation(null); }}/></Field>)}</div><Field label="当前版本 AST 模板"><textarea className="code-editor" rows={4} readOnly value={previewCode}/></Field><p className="muted">复用时将上方参数展开成显式赋值，并再次调用运行环境的 AST 校验；不会新增同名运行时函数。</p><div className="actions"><button className="button" disabled={!!busy || !!selected.deleted} onClick={() => useTemplate(false)}>进入复现流程 <ArrowRight size={15}/></button><button className="button primary" disabled={!!busy || !!selected.deleted} onClick={() => useTemplate(true)}><Plus size={15}/> 用此模板创建因子</button></div></>}
        {selected.manual && <><div className="notice amber compact"><ShieldCheck size={17}/><span>财务 PIT 历史面板未接入此计算器。输入须为真实已知值且绝对值不超过10亿；金额统一币种和单位，较大金额可统一用万元。结果只是单次公式值，不是历史因子或回测业绩。</span></div><Field label="实际执行表达式"><input readOnly value={selected.manual.expression}/></Field><div className="form-grid three">{selected.manual.inputs.map(input => <Field key={input.key} label={input.label} hint={input.positive ? '须严格大于0' : input.min != null || input.max != null ? `范围：${input.min ?? '不限'} — ${input.max ?? '不限'}` : undefined}><input type="number" step="any" min={input.min} max={input.max} value={values[input.key] || ''} onChange={e => { setValues({ ...values, [input.key]: e.target.value }); setResult(null); }}/></Field>)}</div><div className="form-grid"><Field label="最新相关财务数据的实际公告日"><input type="date" value={announced} onChange={e => { setAnnounced(e.target.value); setResult(null); }}/></Field><Field label="分析日期（晚于公告日）"><input type="date" value={asOf} onChange={e => { setAsOf(e.target.value); setResult(null); }}/></Field></div><div className="actions"><button className="button primary" disabled={!!selected.deleted} onClick={compute}>计算输入数值</button>{result && <button className="button" onClick={() => downloadJSON(selected.id + '-calculation.json', result)}><Download size={15}/> 导出计算</button>}</div>{result && <div className="notice"><div><strong>公式值：{fmt(result.value)}</strong><p>仅根据本次真实手填输入计算；分析时点 {result.as_of}，目录 v{result.operator_version ?? 1}。</p></div></div>}</>}
      </div></Panel>}
    </>}
  </>;
}

export function IpoCalculator({ notify }: Props) {
  const [tDate, setTDate] = useState(''), [cutoff, setCutoff] = useState(''), [verified, setVerified] = useState(false);
  const [inputs, setInputs] = useState({ SH: { text: '', cap: '', initial: '', url: '' }, SZ: { text: '', cap: '', initial: '', url: '' } });
  const [results, setResults] = useState<Record<string, ReturnType<typeof ipoQuota>>>({}), [error, setError] = useState('');
  const edit = (m: MarketName, key: keyof typeof inputs.SH, value: string) => { setInputs({ ...inputs, [m]: { ...inputs[m], [key]: value } }); setResults({}); };
  function calculate() {
    try {
      if (!tDate || !cutoff || cutoff >= tDate) throw new Error('请填写发行公告中的申购日T和早于T的市值截止日T−2。');
      if (!verified) throw new Error('请先核对20个交易日窗口；本工具不会把自然日误当交易日。');
      const next: Record<string, ReturnType<typeof ipoQuota>> = {};
      for (const m of ['SH', 'SZ'] as const) {
        const entry = inputs[m]; if (!entry.text.trim()) continue;
        if (entry.cap.trim() && !/^https?:\/\//i.test(entry.url)) throw new Error(`${m === 'SH' ? '沪市' : '深市'}填写公告上限后，请同时登记可核查的公告URL。`);
        next[m] = ipoQuota(parseMarketValues(entry.text), m, entry.cap.trim() ? Number(entry.cap) : null, entry.initial.trim() ? Number(entry.initial) : null);
      }
      if (!Object.keys(next).length) throw new Error('请至少填写一个市场的20个真实日终市值。');
      setResults(next); setError(''); notify('已按你输入的实际市值计算，未读取或假定任何持仓。');
    } catch (e) { setError(errorMessage(e)); setResults({}); }
  }
  return <><PageHead title="打新市值计算器" description="沪深分别计算；1万元日均市值门槛，每5000元对应500股。以官方规则和该只新股发行公告为准。" actions={<Tag>规则核实 {VERIFIED_AT}</Tag>}/>
    <Panel title="申购时间与计算窗口"><div className="padded" style={spacing}><div style={grid}><Field label="申购日 T（发行公告）"><input type="date" value={tDate} onChange={e => { setTDate(e.target.value); setResults({}); }}/></Field><Field label="市值截止日 T−2（交易日）" hint="按券商/发行公告确认，不按自然日减2。"><input type="date" value={cutoff} onChange={e => { setCutoff(e.target.value); setResults({}); }}/></Field></div><label className="check-label"><input type="checkbox" checked={verified} onChange={e => { setVerified(e.target.checked); setResults({}); }}/> 已核对输入对应含 T−2 在内的20个交易日；无持仓日填0，开户不足20日仍除以20。</label></div></Panel>
    <div style={grid}>{(['SH', 'SZ'] as const).map(m => <Panel key={m} title={m === 'SH' ? '上海市场' : '深圳市场'} actions={<SourceLink url={m === 'SH' ? SOURCES.sse : SOURCES.szse}>官方规则</SourceLink>}><div className="padded" style={spacing}>
      <Field label="20个日终合格证券市值（元）" hint="每行一个，或以空格/逗号分隔。仅本市场非限售A股及非限售存托凭证；同一投资者合并相关账户。"><textarea rows={7} value={inputs[m].text} onChange={e => edit(m, 'text', e.target.value)} placeholder="粘贴20个真实日终市值，不填写示例持仓"/></Field>
      <Field label="该新股发行公告申购上限（股，可留空）" hint="未填时只展示市值额度，不声称最终可申购数量。"><input type="number" min={0} step={500} value={inputs[m].cap} onChange={e => edit(m, 'cap', e.target.value)}/></Field>
      <Field label="网上初始发行股数（可选，用于千分之一核验）"><input type="number" min={1} step={1} value={inputs[m].initial} onChange={e => edit(m, 'initial', e.target.value)}/></Field>
      <Field label="发行公告来源 URL"><input type="url" value={inputs[m].url} onChange={e => edit(m, 'url', e.target.value)} placeholder="https://…"/></Field>
    </div></Panel>)}</div>
    <div className="submit-bar"><span className="muted">适用于普通A股网上申购；存托凭证发行单位、板块权限及账户适当性须另行核对。</span><div className="actions"><button className="button primary" onClick={calculate}>计算市值额度</button>{Object.keys(results).length > 0 && <button className="button" onClick={() => downloadJSON('ipo-market-value.json', { tDate, cutoff, inputs, results, sources: { SH: SOURCES.sse, SZ: SOURCES.szse }, verified_at: VERIFIED_AT, qualification: '仅市值条件，不保证板块/账户资格或中签' })}><Download size={15}/> 导出</button>}</div></div>
    {error && <ErrorBox message={error}/>}<Panel title="计算结果"><div className="table-scroll"><table><thead><tr><th>市场</th><th>20日平均市值</th><th>市值门槛</th><th>按市值额度</th><th>公告上限</th><th>千分之一限制</th><th>本次计算上限</th></tr></thead><tbody>{Object.entries(results).map(([m, r]) => <tr key={m}><td>{m === 'SH' ? '沪市' : '深市'}</td><td>¥{fmt(r.average)}</td><td><Tag tone={r.qualifiedByValue ? 'green' : 'neutral'}>{r.qualifiedByValue ? '达到市值门槛' : '不足1万元'}</Tag></td><td>{fmt(r.marketQuota)} 股</td><td>{r.announcedCap == null ? '未填写' : fmt(r.announcedCap) + ' 股'}</td><td>{r.issuanceCap == null ? '未填写发行数量' : fmt(r.issuanceCap) + ' 股'}</td><td>{r.finalQuota == null ? '待核对发行公告' : fmt(r.finalQuota) + ' 股'}</td></tr>)}</tbody></table></div>{!Object.keys(results).length && <Empty title="等待真实市值输入" description="没有默认持仓，没有预设申购额度。"/>}</Panel>
    <Panel title="规则与口径"><div className="padded"><p>沪深市值不相互借用。日均市值 = 20个交易日市值合计 ÷ 20；达到1万元后，市值额度 = ⌊日均市值 ÷ 5000⌋ × 500股。最终数量还受该只新股公告上限、网上初始发行千分之一及交易所系统上限约束。</p><p>上海按2025年3月修订细则采用500股单位；深圳官方入市手册亦为500股。计算结果只说明市值条件，不确认科创板/创业板权限、账户适当性、违规申购限制或中签概率。券商查询结果和发行公告须在申购时核对。</p><div className="actions"><SourceLink url={SOURCES.sse}>上交所现行细则 · 第3、4、10条</SourceLink><SourceLink url={SOURCES.szse}>深交所主板网上申购手册</SourceLink></div></div></Panel>
  </>;
}

export function EventResearch({ notify }: Props) {
  const [eventView, setEventView] = useState('catalog');
  const market = usePublicMarket(); const [symbol, setSymbol] = useState(''), [event, setEvent] = useState('2024-09-24'), [preset, setPreset] = useState('policy');
  const [name, setName] = useState('金融支持经济高质量发展新闻发布会'), [source, setSource] = useState(SOURCES.policy), [windowSize, setWindowSize] = useState(20);
  const [result, setResult] = useState<ReturnType<typeof eventWindow> | null>(null), [error, setError] = useState('');
  useEffect(() => { if (market.data && !symbol) setSymbol(market.data.universe[0]?.symbol || ''); }, [market.data, symbol]);
  const invalidate = () => setResult(null);
  function calculate() { try { if (!market.data) throw new Error('实际行情尚未加载。'); setResult(eventWindow(market.data, symbol, event, windowSize, windowSize)); setError(''); notify('已从公开历史报价计算事件窗口。'); } catch (e) { setError(errorMessage(e)); setResult(null); } }
  const final = result?.rows[result.rows.length - 1];
  function beginEvent(custom = false) { setEventView('study'); setPreset(custom ? 'custom' : 'policy'); setEvent(custom ? '' : '2024-09-24'); setName(custom ? '' : '金融支持经济高质量发展新闻发布会'); setSource(custom ? '' : SOURCES.policy); setResult(null); setError(''); }
  return <><PageHead title="事件驱动研究" description="登记可核查事件，从真实报价观察事件窗口。" actions={<><Tag>描述性事件研究</Tag>{eventView === 'study' && <button className="button" onClick={() => setEventView('catalog')}>返回事件库</button>}<button className="button primary" onClick={() => beginEvent(true)}>自定义事件研究</button></>}/>{market.error && <ErrorBox message={market.error}/>}
    {eventView === 'catalog' ? <Panel title="事件库" description="只登记可核查的真实事件；观察结果须选取证券后实际计算。" actions={<Tag>1个已登记事件</Tag>}><div className="padded" style={grid}>
      <article style={{ border: '1px solid #e1e4eb', borderRadius: 5, padding: 20, display: 'grid', gap: 14 }}><div className="actions" style={{ justifyContent: 'space-between' }}><Tag tone="purple">宏观政策</Tag><span className="muted">2024-09-24 · 上午</span></div><h3 style={{ margin: 0, fontSize: 18 }}>金融支持经济高质量发展新闻发布会</h3><p style={{ margin: 0 }}>人民银行、金融监管总局、证监会介绍金融支持政策。时间与内容可核查证监会官方实录。</p><p className="muted" style={{ margin: 0 }}>观察窗口 [−20, +20] · {market.data ? market.data.universe.length + '只固定公开股票样本可选' : '等待实际行情覆盖'} · 不预设政策效果</p><div className="actions" style={{ justifyContent: 'space-between' }}><SourceLink url={SOURCES.policy}>官方发布会实录</SourceLink><button className="button primary" onClick={() => beginEvent(false)}>开始研究 <ArrowRight size={15}/></button></div></article>
      <article style={{ border: '1px dashed #d7dbe5', borderRadius: 5, padding: 20, display: 'grid', gap: 14, alignContent: 'center' }}><h3 style={{ margin: 0, fontSize: 18 }}>登记自己的研究事件</h3><p className="muted">输入真实事件日期、来源与名称，选择已有行情中的证券。数据缺失保持空缺，不生成示例收益。</p><button className="button" style={{ justifySelf: 'start' }} onClick={() => beginEvent(true)}>自定义事件研究 <ArrowRight size={15}/></button></article>
    </div></Panel> : <>
    <Panel title="事件与样本"><div className="padded" style={spacing}><div style={grid}><Field label="事件来源"><select value={preset} onChange={e => { setPreset(e.target.value); invalidate(); if (e.target.value === 'policy') { setEvent('2024-09-24'); setName('金融支持经济高质量发展新闻发布会'); setSource(SOURCES.policy); } else { setName(''); setSource(''); } }}><option value="policy">2024-09-24 · 金融政策发布会</option><option value="custom">自定义事件日期与来源</option></select></Field><Field label="观察证券"><select value={symbol} onChange={e => { setSymbol(e.target.value); invalidate(); }}>{market.data?.universe.map(s => <option key={s.symbol} value={s.symbol}>{s.symbol} · {s.name}</option>)}</select></Field><Field label="事件日"><input type="date" value={event} onChange={e => { setEvent(e.target.value); setPreset('custom'); setName(''); setSource(''); invalidate(); }}/></Field><Field label="前后观察窗口"><select value={windowSize} onChange={e => { setWindowSize(Number(e.target.value)); invalidate(); }}><option value={5}>[-5, +5]</option><option value={10}>[-10, +10]</option><option value={20}>[-20, +20]</option></select></Field><Field label="事件名称"><input value={name} onChange={e => setName(e.target.value)} placeholder="填写真实事件名称"/></Field><Field label="事件公开来源"><input type="url" value={source} onChange={e => setSource(e.target.value)} placeholder="官方公告或可核查来源URL"/></Field></div>
      {preset === 'policy' && <p className="muted">证监会官网记录该发布会于2024年9月24日上午举行。这里统计价格变化，不把同时发生的市场变化归因于单一政策。 <SourceLink url={SOURCES.policy}>查看发布会原文</SourceLink></p>}
      <div className="actions"><button className="button primary" disabled={market.loading || !symbol} onClick={calculate}><Play size={15}/> 计算事件窗口</button>{result && <button className="button" onClick={() => downloadJSON('event-study-' + result.symbol + '.json', { event: { name, source, requested_date: event }, result, data_source: market.data?.source })}><Download size={15}/> 导出实际序列</button>}</div></div></Panel>
    {error && <ErrorBox message={error}/>} {market.loading && <Loading/>}
    {market.data && <div className="scope-strip"><span>{market.data.source.provider}</span><span>{market.data.coverage.start} — {market.data.coverage.end}</span><span>{market.data.universe.length}只固定样本</span><span>未复权价格 · 非全A股</span></div>}
    {result ? <><Panel title="窗口覆盖与观察结果"><div className="metric-grid">{[
      ['有效事件日', result.effectiveDate], ['股票与基准配对', `${result.paired} / ${result.expected}`], ['累计价格收益', pct(final?.stock_cumulative)], ['基准累计价格收益', pct(final?.benchmark_cumulative)], ['窗口 CAR', pct(final?.car)], ['完整窗口', result.complete ? '完整' : '存在缺口']
    ].map(([k, v]) => <div className="metric" key={k}><span>{k}</span><strong>{v}</strong></div>)}</div></Panel>
      <Panel title="窗口累计价格收益" description={`相对 ${result.anchorDate || '缺失的窗口起点前一报价日'} 收盘归一，观察区间不等于可交易收益。`}><div className="padded"><TimeChart data={result.rows} keys={['stock_cumulative', 'benchmark_cumulative']} labels={{ stock_cumulative: '股票累计价格收益', benchmark_cumulative: '沪深300累计价格收益' }} percent/></div></Panel>
      <Panel title="累计异常价格收益 CAR" description={`CAR(τ) = Σ[j=−${windowSize}..τ] (股票日收益 − 基准日收益)，不是因果估计。`}><div className="padded"><TimeChart data={result.rows} keys={['car']} labels={{ car: '基准调整 CAR（算术累计）' }} percent/><details className="raw-detail"><summary>定义、覆盖与原始结果</summary>{result.notes.map(t => <p key={t}>{t}</p>)}<DataTable rows={result.rows.map(r => ({ 日期: r.date, 相对日: r.tau, 股票收盘: r.stock_close, 基准收盘: r.benchmark_close, 股票日收益: pct(r.stock_return), 基准日收益: pct(r.benchmark_return), AR: pct(r.abnormal_return), CAR: pct(r.car) }))}/></details></div></Panel>
    </> : !market.loading && <Panel><Empty title="选择事件后计算" description="图表由真实OHLC收盘价计算；没有默认收益、模拟事件业绩或填充曲线。"/></Panel>}
    {market.data && <Panel title="行情来源与研究边界"><div className="padded"><p>{Array.isArray(market.data.source.notes) ? market.data.source.notes.join(' ') : market.data.source.notes}</p><SourceLink url={market.data.source.url}>{market.data.source.provider}</SourceLink><details className="raw-detail"><summary>来源文件与SHA指纹</summary><JsonView value={market.data.source}/></details></div></Panel>}
    </>}
  </>;
}

const initialDraft = { sourceTitle: '101 Formulaic Alphas · Zura Kakushadze', sourceUrl: SOURCES.alpha, name: 'Alpha101 #101 复现', definition: 'Alpha#101 = (close − open) / ((high − low) + 0.001)。当日OHLC收盘后完整可得，最早次日交易；不预设有效性。', code: ALPHA101_CODE, sourceRegistered: false, confirmed: false, factorId: '', runId: '', reportId: '' };
function readDraft(): typeof initialDraft { try { return { ...initialDraft, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') }; } catch { return initialDraft; } }
export function ReplicationPipeline({ notify }: Props) { return <AIWorkbench notify={notify} oldView={<ManualReplicationPipeline notify={notify}/>}/>; }
function ManualReplicationPipeline({ notify }: Props) {
  const route = useRoute();
  const [view, setView] = useState(() => window.location.hash.includes('new=1') ? 'new' : 'tasks');
  const [taskSearch, setTaskSearch] = useState('');
  const allRuns = useApi<Run[]>('/runs', 4000), reports = useApi<RecordData[]>('/reports', 5000);
  const [draft, setDraft] = useState(readDraft), [validation, setValidation] = useState<RecordData | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [start, setStart] = useState('2024-01-01'), [end, setEnd] = useState('2024-12-31'), [horizon, setHorizon] = useState(5), [rebalance, setRebalance] = useState(5), [topN, setTopN] = useState('');
  const [conclusion, setConclusion] = useState('请根据本次真实结果填写观察、失败条件与下一步。尚未进行独立样本外验证。');
  const session = useApi('/session'); const isPublic = session.data?.mode === 'public';
  const runQuery = useApi<Run>(draft.runId ? '/runs/' + draft.runId : null, 3000); const run = runQuery.data;
  useEffect(() => { if (new URLSearchParams(route.split('?')[1] || '').get('new') === '1') { setView('new'); setDraft(readDraft()); } }, [route]);
  function persist(next: typeof draft) { setDraft(next); try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch { setError('浏览器无法保存流程草稿；请导出记录。'); } }
  function edit(key: 'sourceTitle' | 'sourceUrl' | 'name' | 'definition' | 'code', value: string) { persist({ ...draft, [key]: value, sourceRegistered: key === 'sourceTitle' || key === 'sourceUrl' ? false : draft.sourceRegistered, confirmed: false, factorId: '', runId: '', reportId: '' }); setValidation(null); }
  function registerSource() { try { const u = new URL(draft.sourceUrl); if (!['https:', 'http:'].includes(u.protocol) || !draft.sourceTitle.trim()) throw new Error('请输入来源名称及有效公开HTTP(S)链接。'); persist({ ...draft, sourceRegistered: true }); setError(''); notify('来源已登记；未声称模型已经解析论文全文。'); } catch (e) { setError(errorMessage(e)); } }
  async function act(kind: 'validate' | 'save' | 'run' | 'report') {
    setBusy(kind); setError('');
    try {
      if (!draft.sourceRegistered || !draft.confirmed) throw new Error('请先登记来源，并人工确认定义、字段和时间可得性。');
      if (kind === 'validate') { const v = await api('/factors/validate', 'POST', { code: draft.code }); setValidation(v); if (!v.valid) throw new Error((v.errors || []).join('；') || 'AST校验未通过'); notify('AST校验通过，尚未保存或产生任何业绩。'); }
      if (kind === 'save') {
        const v = await api('/factors/validate', 'POST', { code: draft.code }); setValidation(v); if (!v.valid) throw new Error((v.errors || []).join('；'));
        const f = await api('/factors', 'POST', { name: draft.name, category: '文献复现', description: `来源：${draft.sourceTitle}\n${draft.sourceUrl}\n人工确认定义：${draft.definition}\n模式：人工确认+规则辅助AST，未调用语言模型。`, code: v.code || draft.code });
        persist({ ...draft, factorId: f.id, runId: '', reportId: '' }); notify('已保存真实因子版本。');
      }
      if (kind === 'run') {
        if (!draft.factorId) throw new Error('请先保存因子版本。');
        const config = { factor_id: draft.factorId, start_date: start, end_date: end, horizon, quantiles: isPublic ? 3 : 5, top_n: Number(topN || (isPublic ? 3 : 20)), rebalance_days: rebalance, initial_cash: 1000000, commission_bps: 3, slippage_bps: 5, stamp_tax_bps: 5, transfer_fee_bps: 0.1, min_commission: 5, max_weight: isPublic ? 0.4 : 0.1, max_participation: 0.01, min_ipo_days: isPublic ? 0 : 120, exclude_st: !isPublic, corporate_action_mode: isPublic ? 'price_only' : 'adjusted_units', replication: { source_title: draft.sourceTitle, source_url: draft.sourceUrl, mode: '人工确认+规则辅助' } };
        const created = await api<Run>('/runs', 'POST', { name: draft.name + ' · ' + start + '—' + end, kind: 'factor', config }); persist({ ...draft, runId: created.id, reportId: '' }); notify('已提交真实数据计算，结果由实际运行产生。');
      }
      if (kind === 'report') {
        if (!run || run.status !== 'completed' || !run.result) throw new Error('任务尚未完成，不能生成结果报告。');
        const body = `来源：${draft.sourceTitle}\n${draft.sourceUrl}\n\n人工确认定义：\n${draft.definition}\n\n因子：${draft.factorId}\n研究任务：${run.id}\n数据/算法模式：${isPublic ? '公开数据浏览器计算' : '后端研究引擎'}\n\n实际指标：\n${JSON.stringify(run.result.metrics, null, 2)}\n\n研究结论（人工填写）：\n${conclusion}\n\n结果限制：\n${(run.result.warnings || []).join('\n')}\n\n本流程未调用语言模型生成收益或结论。`;
        const report = await api('/reports', 'POST', { run_id: run.id, title: draft.name + ' · 复现报告', body }); persist({ ...draft, reportId: report.id }); notify('报告已保存，可进入研究报告继续编辑。');
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  const steps = [{ label: '来源登记', done: draft.sourceRegistered }, { label: '人工定义确认', done: draft.confirmed }, { label: 'AST校验 / 保存', done: !!draft.factorId }, { label: '真实数据评测', done: run?.status === 'completed' }, { label: '结果与报告', done: !!draft.reportId }];
  const replicationRuns = (allRuns.data || []).filter(r => r.config?.replication && `${r.name} ${r.config.replication.source_title || ''}`.toLowerCase().includes(taskSearch.toLowerCase()));
  function openNew() { persist({ ...initialDraft }); setValidation(null); setError(''); setView('new'); go('/replication?manual=1&new=1'); }
  function switchView(value: string) { setView(value); go(value === 'new' ? '/replication?manual=1&new=1' : '/replication?manual=1'); }
  return <><PageHead title="人工模板复现与历史" description="保留原人工定义、流程草稿和真实研究任务；此流程不调用 AI API。" actions={<><Tag>人工模板流程</Tag>{view === 'new' && <button className="button" onClick={() => downloadJSON('factor-replication.json', { ...draft, validation, run, conclusion })}><Download size={15}/> 导出复现记录</button>}<button className="button primary" onClick={openNew}>新建复现流程 <ArrowRight size={15}/></button></>}/>
    <Panel><Tabs items={[{ id: 'tasks', label: '复现任务' }, { id: 'new', label: '新建 / 继续流程' }]} value={view} onChange={switchView}/></Panel>
    {view === 'tasks' ? <Panel title="文献复现任务" description="只显示实际登记了文献来源的研究任务。" actions={draft.runId ? <button className="text-button" onClick={() => switchView('new')}>继续当前流程 <ArrowRight size={14}/></button> : undefined}>
      <div className="filter-bar"><SearchInput value={taskSearch} onChange={setTaskSearch} placeholder="搜索任务或文献来源"/><Tag>{replicationRuns.length} 项实际任务</Tag><button className="button" onClick={allRuns.refresh}><RefreshCw size={14}/> 刷新</button></div>
      {allRuns.error && <ErrorBox message={allRuns.error} retry={allRuns.refresh}/>}
      {allRuns.loading ? <Loading/> : replicationRuns.length ? <div className="table-scroll"><table><thead><tr><th>复现任务</th><th>论文 / 来源</th><th>因子版本</th><th>当前阶段</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{replicationRuns.map(item => {
        const meta = item.config.replication, hasReport = (reports.data || []).some(r => r.run_id === item.id);
        const stage = hasReport ? '报告已保存' : item.status === 'completed' ? '真实评测完成' : ['failed', 'cancelled', 'interrupted'].includes(item.status) ? '保留结束记录' : '计算任务';
        return <tr key={item.id}><td><button className="name-link" onClick={() => go('/runs/' + item.id)}>{item.name}</button><small className="cell-sub">{item.config.start_date} — {item.config.end_date}</small></td><td>{/^https?:\/\//i.test(meta.source_url || '') ? <SourceLink url={meta.source_url}>{meta.source_title || '已登记文献'}</SourceLink> : meta.source_title || '来源未提供'}<small className="cell-sub">{meta.mode || '人工确认+规则辅助'}</small></td><td>{(item.config.factor_versions || []).map((f: RecordData) => <small key={f.id} className="cell-sub">{f.name || f.id} · v{f.version}</small>)}{!(item.config.factor_versions || []).length && (item.config.factor_id || '—')}</td><td>{stage}</td><td><Status status={item.status}/></td><td className="muted">{dateTime(item.created_at)}</td><td><div className="actions"><button className="text-button" onClick={() => go('/runs/' + item.id)}>查看任务</button>{item.status === 'completed' && <button className="text-button" onClick={() => go('/reports?run=' + item.id)}>{hasReport ? '查看报告' : '撰写报告'}</button>}{item.id === draft.runId && <button className="text-button" onClick={() => switchView('new')}>继续流程</button>}</div></td></tr>;
      })}</tbody></table></div> : <Empty title="尚无文献复现任务" description="创建来源明确的复现流程，保存因子并提交实际评测后，任务才会出现在这里。" action={<button className="button primary" onClick={openNew}>新建复现流程</button>}/>}
    </Panel> : <>
    <Panel><div className="filter-bar" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>{steps.map((s, i) => <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Tag tone={s.done ? 'green' : 'neutral'}>{s.done ? <Check size={13}/> : i + 1}</Tag>{s.label}{i < 4 && <ArrowRight size={13} className="muted"/>}</span>)}</div></Panel>
    {(error || runQuery.error) && <ErrorBox message={error || runQuery.error}/>}<Panel title="1 · 登记可核查来源" actions={<button className="text-button" onClick={() => { persist({ ...initialDraft }); setValidation(null); }}>载入 Alpha101 #101</button>}><div className="padded" style={spacing}><div style={grid}><Field label="论文 / 研报名称"><input value={draft.sourceTitle} onChange={e => edit('sourceTitle', e.target.value)}/></Field><Field label="公开来源 URL"><input type="url" value={draft.sourceUrl} onChange={e => edit('sourceUrl', e.target.value)}/></Field></div><div className="actions"><button className="button" onClick={registerSource}><ClipboardCheck size={15}/> 登记来源</button>{/^https?:\/\//i.test(draft.sourceUrl) && <SourceLink url={draft.sourceUrl}>人工阅读原文</SourceLink>}<span className="muted">登记链接不等于已自动下载或解析全文。</span></div></div></Panel>
    <Panel title="2 · 确认定义与代码"><div className="padded" style={spacing}><Field label="因子名称"><input value={draft.name} onChange={e => edit('name', e.target.value)}/></Field><Field label="公式、字段、窗口、决策时点"><textarea rows={3} value={draft.definition} onChange={e => edit('definition', e.target.value)}/></Field><Field label="受限 AST 代码"><textarea className="code-editor" rows={6} value={draft.code} onChange={e => edit('code', e.target.value)} spellCheck={false}/></Field><label className="check-label"><input type="checkbox" checked={draft.confirmed} disabled={!draft.sourceRegistered} onChange={e => persist({ ...draft, confirmed: e.target.checked })}/> 我已核对来源中的公式，并确认本次字段、窗口和信号时点。</label><div className="actions"><button className="button" disabled={!!busy || !draft.confirmed} onClick={() => act('validate')}>{busy === 'validate' ? '校验中…' : '校验 AST'}</button><button className="button primary" disabled={!!busy || !draft.confirmed || !!draft.factorId} onClick={() => act('save')}><Save size={15}/>{draft.factorId ? '版本已保存' : busy === 'save' ? '保存中…' : '保存因子版本'}</button>{draft.factorId && <button className="text-button" onClick={() => go('/factors/' + draft.factorId)}>查看因子 <ArrowRight size={14}/></button>}</div>{validation && <><Tag tone={validation.valid ? 'green' : 'red'}>{validation.valid ? 'AST校验通过' : 'AST校验失败'}</Tag><p className="muted">依赖字段：{(validation.dependencies || []).join('、') || '—'}；预热：{validation.warmup_days ?? '由算子定义确定'}。</p><details className="raw-detail"><summary>查看真实 AST 与运算步骤</summary><JsonView value={{ ast: validation.ast, steps: validation.steps, errors: validation.errors }}/></details></>}</div></Panel>
    <Panel title="3 · 真实数据评测" description={isPublic ? '公开模式：固定12只真实股票样本，浏览器本机计算；不含公司私有数据。' : '后端模式：提交持久化计算任务，冻结因子版本与研究参数。'}><div className="padded" style={spacing}><div style={grid}><Field label="开始日期"><input type="date" value={start} onChange={e => setStart(e.target.value)}/></Field><Field label="结束日期"><input type="date" value={end} onChange={e => setEnd(e.target.value)}/></Field><Field label="前瞻持有期（交易日）"><input type="number" min={1} max={60} value={horizon} onChange={e => setHorizon(Number(e.target.value))}/></Field><Field label="调仓间隔（交易日）"><input type="number" min={1} max={60} value={rebalance} onChange={e => setRebalance(Number(e.target.value))}/></Field><Field label="目标持股数"><input type="number" min={1} max={252} value={topN} placeholder={isPublic ? '3' : '20'} onChange={e => setTopN(e.target.value)}/></Field></div><p className="muted">本次资金100万元；佣金3bps（最低5元）、滑点5bps、卖出印花税5bps、过户费0.1bps。更多参数可在因子详情的新建评测中编辑。{isPublic ? ' 公共模式只支持OHLCV；无复权、历史ST与盘口验证。' : ' 后端采用明确标注的复权等价份额模式。'}</p><button className="button primary" style={{ justifySelf: 'start' }} disabled={!!busy || !draft.factorId || !session.data} onClick={() => act('run')}><Play size={15}/>{busy === 'run' ? '提交中…' : '提交真实评测'}</button>{run && <><div className="run-status"><Status status={run.status}/><span>{run.message}</span><button className="text-button" onClick={() => go('/runs/' + run.id)}>查看任务 <ArrowRight size={14}/></button></div>{run.result && <MetricGrid metrics={run.result.metrics || {}}/>}</>}</div></Panel>
    <Panel title="4 · 保存人工研究结论"><div className="padded" style={spacing}><Field label="观察、局限与下一步（不预设正收益）"><textarea rows={5} value={conclusion} onChange={e => setConclusion(e.target.value)}/></Field><div className="actions"><button className="button primary" disabled={!!busy || run?.status !== 'completed' || !!draft.reportId} onClick={() => act('report')}><Save size={15}/>{draft.reportId ? '报告已保存' : '保存真实结果报告'}</button>{draft.reportId && <button className="button" onClick={() => go('/reports?run=' + draft.runId)}>查看 / 编辑报告 <ArrowRight size={15}/></button>}</div></div></Panel>
    </>}
  </>;
}

export function SystemStatus({ notify }: Props) {
  const session = useApi('/session'), overview = useApi('/overview', 10000), data = useApi('/data'), runs = useApi<Run[]>('/runs', 10000);
  const [health, setHealth] = useState<RecordData | null>(null), [healthError, setHealthError] = useState(''), [busy, setBusy] = useState(false), [storage, setStorage] = useState<{ usage?: number; quota?: number } | null>(null);
  const isPublic = session.data?.mode === 'public'; const market = usePublicMarket();
  useEffect(() => { api('/system').then(value => { setHealth(value); setHealthError(''); }).catch(e => setHealthError(errorMessage(e))); navigator.storage?.estimate?.().then(setStorage).catch(() => {}); }, []);
  async function exportState() {
    setBusy(true);
    try {
      let snapshot: RecordData;
      if (isPublic) snapshot = await api('/snapshot');
      else {
        const [factors, strategies, reports, fullRuns] = await Promise.all([api('/factors'), api('/strategies'), api('/reports'), Promise.all((runs.data || []).map(r => api('/runs/' + r.id)))]);
        snapshot = { exported_at: new Date().toISOString(), mode: session.data?.mode || 'backend', factors, strategies, reports, runs: fullRuns, data: data.data };
      }
      snapshot.replication_draft = readDraft(); downloadJSON('quant-platform-export.json', snapshot); notify('已导出实际记录；导出文件保存在你的设备。');
    } catch (e) { setHealthError(errorMessage(e)); } finally { setBusy(false); }
  }
  const modeLabel = !session.data ? '连接状态待确认' : isPublic ? '公开站点 · 浏览器计算' : session.data.mode === 'local' ? '本地后端 · Python计算' : '后端 API · Python计算';
  return <><PageHead title="系统状态" description="实际运行模式、数据来源、持久化边界与可导出的研究记录。" actions={<><button className="button" onClick={() => { session.refresh(); overview.refresh(); data.refresh(); runs.refresh(); api('/system').then(value => { setHealth(value); setHealthError(''); }).catch(e => setHealthError(errorMessage(e))); }}><RefreshCw size={15}/> 刷新</button><button className="button primary" disabled={busy || !session.data} onClick={exportState}><Download size={15}/>{busy ? '导出中…' : '导出研究记录'}</button></>}/>
    {session.error && <ErrorBox message={session.error}/>}<Panel title="运行环境"><div className="padded"><div className="metric-grid"><div className="metric"><span>当前模式</span><strong style={{ fontSize: 19 }}>{modeLabel}</strong></div><div className="metric"><span>已登记因子</span><strong>{fmt(overview.data?.factor_count)}</strong></div><div className="metric"><span>实际任务记录</span><strong>{fmt(runs.data?.length)}</strong></div><div className="metric"><span>已完成任务</span><strong>{runs.data ? runs.data.filter(x => x.status === 'completed').length : '—'}</strong></div></div><p>{isPublic ? '网页可共享访问；因子、任务和报告保存在当前浏览器，未实现跨用户云端协同。同一网址不等于共享研究数据库。清理站点存储或更换浏览器可能失去记录，请先导出。' : '研究任务由当前连接的后端执行并持久化；浏览器草稿保存在本机。此页面没有推断云服务器、团队同步、在线人数或服务运行时长。'}</p><p className="muted">{isPublic && health?.storage_bytes != null && <>本机研究记录序列化大小：{fmt(health.storage_bytes / 1024)} KiB。 </>}浏览器估算存储使用（可能不含localStorage） {storage?.usage == null ? '不可用' : fmt(storage.usage / 1024 / 1024) + ' MiB'} / 配额 {storage?.quota == null ? '不可用' : fmt(storage.quota / 1024 / 1024) + ' MiB'}；此估算不等于后端磁盘占用。</p></div></Panel>
    <Panel title="数据来源与覆盖"><div className="padded">{isPublic && market.data ? <><div className="scope-strip"><span>{market.data.source.provider}</span><span>{market.data.coverage.start} — {market.data.coverage.end}</span><span>{market.data.universe.length}只固定样本</span><span>{market.data.bars.length.toLocaleString()}条实际行情</span></div><p>{Array.isArray(market.data.source.notes) ? market.data.source.notes.join(' ') : market.data.source.notes}</p><SourceLink url={market.data.source.url}>公开供应来源</SourceLink><details className="raw-detail"><summary>原始文件、检索时点与指纹</summary><JsonView value={market.data.source}/></details></> : data.loading ? <Loading/> : data.data ? <JsonView value={data.data}/> : <Empty title="尚未取得后端数据状态" description={data.error || '等待API响应。'}/>}</div></Panel>
    <Panel title="组件能力"><div className="table-scroll"><table><thead><tr><th>组件</th><th>当前状态</th><th>真实边界</th></tr></thead><tbody><tr><td>因子定义 / AST</td><td><Tag tone="green">规则编译</Tag></td><td>受限公式校验；运行结果取自实际数据</td></tr><tr><td>语言模型</td><td><Tag>未连接</Tag></td><td>复现流程为人工确认＋规则辅助，没有伪造模型分析</td></tr><tr><td>研究记录</td><td>{isPublic ? '当前浏览器持久化' : '后端持久化'}</td><td>{isPublic ? '可导出；未提供多人共享数据库' : '按连接的后台服务保存；不推断部署方式'}</td></tr><tr><td>实时行情 / 实盘订单</td><td><Tag>未接入</Tag></td><td>仅历史研究，不展示虚构账户余额或实时委托</td></tr><tr><td>基本面算子</td><td>手填公式计算</td><td>未接入可验证财务PIT序列，不声称完成回测</td></tr></tbody></table></div></Panel>
    <Panel title="实际任务记录"><RunTable runs={runs.data || []}/></Panel><Panel title="接口诊断"><div className="padded">{health ? <JsonView value={health}/> : <p className="muted">{healthError ? '当前服务未提供/system诊断或请求未成功；上方状态来自/session、/overview和/runs。' : '正在读取诊断。'}</p>}<details className="raw-detail"><summary>会话与概览原始响应</summary><JsonView value={{ session: session.data, overview: overview.data, system_error: healthError || null }}/></details></div></Panel>
  </>;
}
