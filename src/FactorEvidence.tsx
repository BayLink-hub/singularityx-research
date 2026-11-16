import { useMemo, useState } from 'react';
import { BarChart3, Download, ExternalLink, Play } from 'lucide-react';
import { Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, downloadFile, go, isPublicMode, type RecordData, type Run, useApi } from './api';
import { DataTable, Empty, ErrorBox, Field, JsonView, Loading, Panel, Tag, TimeChart, benchmarkDescriptor, dateTime, fmt } from './components';
import { augmentResearch } from './researchAnalytics';

const colors = ['#6875ca','#a4ba56','#59556e','#cf7950','#63a8bd','#d9c653','#ca7391','#8b6aaa','#5ba083','#263848'];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const average = (a: number[]) => a.length ? a.reduce((s,v) => s+v,0)/a.length : null;
const deviation = (a: number[]) => { if (!a.length) return null; const m = average(a)!; return Math.sqrt(average(a.map(v => (v-m)**2))!); };
const annualRatio = (a: number[]) => a.length > 1 && deviation(a)! > 1e-14 ? average(a)! / deviation(a)! * Math.sqrt(252) : null;
const tableRows = (table: RecordData | undefined): RecordData[] => (table?.rows || []).map((row: unknown[]) => Object.fromEntries(table!.columns.map((key: string, i: number) => [key === 'trade_date' ? 'date' : key, row[i]])));

/** Adapt original CSV values; original IC remains explicitly untyped, never duplicated as Pearson/RankIC. */
export function legacyEvidence(history: RecordData, benchmark?: RecordData | null): RecordData {
  const tables = history.tables || {}, net = tableRows(tables.group_net_returns), turns = tableRows(tables.group_turnover), counts = tableRows(tables.valid_counts);
  const cumulative = tableRows(tables.cumulative_net_returns), keys = (tables.group_net_returns?.columns || []).filter((k: string) => /^G\d+$/.test(k));
  const netMap = new Map(net.map(r => [r.date, r]));
  const turnMap = new Map(turns.map(r => [r.date, r])), countMap = new Map(counts.map(r => [r.date, r]));
  const groups = cumulative.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'date' ? v : finite(v) ? 1 + v : null])));
  const bmRows = benchmark?.rows || benchmark?.series || [], bmMap = new Map<string, any>(bmRows.map((r: RecordData) => [r.date || r.trade_date, r]));
  let bmNav: number | null = 1, peak = 1;
  const curves = groups.map((r, i) => {
    const b = bmMap.get(r.date), br = b?.return ?? b?.next_return ?? b?.NextIndexRtn_1d;
    bmNav = bmNav !== null && finite(br) ? bmNav * (1 + br) : null;
    const nav = r.G10; if (finite(nav)) peak = Math.max(peak, nav);
    return { date: r.date, nav, long_short: r.LongShort, benchmark: bmNav, drawdown: finite(nav) ? nav/peak-1 : null, turnover: turnMap.get(r.date)?.G10 ?? null,
      return: netMap.get(r.date)?.G10 ?? null, benchmark_return: finite(br) ? br : null, count: countMap.get(r.date)?.valid_stock_count };
  });
  const ic = tableRows(tables.ic_series).map(r => ({ date: r.date, ic: r.IC, rank_ic: null }));
  const result = { curves, groups, ic }, analytics = augmentResearch(result, null, {});
  const paired = curves.filter(r => finite(r.return) && finite(r.benchmark_return));
  const excess = paired.map(r => r.return - r.benchmark_return!);
  const summary = keys.map((group: string, i: number) => {
    const rets = net.map(r => r[group]).filter(finite), complete = rets.length === net.length;
    const product = complete ? rets.reduce((v,r) => v*(1+r),1) : null;
    let nav = 1, high = 1, dd = 0; rets.forEach(r => { nav *= 1+r; high = Math.max(high,nav); dd = Math.min(dd,nav/high-1); });
    return { group, number:i+1, mean_return: average(rets), annual_return: product !== null && product > 0 ? product**(252/rets.length)-1 : null, cumulative_return: product === null ? null : product-1, sharpe: annualRatio(rets), max_drawdown: complete ? dd : null, mean_turnover: average(turns.map(r => r[group]).filter(finite)), observations: rets.length, missing_periods: net.length-rets.length };
  });
  const periods = (width: number) => [...new Set(net.map(r => String(r.date).slice(0,width)))].map(period => {
    const slice = curves.filter(r => r.date.startsWith(period)), rets = slice.map(r=>r.return).filter(finite), b = slice.map(r=>r.benchmark_return).filter(finite);
    const compound = (v:number[]) => v.reduce((n,r)=>n*(1+r),1)-1;
    return { period, return: rets.length === slice.length ? compound(rets):null, benchmark_return:b.length===slice.length?compound(b):null, mean_turnover:average(slice.map(r=>r.turnover).filter(finite)), observations:rets.length };
  });
  analytics.groups = { ...analytics.groups, count:keys.length, curves:groups, returns:net, turnover:turns, summary, reason:null,
    turnover_definition:history.provenance?.turnover_definition, source:'original_0933_csv', definitions:{ group_return:'原始 09:33 标签分组；commission=0、slippage=0；存在事后收益可用性筛选。' } };
  analytics.performance = { ...analytics.performance, daily:curves, monthly:periods(7), yearly:periods(4) };
  analytics.metrics = { ...analytics.metrics, alpha_daily:null, alpha_annual:null, beta:null, sortino:null, calmar:null, annual_return:history.summary?.top_group_annual_return_net ?? null, total_return:summary.find((r:RecordData)=>r.group === "G10")?.cumulative_return ?? null, max_drawdown:summary.find((r:RecordData)=>r.group === "G10")?.max_drawdown ?? null, information_ratio: annualRatio(excess), tracking_error:excess.length>1?deviation(excess)!*Math.sqrt(252):null, mean_turnover:average(turns.map(r=>r.G10).filter(finite)), benchmark_observations:paired.length };
  delete analytics.unavailable.group_turnover;
  analytics.limitations = history.provenance?.limitations || [];
  return { ...result, analytics, metrics:history.summary, diagnostics:{coverage:counts}, provenance:history.provenance, legacy:true, benchmark: benchmark ? { id: 'index:' + benchmark.symbol + ':0933', name: `${benchmark.name || benchmark.symbol} · 09:33`, basis: '价格收益，不含分红；当日 09:33 至下一交易日 09:33，与原分组零成本口径配对。', provenance: benchmark.provenance || benchmark.source } : null, benchmark_source:benchmark?.provenance || benchmark?.source };
}

