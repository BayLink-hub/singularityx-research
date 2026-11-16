import { useEffect, useState } from 'react';
import { BookOpen, Database, Download, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api, downloadFile, errorMessage, type RecordData, useApi } from './api';
import { DataTable, Empty, ErrorBox, Field, JsonView, Loading, PageHead, Panel, Tabs, Tag, dateTime, fmt } from './components';

const usages: Record<string, string> = { daily: '日频引擎已接入', source: '原始数据可读取', pit: '按信息时点适配', reference: '参考资料', evaluation_only: '仅评估目标' };
export function DataQuality({ publicMode = false }: { publicMode?: boolean }) {
  const active = useApi('/data'), catalog = useApi('/data/catalog');
  const [view, setView] = useState('catalog'), [datasetId, setDatasetId] = useState('stock_dailyhq'), [tableId, setTableId] = useState(''), [search, setSearch] = useState(''), [docSearch, setDocSearch] = useState('');
  const [preview, setPreview] = useState<RecordData | null>(null), [date, setDate] = useState(''), [bar, setBar] = useState('093300'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const datasets: RecordData[] = catalog.data?.datasets || [], selected = datasets.find(d => d.id === datasetId), tables: RecordData[] = selected?.tables || [];
  const table = tables.find(t => t.id === tableId) || tables[0];
  const fields = (table?.fields || []).filter((f: RecordData) => `${f.name} ${f.description}`.toLowerCase().includes(search.toLowerCase()));
  const sections: RecordData[] = (catalog.data?.dictionary?.sections || []).filter((s: RecordData) => `${s.title} ${s.body}`.toLowerCase().includes(docSearch.toLowerCase()));
  const daily = datasets.find(d => d.id === 'stock_dailyhq');
  useEffect(() => { setPreview(null); setError(''); setDate(table?.sample_partition || ''); }, [datasetId, table?.id]);
  async function readPreview() {
    if (!table) return;
    setBusy(true); setError('');
    try { setPreview(await api('/data/preview?' + new URLSearchParams({ dataset: datasetId, table: table.id, ...(date ? { date } : {}), bar, limit: '30' }))); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const refresh = () => { active.refresh(); catalog.refresh(); };
  return <><PageHead eyebrow="DATA FOUNDATION" title="数据中心" description="浏览本地数据目录、真实表头和字段说明；研究任务记录各自实际使用的数据范围。" actions={<button className="button" onClick={refresh}><RefreshCw size={15}/> 刷新</button>}/>
    {(active.error || catalog.error) && <ErrorBox message={active.error || catalog.error} retry={refresh}/>}
    <div className="data-summary"><div><span>本地股票日线目录</span><strong>{daily?.start || '读取中'} <i>—</i> {daily?.end || '读取中'}</strong><small>{fmt(daily?.partitions)} 个实际日期目录</small></div><div><span>当前计算环境</span><strong>{publicMode ? '浏览器 · 公开样本' : '本地后台 · 全市场'}</strong><small>{active.data?.start_date} — {active.data?.end_date}；{fmt(active.data?.stock_count || active.data?.dates_count)} {active.data?.stock_count ? '只股票' : '个交易日'}</small></div><div><span>数据目录清点</span><strong>{datasets.filter(d => d.status === 'available').length} <i>类实际数据</i></strong><small>{dateTime(catalog.data?.generated_at)} · 元数据快照</small></div></div>
    <Panel><Tabs value={view} onChange={setView} items={[{ id: 'catalog', label: '数据目录与字段' }, { id: 'dictionary', label: '原始字段说明' }, { id: 'active', label: '当前研究数据与质量' }]}/>
      {view === 'catalog' && (catalog.loading ? <Loading/> : <div className="data-catalog-layout">
        <aside className="dataset-navigation"><div className="section-label"><Database size={15}/> DATA / PUBLIC</div>{datasets.map(d => <button key={d.id} className={datasetId === d.id ? 'active' : ''} onClick={() => { setDatasetId(d.id); setTableId(''); setSearch(''); }}><strong>{d.name}</strong><small>{d.start || '静态 / 专有格式'}{d.end ? ' — ' + d.end : ''}</small><span>{d.status === 'missing' ? '目录未发现' : `${d.tables.length} 个已发现表模式`}</span></button>)}</aside>
        <div className="dataset-detail">{selected && <><div className="structure-heading"><div><h2>{selected.name}</h2><code>{selected.path}</code></div><Tag tone={selected.usage === 'evaluation_only' ? 'amber' : 'blue'}>{usages[selected.usage]}</Tag></div><p className="dataset-timing">{selected.timing}</p>
          <div className="dataset-facts"><span>频率<strong>{selected.frequency}</strong></span><span>日期目录<strong>{fmt(selected.partitions)}</strong></span><span>目录覆盖<strong>{selected.start || '不适用'} — {selected.end || '不适用'}</strong></span></div>
          {tables.length ? <><div className="form-grid"><Field label="数据表"><select value={table?.id || ''} onChange={e => { setTableId(e.target.value); setSearch(''); }}>{tables.map(t => <option key={t.id} value={t.id}>{t.name} · {t.field_count} 字段</option>)}</select></Field><Field label="搜索字段"><div className="search-box"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="字段名或含义，例如 ann_date"/></div></Field></div><p>{table?.description}</p><p className="muted">表头样本：{table?.sample_path} · {fmt(table?.sample_bytes / 1024)} KiB</p>
            <div className="field-dictionary-scroll"><table><thead><tr><th>真实字段</th><th>含义与单位</th><th>说明状态</th></tr></thead><tbody>{fields.map((f: RecordData) => <tr key={f.name}><td><code>{f.name}</code></td><td>{f.description}</td><td><Tag>{f.definition_status === 'mapped' ? '已说明' : '待核验定义'}</Tag></td></tr>)}</tbody></table>{!fields.length && <Empty title="没有匹配字段"/>}</div>
            <div className="data-preview-section"><h3>源数据预览</h3>{publicMode ? <div className="notice purple compact"><ShieldCheck size={16}/><span>此处展示本地数据的目录和字段元数据。GitHub 页面不能读取你的硬盘；源表预览与全市场计算由本地后台提供，当前公开计算范围见上方环境卡。</span></div> : <><div className="form-grid"><Field label="读取日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!selected.partitions}/></Field>{table?.name === 'HHMMSS.csv.gz' && <Field label="分钟时刻 HHMMSS"><input value={bar} onChange={e => setBar(e.target.value)} maxLength={6}/></Field>}<button className="button" disabled={busy || !table?.preview_supported} onClick={readPreview}>{busy ? '读取中…' : '读取前 30 行'}</button></div>{error && <ErrorBox message={error}/>} {preview && <><p className="muted">{preview.path} · {preview.scope}</p><DataTable rows={preview.rows}/></>}</> }</div>
          </> : <Empty title={selected.status === 'missing' ? '未发现此目录' : '该格式尚未建立表格适配器'} description={selected.children?.join(' · ') || '原说明中的条目不代表本地一定存在对应数据。'}/>}
          <p className="data-scope-note">{selected.schema_scope} {catalog.data?.row_counts}</p>
        </>}</div>
        <aside className="data-dictionary-aside"><div className="section-label"><BookOpen size={16}/> 字段说明</div><p>来源：{catalog.data?.dictionary?.filename}</p><p>{catalog.data?.dictionary?.note}</p><button className="button" onClick={() => { setDocSearch(''); setView('dictionary'); }}>阅读完整说明</button><h4>使用约定</h4><p>表头来自实际文件；字段解释没有来源时保留待核验状态。</p><p>目录日期、交易日期、报告期与公告日期是不同概念。</p><p>日线成交量和成交额的换算仅适用于已核对的表。</p><code className="hash-wrap">文档 SHA256<br/>{catalog.data?.dictionary?.sha256}</code></aside>
      </div>)}
      {view === 'dictionary' && <div className="padded"><div className="filter-bar"><div className="search-box"><Search size={16}/><input aria-label="搜索原始字段说明" value={docSearch} onChange={e => setDocSearch(e.target.value)} placeholder="搜索表名、路径或说明"/></div><button className="button" onClick={() => downloadFile(catalog.data?.dictionary?.filename || '数据字段说明.md', catalog.data?.dictionary?.text || '')}><Download size={15}/> 下载原文</button></div><div className="original-dictionary">{sections.map((s, i) => <section key={i} className={'doc-level-' + s.level}><h3>{s.title}</h3>{s.body && <p>{s.body}</p>}</section>)}</div></div>}
      {view === 'active' && (active.loading ? <Loading/> : <div className="padded"><h3>{publicMode ? '当前网页实际加载的公开样本' : '当前后台实际读取的数据'}</h3><DataTable rows={(active.data?.datasets || []).map((d: RecordData) => ({ 数据集: d.name, 开始: d.start, 结束: d.end, 范围: d.rows_scope || '目录清点，未推测全量行数', 状态: d.status }))}/><div className="issue-grid">{(active.data?.issues || []).map((issue: RecordData, i: number) => <article className="issue-card" key={i}><h3>{issue.title}</h3><p>{issue.detail}</p></article>)}</div><h3>源单位与转换</h3><DataTable rows={Object.entries(active.data?.unit_policy || {}).map(([字段, 单位]) => ({ 字段, 单位 }))}/><h3>内容样本检查</h3><DataTable rows={active.data?.sampled_checks || []}/><details className="raw-detail"><summary>完整质量记录</summary><JsonView value={active.data}/></details></div>)}
    </Panel></>;
}
