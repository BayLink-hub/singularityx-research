/* Synthetic panels below test mathematics and causality only; no investment-performance claims. */
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('../node_modules/typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const language=require('../src/factorLanguage.ts'),engine=require('../src/browserEngine.ts');
const catalogue=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/research/alpha101.json'),'utf8'));
const col=x=>x.map(v=>[v]),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const output=(formula,values,extra={})=>language.evaluateCode('factor = '+formula,{close:col(values),...extra}).map(x=>x[0]);
function completePanel(n=320,m=12){
 const f=Object.fromEntries(['open','high','low','close','volume','amount','vwap','cap','sector','industry','subindustry'].map(k=>[k,[]]));
 for(let i=0;i<n;i++){const r=Object.fromEntries(Object.keys(f).map(k=>[k,[]]));for(let j=0;j<m;j++){const close=30+0.03*i+5*Math.sin(i*0.13+j*0.4)+2*Math.sin(i*1.7+j*0.6)+j*0.3,open=close*(1+0.02*Math.sin(i*0.21+j)),high=Math.max(close,open)+0.5+0.1*Math.cos(i+j),low=Math.min(close,open)-0.4-0.1*Math.sin(i+j),volume=1200+20*j+4*i+600*Math.sin(i*0.19+j)+300*Math.cos(i*1.1+j*0.7);for(const [k,v] of Object.entries({close,open,high,low,volume,vwap:(close+open)/2+0.05*Math.sin(i),amount:volume*((close+open)/2+0.05*Math.sin(i)),cap:close*(1e7+j*1e6),sector:'S'+j%2,industry:'I'+j%3,subindustry:'D'+j%4}))r[k].push(v);}for(const k of Object.keys(f))f[k].push(r[k]);}return f;
}

test('all 101 original definitions have complete canonical ASTs, hashes, dependencies and capability status',()=>{
 assert.equal(catalogue.factors.length,101);assert.deepEqual(catalogue.factors.map(x=>x.number),Array.from({length:101},(_,i)=>i+1));
 for(const f of catalogue.factors){assert.ok(f.original_formula.length>15);const parsed=language.validateCode(f.code);assert.equal(parsed.valid,true,`#${f.number}: ${parsed.errors}`);assert.deepEqual(parsed.ast,f.ast);assert.deepEqual(parsed.dependencies,f.required_fields);assert.deepEqual(language.validateCode(parsed.code).ast,JSON.parse(JSON.stringify(f.ast)));assert.equal(f.code_hash,crypto.createHash('sha256').update(f.code).digest('hex'));assert.ok(f.warmup_days<=252);assert.equal(f.metrics,null);assert.equal(f.capability.public_sample_executable,f.capability.missing_public_fields.length===0);}
 assert.equal(catalogue.capability_summary.public_executable,39);assert.equal(catalogue.capability_summary.max_warmup,251);
 const f29=catalogue.factors[28];assert.ok(f29.steps.some(x=>x.operation==='ts_min'&&x.window===5));
 for(const n of [71,73,76,77,82,87,88,92,96])assert.ok(catalogue.factors[n-1].implementation_notes.some(x=>x.includes('歧义')));
 assert.equal(catalogue.factors[57].window_conversions[0].effective,3);
});

test('all 101 evaluate on complete synthetic input, retain undefined windows and reject future information',()=>{
 const panel=completePanel(),changed=structuredClone(panel),boundary=280;
 for(const [name,rows] of Object.entries(changed))for(let i=boundary;i<rows.length;i++)rows[i]=rows[i].map((v,j)=>typeof v==='number'?v*(2+j*0.01)+i:'CHANGED'+j%2);
 const undefinedFormulas=[];for(const f of catalogue.factors){const a=language.evaluateCode(f.code,panel,f.ast),b=language.evaluateCode(f.code,changed,f.ast);assert.equal(a.length,320);assert.ok(a.every(row=>row.every(v=>Number.isFinite(v)||Number.isNaN(v))));if(!a.some(row=>row.some(Number.isFinite)))undefinedFormulas.push(f.number);assert.deepEqual(a.slice(0,boundary),b.slice(0,boundary),`#${f.number} leaks future values`);}
 // #96/#97 nested short-rank correlations have undefined constant windows in this fixture.
 // Complete raw inputs do not justify filling undefined statistical operations.
 assert.deepEqual(undefinedFormulas,[96,97]);
});

test('actual public capability matrix runs 39 supported formulas; 62 never receive substitute data',()=>{
 const market=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/research/public-market.json'),'utf8')),{frames}=engine.marketFrames(market);
 for(const f of catalogue.factors){if(f.capability.public_sample_executable){const x=language.evaluateCode(f.code,frames,f.ast);assert.equal(x.length,484);assert.ok(x.some(row=>row.some(Number.isFinite)),`public #${f.number} no finite observations`);}else assert.throws(()=>language.evaluateCode(f.code,frames,f.ast),/缺失|为空/,`#${f.number}`);}
 assert.throws(()=>language.evaluateCode('factor = adv(20)',frames),/完全缺失/);
 assert.deepEqual(language.validateCode('factor = adv20').dependencies,['amount']);
});

test('rolling operators obey hand-calculated values, ties, missing data, windows and finite EMA',()=>{
 const v=[1,3,3,2];assert.equal(output('ts_rank(close, 3)',v).at(-1),1);near(output('ts_rank(close, 3)',[1,3,3]).at(-1),2.5);
 near(output('ts_pct(close, 2)',v).at(-1),2/3-1);assert.equal(language.validateCode('factor = ts_pct(close, 20)').warmup_days,20);
 assert.equal(output('ts_argmax(close, 3)',v).at(-1),1);assert.equal(output('ts_argmin(close, 3)',v).at(-1),3);
 near(output('decay_linear(close, 3)',[1,2,4]).at(-1),17/6);assert.equal(output('ts_product(close, 3)',[2,3,4]).at(-1),24);
 near(output('ts_std(close, 3)',[1,2,3]).at(-1),Math.sqrt(2/3));near(output('ts_ema(close, 3)',[1,2,4]).at(-1),2.75);near(output('ema(close, 3)',[1,2,4]).at(-1),2.75);
 assert.ok(output('ts_mean(close, 3)',[1,NaN,3]).every(Number.isNaN));assert.ok(output('ts_product(close, 3)',[1e200,1e200,1e200]).every(Number.isNaN));
 for(const op of ['delay','returns','delta','ts_mean','ts_std','ts_sum','ts_min','ts_max','ts_rank','ts_pct','ts_argmax','ts_argmin','decay_linear','ts_product','ts_ema','ts_slope','ts_resi','ts_rsquare']){assert.equal(language.validateCode(`factor = ${op}(close, -1)`).valid,false,op);assert.equal(language.validateCode(`factor = ${op}(close, 253)`).valid,false,op);assert.equal(language.validateCode(`factor = ${op}(close, 1.9)`).valid,false,op);}
 assert.equal(language.validateCode('factor = delay(ts_mean(close,252),1)').valid,true);assert.equal(language.validateCode('factor = delay(ts_mean(close,252),2)').valid,false);
});

test('cross-section, arithmetic, groups, logic and power follow explicit boundary conventions',()=>{
 const frames={close:[[1,3,3,NaN]],sector:[['a','a','b',null]]};assert.deepEqual(language.evaluateCode('factor = rank(close)',frames)[0],[1/3,2.5/3,2.5/3,NaN]);assert.deepEqual(language.evaluateCode('factor = indneutralize(close,sector)',frames)[0],[-1,1,0,NaN]);
 near(language.evaluateCode('factor = scale(close)',frames)[0][0],1/7);assert.ok(language.evaluateCode('factor = scale(close)',{close:[[0,0]]})[0].every(Number.isNaN));
 assert.deepEqual(language.evaluateCode('factor = where(close > 1, close, -1)',frames)[0],[-1,3,3,NaN]);
 assert.deepEqual(language.evaluateCode('factor = (close > 1) * -1',frames)[0],[-0,-1,-1,NaN]);
 assert.deepEqual(language.evaluateCode('factor = (close > 1) ? close : 0',frames)[0],[0,3,3,NaN]);
 assert.equal(output('signed_power(close,2)',[-2])[0],4);assert.ok(Number.isNaN(output('power(close,0.5)',[-2])[0]));assert.equal(output('close ^ 3',[-2])[0],-8);
 assert.ok(Number.isNaN(output('close / close',[0])[0]));assert.ok(Number.isNaN(output('log(close)',[-1])[0]));assert.ok(Number.isNaN(language.evaluateCode('factor = close',{close:[[null,1]]})[0][0]));
 assert.throws(()=>language.evaluateCode('factor = indneutralize(close,sector)',{close:[[1,2]],sector:[[null,null]]}),/完全缺失/);
 assert.equal(language.validateCode('factor = close + industry').valid,false);for(const expression of ['close ** 10000000','power(close,1001)','signed_power(close,-1001)'])assert.equal(language.validateCode('factor = '+expression).valid,false);
});

test('OLS, covariance and safe manual scalar formulas match independent hand calculations',()=>{
 const v=[3,5,7],x={volume:col([1,2,3])};near(output('ts_cov(close,volume,3)',v,x).at(-1),2);near(output('ts_corr(close,volume,3)',v,x).at(-1),1);
 for(const op of ['ts_beta','ts_regression_slope'])near(output(`${op}(close,volume,3)`,v,x).at(-1),2);
 near(output('ts_regression_resi(close,volume,3)',v,x).at(-1),0);near(output('ts_regression_rsquare(close,volume,3)',v,x).at(-1),1);
 near(output('ts_slope(close,3)',v).at(-1),2);near(output('ts_resi(close,3)',v).at(-1),0);near(output('ts_rsquare(close,3)',v).at(-1),1);
 assert.ok(output('ts_rsquare(close,3)',[1,1,1]).every(Number.isNaN));
 const constantDecimal=Array(20).fill(0.1),varying=Array.from({length:20},(_,i)=>i+1);
 assert.ok(output('ts_rsquare(close,20)',constantDecimal).every(Number.isNaN));
 assert.equal(output('ts_slope(close,20)',constantDecimal).at(-1),0);
 assert.equal(output('ts_resi(close,20)',constantDecimal).at(-1),0);
 for(const op of ['ts_beta','ts_regression_slope','ts_regression_resi','ts_regression_rsquare'])assert.ok(output(`${op}(close,volume,20)`,varying,{volume:col(constantDecimal)}).every(Number.isNaN));assert.ok(output('ts_beta(close,volume,3)',v,{volume:col([1,1,1])}).every(Number.isNaN));
 near(language.evaluateScalar('safe_div(a-b,b)',{a:120,b:100}),0.2);near(language.evaluateScalar('spread(a,b)',{a:3,b:1}),0.5);near(language.evaluateScalar('geom_mean(a,b)',{a:4,b:9}),6);near(language.evaluateScalar('harm_mean(a,b)',{a:2,b:6}),3);
 assert.ok(Number.isNaN(language.evaluateScalar('log(x-1)',{x:1})));assert.ok(Number.isNaN(language.evaluateScalar('safe_div(a,b)',{a:1,b:0})));
 for(const expr of ['eval(x)','Function(x)','x.constructor','x[0]','ts_mean(x,3)','rank(x)','unknown+1'])assert.throws(()=>language.evaluateScalar(expr,{x:1}),undefined,expr);
 assert.equal(language.evaluateScalar('(-2)^2',{}),4);assert.equal(language.evaluateScalar('-2^2',{}),-4);assert.equal(language.evaluateScalar('2^3^2',{}),512);
});

test('all 39 published actual cases preserve hashes, fixed protocols, missing results and independent cash/position/NAV replay',()=>{
 const base=path.join(__dirname,'../public/research'),raw=fs.readFileSync(path.join(base,'public-market.json')),market=JSON.parse(raw),index=JSON.parse(fs.readFileSync(path.join(base,'alpha101-runs.json'))),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
 assert.equal(index.data_sha256,hash(raw));assert.equal(index.runs.length,39);assert.equal(index.blocked.length,62);
 for(const [file,expected] of Object.entries(index.source_hashes))assert.equal(hash(fs.readFileSync(path.join(__dirname,'../src',file+'.ts'))),expected);
 const dates=[...new Set(market.bars.map(x=>x.date))].sort(),rows=new Map(market.bars.map(x=>[x.date+'|'+x.symbol,x]));let trades=0,days=0,negative=0;
 for(const summary of index.runs){const bytes=fs.readFileSync(path.join(__dirname,'../public',summary.published_run_url));assert.equal(hash(bytes),summary.file_sha256);const payload=JSON.parse(bytes),r=payload.run,c=r.config;
  assert.equal(r.id,summary.id);assert.equal(r.status,'completed');assert.equal(c.quantiles,10);assert.equal(c.start_date,'2024-01-01');assert.equal(c.end_date,'2024-12-31');for(const [key,value] of Object.entries(index.protocol))assert.equal(c[key],value,key);
  assert.equal(c.factor_versions[0].code_hash,summary.code_hash);assert.deepEqual(payload.source_hashes,index.source_hashes);assert.ok(r.result.analytics);assert.equal(r.result.analytics.groups.count,10);
  const dailyTrades=new Map();for(const t of r.result.trades)dailyTrades.set(t.date,[...(dailyTrades.get(t.date)||[]),t]);let cash=c.initial_cash;const held=new Map();let fees=0,slippage=0;
  for(const point of r.result.curves){for(const t of dailyTrades.get(point.date)||[]){const quote=rows.get(t.date+'|'+t.ts_code),prior=dates[dates.indexOf(t.date)-1],before=rows.get(prior+'|'+t.ts_code),buy=t.side==='买入';assert.equal(t.signal_date,prior);assert.equal(t.quantity%100,0);assert.ok(t.quantity<=Math.floor(before.volume*c.max_participation/100)*100);near(t.raw_open,quote.open);near(t.price,quote.open*(1+(buy?1:-1)*c.slippage_bps/10000));
    const gross=t.quantity*t.price,fee=Math.max(c.min_commission,gross*c.commission_bps/10000)+gross*c.transfer_fee_bps/10000+(buy?0:gross*c.stamp_tax_bps/10000);assert.ok(Math.abs(fee-t.fees)<1e-7);if(!buy)assert.ok((held.get(t.ts_code)||0)>=t.quantity);held.set(t.ts_code,(held.get(t.ts_code)||0)+(buy?1:-1)*t.quantity);cash+=(buy?-gross:gross)-fee;assert.ok(cash>=-1e-7);assert.ok(Math.abs(cash-t.cash_after)<1e-6);fees+=fee;slippage+=Math.abs(t.price-quote.open)*t.quantity;trades++;}
   const equity=cash+[...held].reduce((sum,[symbol,quantity])=>sum+quantity*rows.get(point.date+'|'+symbol).close,0);assert.ok(Math.abs(equity/c.initial_cash-point.nav)<1e-10);assert.ok(Math.abs(cash-point.cash)<1e-6);days++;}
  assert.ok(Math.abs(fees-r.metrics.total_fees)<1e-7);assert.ok(Math.abs(slippage-r.metrics.total_slippage)<1e-7);if(r.metrics.total_return<0)negative++;
 }
 assert.ok(negative>0,'Negative cases must remain in the full batch');assert.ok(trades>7000);assert.equal(days,39*242);
 const undefinedIC=index.runs.find(x=>x.factor_id==='alpha101_015');assert.equal(undefinedIC.metrics.ic_mean,null);assert.equal(undefinedIC.metrics.ic_observations,0);
});