function BarPlot({ rows, value, label, percent=false }: { rows:RecordData[];value:string;label:string;percent?:boolean }) {
  if (!rows.some(r=>finite(r[value]))) return <Empty title="没有可用的真实统计值"/>;
  return <div className="evidence-chart"><ResponsiveContainer width="100%" height={270}><BarChart data={rows} margin={{top:15,right:20,left:8,bottom:10}}><CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e4e8f0"/><XAxis dataKey="label" tick={{fontSize:11}}/><YAxis tickFormatter={v=>percent?`${(v*100).toFixed(0)}%`:String(v)} tick={{fontSize:11}}/><Tooltip formatter={(v:any)=>fmt(v,percent?'percent':undefined)} labelFormatter={v=>String(v)}/><ReferenceLine y={0} stroke="#9aa3b4"/><Bar dataKey={value} name={label} radius={[2,2,0,0]}>{rows.map((r,i)=><Cell key={i} fill={r[value]<0?'#c45568':i===rows.length-1?'#4c84ce':'#5e9f78'}/>)}</Bar></BarChart></ResponsiveContainer></div>;
}

function ICPlot({ rows, field, cumulative, original }: {rows:RecordData[];field:string;cumulative:string;original:boolean}) {
  const [hidden,setHidden]=useState<Record<string,boolean>>({});
  if (!rows.some(r=>finite(r[field]))) return <Empty title="没有该口径的 IC 日序列" description="不会从汇总值生成曲线，也不会把一列 IC 复制成两种相关性。"/>;
  const name=original?'原档 IC（方法未冻结）':field==='rank_ic'?'Spearman RankIC':'Pearson IC';
  return <div className="evidence-chart"><ResponsiveContainer width="100%" height={360}><ComposedChart data={rows} margin={{top:10,right:18,left:0,bottom:0}}><CartesianGrid vertical={false} strokeDasharray="4 4" stroke="#e2e6ee"/><XAxis dataKey="date" minTickGap={60} tick={{fontSize:10}}/><YAxis yAxisId="ic" domain={['auto','auto']} tick={{fontSize:11}}/><YAxis yAxisId="sum" orientation="right" tick={{fontSize:11}}/><Tooltip formatter={(v:any,n:any)=>[fmt(v),n]}/><Legend onClick={(v:any)=>setHidden(x=>({...x,[v.dataKey]:!x[v.dataKey]}))} wrapperStyle={{fontSize:11,paddingBottom:10}} verticalAlign="top"/><ReferenceLine yAxisId="ic" y={0} stroke="#969fae"/><Bar yAxisId="ic" fill="#6b79c6" dataKey={field} name={name} hide={hidden[field]}>{rows.map((r,i)=><Cell key={i} fill={r[field]<0?'#c75b6d':'#6b79c6'}/>)}</Bar><Line yAxisId="sum" dataKey={cumulative} name="累计 IC（右轴，算术和）" stroke="#d9b34b" dot={false} strokeWidth={1.8} hide={hidden[cumulative]} connectNulls={false}/>{rows.length>40&&<Brush dataKey="date" height={22} stroke="#bcc5de" travellerWidth={7}/>}</ComposedChart></ResponsiveContainer></div>;
}

function MonthlyHeatmap({rows}: {rows:RecordData[]}) {
  const years=[...new Set(rows.map(r=>String(r.period).slice(0,4)))].sort();
  const map=new Map(rows.map(r=>[r.period,r.return]));
  return <div className="table-scroll"><table className="return-heatmap"><thead><tr><th>年份</th>{Array.from({length:12},(_,i)=><th key={i}>{i+1} 月</th>)}</tr></thead><tbody>{years.map(year=><tr key={year}><th>{year}</th>{Array.from({length:12},(_,i)=>{const value=map.get(`${year}-${String(i+1).padStart(2,'0')}`),strength=finite(value)?Math.min(.8,Math.abs(value)*3+.08):0;return <td key={i} title={finite(value)?`${year}-${i+1} 复合收益 ${fmt(value,'percent')}`:'缺少完整数据'} style={{background:finite(value)?value>=0?`rgba(78,151,111,${strength})`:`rgba(198,76,100,${strength})`:'#f7f8fb',color:strength>.45?'white':undefined}}>{fmt(value,'percent')}</td>;})}</tr>)}</tbody></table></div>;
}

/** Use backend's direct cohort evidence even after a missing NAV interval. */
export function backendEvidence(result:RecordData, config:RecordData={}):RecordData {
  if (result.analytics) return result.analytics;
  const diagnostics=result.diagnostics||{}, icByDate=new Map((result.ic||[]).map((r:RecordData)=>[r.date,r]));
  const ic=diagnostics.coverage?.length ? diagnostics.coverage.map((r:RecordData)=>({date:r.date,ic:null,rank_ic:null,...(icByDate.get(r.date)||{})})) : result.ic;
  const a=augmentResearch({...result,ic},null,config);
  // Backend counts its initial cash session in annualization. Keep frozen
  // performance instead of silently replacing it with an N-1 convention.
  const m=result.metrics||{};
  for(const [target,source] of Object.entries({annual_return:'annualized_return',total_return:'total_return',max_drawdown:'max_drawdown',sortino:'sortino',calmar:'calmar'})) {
    if (Object.hasOwn(m,source)) {a.metrics[target]=m[source];a.performance.metrics[target]=m[source];}
  }
  for(const [key,periodKey] of [['monthly','month'],['yearly','year']]) {
    if (!Array.isArray(result[key])) continue;
    const frozen=new Map(result[key].map((r:RecordData)=>[r[periodKey],r]));
    a.performance[key]=a.performance[key].map((r:RecordData)=>{
      const original=frozen.get(r.period) as RecordData|undefined;
      return original?{...r,return:original.return,observations:original.days,backend_cash_anchor_included:true}:r;
    });
  }
  a.performance.definitions.periods='策略月/年收益和年化绩效沿用后台冻结值，后台交易日数含首日现金零收益；IR、TE、alpha、beta使用相邻净值形成的同日配对收益，不补造首日前收益。';
  a.performance.definitions.supplementary_excess_observations=a.metrics.excess_observations;
  if (!Array.isArray(diagnostics.group_returns)) return a;
  const returns:RecordData[]=diagnostics.group_returns, turnover:RecordData[]=diagnostics.group_turnover||[];
  const summary=a.groups.summary.map((r:RecordData)=>{
    const values=returns.map(row=>row[r.group]).filter(finite), complete=values.length===returns.length;
    return {...r,mean_return:average(values),observations:values.length,missing_periods:returns.length-values.length,
      cumulative_return:complete&&values.length ? values.reduce((nav,v)=>nav*(1+v),1)-1:null,
      mean_turnover:average(turnover.map(row=>row[r.group]).filter(finite))};
  });
  const means=summary.map((r:RecordData)=>r.mean_return), complete=means.length>1&&means.every(finite);
  const ranks=complete?means.map((v:number)=>1+means.filter((x:number)=>x<v).length+(means.filter((x:number)=>x===v).length-1)/2):[];
  const positions=ranks.map((_:number,i:number)=>i+1), rankMean=average(ranks), positionMean=average(positions);
  const monotonicity=complete&&deviation(ranks)!>1e-14 ? average(ranks.map((r:number,i:number)=>(r-rankMean!)*(positions[i]-positionMean!)))!/deviation(ranks)!/deviation(positions)!:null;
  const first=summary[0]?.group,last=summary.at(-1)?.group;
  a.groups={...a.groups,returns,turnover,summary,monotonicity,
    strictly_increasing:complete?means.every((v:number,i:number)=>i===0||v>means[i-1]):null,
    long_short:returns.map(r=>({date:r.date,return:finite(r[first])&&finite(r[last])?r[last]-r[first]:null})),
    source:'backend_fixed_cohorts',turnover_reason:null,
    turnover_definition:diagnostics.group_turnover_definition,return_basis:diagnostics.group_definition,
    reason:summary.some((r:RecordData)=>r.missing_periods>0)?'部分组存在缺失报价：该期收益及后续累计净值为空；平均收益仅统计可观测队列，不能据此比较完整区间累计表现。':a.groups.reason};
  if (turnover.length) delete a.unavailable.group_turnover;
  if (a.groups.reason) a.unavailable.deciles=a.groups.reason;
  a.ic.definitions.rolling='完整交易日轴上的20/60日窗口；任一IC缺失时该滚动值为空，不压缩缺失日期。';
  return a;
}

export function EvidencePanels({result,config={}}: {result:RecordData;config?:RecordData}) {
  const analysis=useMemo(()=>backendEvidence(result,config),[result,config]);
  const [icType,setICType]=useState('ic');
  const a=analysis, legacy=!!result.legacy, m=result.metrics||{}, stats=a.ic.summary[icType], keys=(a.groups.summary||[]).map((r:RecordData)=>r.group);
  const benchmark = benchmarkDescriptor(result, config);
  const primary=[
    [legacy?'原档 IC 均值':'Pearson IC 均值',legacy?m.ic_mean:a.ic.summary.ic.mean,'ic'],
    ['RankIC 均值',legacy?null:a.ic.summary.rank_ic.mean,'ic'],
    ['ICIR · 年化',legacy?m.icir:a.ic.summary.ic.icir_annualized,'number'],
    ['IR · 年化',a.metrics.information_ratio,'number'],
    [legacy?'最高组年化 · 零成本':'策略年化 · 费后',legacy?m.top_group_annual_return_net:(m.annual_return ?? m.annualized_return),'percent'],
    ['平均换手率',a.metrics.mean_turnover,'percent'],
    [legacy?'多空最大回撤':'策略最大回撤',legacy?m.long_short_max_drawdown_net:m.max_drawdown,'percent'],
  ];
  return <div className="factor-evidence">
    <Panel title="核心指标" description={legacy?'原始 09:33 研究记录 · 费滑均为零；IR使用同日 09:33 沪深300价格收益配对':'本次实际计算 · IC 为统计关联；IR 为策略相对基准的信息比率'}><div className="evidence-metrics">{primary.map(([label,value,type])=><div key={String(label)}><span>{label}</span><strong className={finite(value)?value<0?'negative':'positive':'unmeasured'}>{fmt(value,type==='number'?undefined:String(type))}</strong></div>)}</div></Panel>
    <Panel title="IC 时序与累计 IC" actions={<div className="actions"><Tag tone="green">有效观察 {stats.count}</Tag>{!legacy&&<select aria-label="IC 类型" value={icType} onChange={e=>setICType(e.target.value)}><option value="ic">Pearson IC</option><option value="rank_ic">Spearman RankIC</option></select>}</div>}><ICPlot rows={a.ic.daily} field={icType} cumulative={icType==='ic'?'cumulative_ic':'cumulative_rank_ic'} original={legacy}/><div className="evidence-caption">累计线使用右轴，不是累计收益。{legacy?'原文件只有一列 IC；原脚本默认 Spearman，但旧记录未冻结方法，不冒称独立 Pearson/RankIC。':'IC 与 RankIC 均由同日因子与未来持有期收益实际配对计算。'}</div></Panel>
    <div className="evidence-two"><Panel title="滚动 IC · 20 / 60 日"><TimeChart data={a.ic.daily} keys={[`${icType}_rolling_20`,`${icType}_rolling_60`]} percent/></Panel><Panel title="IC 分布"><BarPlot rows={(a.ic.distribution[icType]||[]).map((r:RecordData)=>({...r,label:`${r.lower.toFixed(1)}`}))} value="count" label="观察数"/></Panel></div>
    <Panel title={`分组累计净值 · ${a.groups.count} 组`} description={legacy?'G1 因子值最低，G10 最高；保留原始累计收益 + 1，未重写历史分组。':a.groups.return_basis||'组成员在信号日确定；未来报价缺失不重选成员；毛价格收益，不是策略费后净值。'} actions={<Tag tone="purple">{a.groups.source==='original_0933_csv'?'原始历史 CSV':'实际分组计算'}</Tag>}><TimeChart data={a.groups.curves} keys={[...keys,...(a.groups.curves.some((r:RecordData)=>finite(r.LongShort))?['LongShort']:[])]}/>{a.groups.reason&&<p className="evidence-caption">{a.groups.reason}</p>}{a.groups.small_sample_warning&&<p className="evidence-caption">{a.groups.small_sample_warning}</p>}</Panel>
    <div className="evidence-two"><Panel title={legacy?'分组年化收益率 · 零成本':'分组平均持有期收益 · 毛收益'}><BarPlot rows={a.groups.summary.map((r:RecordData)=>({...r,label:r.group}))} value={legacy?'annual_return':'mean_return'} label={legacy?'年化收益率':'平均持有期收益'} percent/></Panel><Panel title="分组平均换手率"><BarPlot rows={a.groups.summary.map((r:RecordData)=>({...r,label:r.group}))} value="mean_turnover" label="平均换手率" percent/><div className="evidence-caption">{a.groups.turnover_definition||a.groups.turnover_reason||'按真实成员与价格漂移权重计算；无原始输入时保持缺失。'}</div></Panel></div>
    <Panel title="分组统计"><DataTable rows={a.groups.summary.map((r:RecordData)=>({组别:r.group,平均收益:fmt(r.mean_return,'percent'),...(legacy?{年化收益:fmt(r.annual_return,'percent'),Sharpe:fmt(r.sharpe),最大回撤:fmt(r.max_drawdown,'percent')}:{累计收益:fmt(r.cumulative_return,'percent')}),平均换手:fmt(r.mean_turnover,'percent'),有效期数:r.observations,缺失期数:r.missing_periods}))}/></Panel>
    <Panel title={legacy?'最高组净值与基准 · 09:33 价格收益':'策略净值与基准 · 费后'} description={`${benchmark.name} · ${benchmark.basis}`}><TimeChart data={a.performance.daily} keys={['nav','benchmark']} labels={{nav:legacy?'最高组净值 · 零成本':'策略净值 · 费后',benchmark:benchmark.name}}/><div className="evidence-caption">{legacy?'IR仅使用最高组与基准同日期的有效收益配对。':'策略净值含任务冻结的佣金、滑点与费税；这里沿用任务冻结的基准。可在完整任务中独立切换对比基准。'}</div></Panel>
    <div className="evidence-two"><Panel title="回撤"><TimeChart data={a.performance.daily} keys={['drawdown']} percent/></Panel><Panel title="换手率时序"><TimeChart data={a.performance.daily} keys={['turnover']} percent/></Panel></div>
    <Panel title={legacy?'最高组月度收益热力图 · 零成本':'策略月度收益热力图 · 费后'}><MonthlyHeatmap rows={a.performance.monthly}/></Panel>
    <Panel title="年度 IC 与收益统计"><DataTable rows={a.performance.yearly.map((r:RecordData)=>{const ic=a.ic.yearly.find((x:RecordData)=>x.period===r.period)?.[icType];return {年份:r.period,收益:fmt(r.return,'percent'),基准收益:fmt(r.benchmark_return,'percent'),IC均值:fmt(ic?.mean,'ic'),ICIR年化:fmt(ic?.icir_annualized),IC正值占比:fmt(ic?.positive_ratio,'percent'),换手率:fmt(r.mean_turnover,'percent'),有效收益期数:r.observations};})}/></Panel>
    <details className="raw-detail"><summary>指标定义、缺失项与数据来源</summary><p>ICIR = IC 均值 / 总体标准差；年化乘 √252。IR = 策略减基准日收益的均值 / 总体标准差 × √252。两者不同，重叠持有期的 ICIR 不代表显著性。</p><JsonView value={{unavailable:a.unavailable,limitations:a.limitations,metric_definitions:a.performance.definitions,ic_definitions:a.ic.definitions,provenance:result.provenance,benchmark_source:result.benchmark_source}}/></details>
  </div>;
}

export function FactorResearch({factor}: {factor:RecordData}) {
  const runs=useApi<Run[]>('/runs'), [selected,setSelected]=useState('');
  const matching=(runs.data||[]).filter(r=>r.kind==='factor'&&r.config?.factor_versions?.length===1&&r.config.factor_versions[0].id===factor.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const relevant=matching.filter(r=>r.status==='completed');
  const latestFailure=matching.find(r=>['failed','interrupted'].includes(r.status)&&r.config.factor_versions[0].version===factor.version&&r.config.factor_versions[0].code_hash===factor.code_hash);
  const current=relevant.find(r=>r.validation_status!=='invalidated'&&r.config.factor_versions[0].version===factor.version&&r.config.factor_versions[0].code_hash===factor.code_hash), chosen=selected||current?.id||(factor.has_history?'original':'');
  const missingFields = isPublicMode ? factor.capability?.missing_public_fields || [] : factor.industry_levels || [];
  const source=useApi<RecordData>(chosen==='original'?`/factors/${factor.id}/history`:chosen?`/runs/${chosen}`:null);
  const benchmark=useApi<RecordData>(chosen==='original'?'/data/benchmark-0933':null);
  const result=useMemo(()=>chosen==='original'&&source.data?legacyEvidence(source.data,benchmark.data):source.data?.result,[source.data,benchmark.data,chosen]);
  const chosenRun=relevant.find(r=>r.id===chosen), version=chosen==='original'?1:chosenRun?.config?.factor_versions?.[0]?.version;
  const invalidated=chosenRun?.validation_status==='invalidated'?chosenRun:source.data?.id===chosen&&source.data?.validation_status==='invalidated'?source.data:!chosen?matching.find(r=>r.validation_status==='invalidated'&&r.config.factor_versions[0].version===factor.version&&r.config.factor_versions[0].code_hash===factor.code_hash):null;
  return <div className="padded evidence-workspace"><div className="evidence-toolbar"><div><h3>研究结果与可视化</h3><p className="muted">每组指标对应明确的定义版本、数据和计算口径。</p></div><div className="actions">{(relevant.length>0||factor.has_history)&&<select aria-label="选择因子研究结果" value={chosen} onChange={e=>setSelected(e.target.value)}>{!chosen&&<option value="" disabled>选择历史版本研究</option>}{factor.has_history&&<option value="original">原始 work 研究 · 09:33 · 原版</option>}{relevant.map(r=><option key={r.id} value={r.id}>{r.validation_status==='invalidated'?'[已作废 · 仅审计] ':''}{r.name} · v{r.config.factor_versions[0].version}</option>)}</select>}{!factor.deleted&&(factor.source_kind==='native_ast'||!isPublicMode&&factor.output_metadata?.exists&&factor.code_hash===factor.original_code_hash)&&<button className="button primary" onClick={()=>go('/research?factor='+factor.id)}><Play size={14}/> {factor.source_kind==="legacy"?"回放原因子值":"新评测"}</button>}</div></div>
    {invalidated&&<div className="research-warnings"><Tag tone="red">已作废 · 仅供审计</Tag><ErrorBox message={invalidated.invalid_reason || '此研究结果已作废，请查看修正后的新任务。'}/><button className="text-button" onClick={()=>go('/runs/'+invalidated.id)}>打开作废任务 <ExternalLink size={13}/></button></div>}
    {latestFailure&&<div className="research-warnings"><p className="muted">当前定义 v{factor.version} · 最近一次{latestFailure.status==='failed'?'失败':'中断'} · {dateTime(latestFailure.created_at)}</p><ErrorBox message={latestFailure.error || latestFailure.message || '任务未能完成，未生成可用研究结果。'}/><button className="text-button" onClick={()=>go('/runs/'+latestFailure.id)}>打开{latestFailure.status==='failed'?'失败':'中断'}任务 <ExternalLink size={13}/></button></div>}
    {version!==undefined&&<div className="evidence-context"><Tag tone={version===factor.version?'green':'amber'}>结果版本 v{version} / 当前定义 v{factor.version}</Tag>{chosenRun&&<span>代码 SHA {chosenRun.config.factor_versions[0].code_hash?.slice(0,12)||"未冻结"}{chosenRun.config.factor_versions[0].code_hash!==factor.code_hash?" · 与当前定义不同":""}</span>}{chosen==='original'?<span>原始研究导入 · 尚未按当前撮合引擎重新验证</span>:<button className="text-button" onClick={()=>go('/runs/'+chosen)}>打开完整任务 <ExternalLink size={13}/></button>}{result&&<button className="text-button" onClick={()=>downloadFile(factor.id+'-research.json',JSON.stringify(source.data),'application/json')}><Download size={13}/> 下载原始结果</button>}</div>}
    {(source.error||runs.error)&&<ErrorBox message={source.error||runs.error} retry={()=>{source.refresh();runs.refresh();}}/>}{benchmark.error&&<p className="muted">同口径基准未载入：{benchmark.error}；IR 保持缺失。</p>}
    {source.loading&&chosen?<Loading/>:result?<EvidencePanels result={result} config={source.data?.config}/>:<Empty title="当前定义尚无有效研究结果" description={missingFields.length?'此公式已经实现；当前计算环境缺少已验证的 '+missingFields.join('、')+'。需选择具备这些真实字段的数据集，不能用模拟数据补图。':'提交评测后，这里展示实际 IC、ICIR、IR、十分组与换手率。没有运行的指标保持空白。'} action={factor.source_kind==='native_ast'&&<button className="button" onClick={()=>go('/research?factor='+factor.id)}>设置真实数据评测</button>}/>}
  </div>;
}
