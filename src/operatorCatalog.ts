/** Serializable directory. Formulas are explicit platform conventions, not inferred paper equations. */
export type OperatorInput = { key: string; label: string; min?: number; max?: number; positive?: boolean };
export type OperatorParameter = { name: string; default: number; min?: number; max?: number; description: string };
export type OperatorDefinition = {
  id: string; name: string; category: string; formula: string; description: string; fields: string; window: string; timing: string;
  source: string; sourceLabel: string; code?: string; parameters?: OperatorParameter[];
  manual?: { expression: string; inputs: OperatorInput[] }; version?: number; custom?: boolean; deleted?: boolean;
};
export const OPERATOR_REFERENCE = 'https://mp.weixin.qq.com/s/iuYu8ggyLND-0j5eOK2Lnw';
const alpha = 'https://arxiv.org/abs/1601.00991';
const dailyTiming = '使用当日收盘后完整可得的数据，最早次日交易；历史窗口含当日，缺失值不前向填补。跨日价格须单独核验复权口径。';
const financialTiming = '输入必须来自分析时点之前实际已公告的报表；不可按报告期回填。仅有公告日期时保守采用公告次日以后。当前为真实手填数值计算，不是财务PIT历史回测。';
const input = (key: string, label: string, limits: Partial<OperatorInput> = {}): OperatorInput => ({ key, label, ...limits });
const entry = (id: string, name: string, category: string, formula: string, description: string, fields: string, code: string, window = '当日', parameters: OperatorParameter[] = []): OperatorDefinition => ({ id, name, category, formula, description, fields, code, window, parameters, timing: dailyTiming, source: OPERATOR_REFERENCE, sourceLabel: '逐鹿Alpha专题（三十）§3.2；公式边界采用平台明确约定' });
const time = (id: string, name: string, formula: string, description: string, expression: string, fields = 'close', min = 1) => entry(id, name, '时序统计', formula, description, fields, `n = 20\nfactor = ${expression}`, 'n 个交易日观测；默认20', [{ name: 'n', default: 20, min, max: 252, description: '历史观测窗口，含当日；完整窗口才能计算' }]);
const financial = (id: string, name: string, formula: string, expression: string, inputs: OperatorInput[], description: string, category = '基本面', source = OPERATOR_REFERENCE, sourceLabel = '逐鹿Alpha专题（三十）§3.2.5 / §3.3.4；平台明确实现'): OperatorDefinition => ({ id, name, category, formula, description, fields: inputs.map(x => x.label).join(' / '), window: '按公式所列财报期、TTM或同日截面', timing: financialTiming, source, sourceLabel, manual: { expression, inputs } });
const money = '金额统一币种、单位、合并范围与会计口径。';
export const OPERATOR_CATALOG: OperatorDefinition[] = [
  entry('neg', '取负 / 方向翻转', '基础组合', '−x', '保持原量纲，仅改变信号方向。', 'close', 'factor = -close'),
  entry('add', '相加', '基础组合', 'x + y', '只相加经济含义和量纲可比较的变量；不把价格与负债率直接相加。', 'close / open', 'factor = close + open'),
  entry('subtract', '相减', '基础组合', 'x − y', '相同量纲的差值，保留原单位。', 'close / open', 'factor = close - open'),
  entry('multiply', '相乘', '基础组合', 'x × y', '输出量纲为两输入量纲乘积；示例为日内收益乘成交额。', 'close / open / amount', 'factor = (close / open - 1) * amount'),
  entry('safe_div', '保护除法', '基础组合', 'x / y；y = 0 → 缺失', '报告只描述“分母保护”；平台不偷偷加epsilon，零分母和非有限结果返回缺失。负分母允许，经济适用域须另行核对。', 'close / open', 'factor = safe_div(close, open)'),
  entry('spread', '归一化差值', '基础组合', '(x − y) / (|x| + |y|)', '这是平台明确约定，并非报告披露的唯一原式。双零返回缺失，输入应同量纲；有限结果在[−1,1]内。', 'close / open', 'factor = spread(close, open)'),
  entry('geom_mean', '几何平均', '基础组合', '√(x × y)，x ≥ 0 且 y ≥ 0', '强调两个非负信号共同较强；任一负数返回缺失，不以绝对值改变符号。零输入允许。', 'close / open', 'factor = geom_mean(close, open)'),
  entry('harm_mean', '调和平均', '基础组合', '2xy / (x + y)，x > 0 且 y > 0', '平台限制两输入严格为正，非正输入返回缺失；对较弱的一端更敏感。', 'close / open', 'factor = harm_mean(close, open)'),
  entry('abs', '绝对值', '基础组合', '|x|', '保持幅度和单位，去除符号。', 'close / open', 'factor = abs(close - open)'),
  entry('log', '自然对数', '基础组合', 'ln(x)，x > 0', '非正输入返回缺失；维度比较时应先构造无量纲比率。', 'volume', 'factor = log(volume)'),
  { ...entry('sign', '符号', '基础组合', 'sign(x) ∈ {−1, 0, 1}', '提取方向；缺失值保持缺失。', 'close / open', 'factor = sign(close - open)'), source: alpha, sourceLabel: '101 Formulaic Alphas · 算子定义' },
  entry('rank', '截面百分位排名', '截面变换', '平均秩(xᵢ,t) / 当日有效样本数', '同日证券截面，并列取平均秩；有效值范围(0,1]。报告未给出并列/缩放细节，此处是平台约定。', 'close；同日证券集合', 'factor = rank(close)'),
  entry('zscore', '截面标准化', '截面变换', '(xᵢ,t − meanₜ(x)) / stdₜ(x)，ddof=0', '使用同日有效截面；零方差返回缺失。不能把单只证券的时序标准化冒充截面Z分数。', 'close；同日证券集合', 'factor = zscore(close)'),
  time('delay', '滞后值', 'x[t−n]', '仅读取过去n个观测的值，不前向引用。', 'delay(close, n)'),
  time('delta', '时序差分', 'x[t] − x[t−n]', '变化量保留原单位；需n+1个观测。', 'close - delay(close, n)'),
  time('ts_pct', '时序变化率', 'x[t] / x[t−n] − 1', '需n+1个观测；前值为零返回缺失。负基值下的经济解释须另行确认。', 'ts_pct(close, n)'),
  time('ts_mean', '滚动均值', 'Σ x[t−n+1:t] / n', '完整n期窗口的算术平均。', 'ts_mean(close, n)'),
  time('ts_std', '滚动标准差', '√mean((x − mean(x))²)，ddof=0', '完整窗口总体标准差；常量序列为0。示例计算日收益波动，非价格标准差。', 'ts_std(returns(close, 1), n)', 'close', 2),
  time('ts_sum', '滚动求和', 'Σ x[t−n+1:t]', '完整窗口累加；示例成交量，不将季度累计财报机械相加。', 'ts_sum(volume, n)', 'volume'),
  time('ts_max', '滚动最大值', 'max(x[t−n+1:t])', '含当日的完整窗口最大值。', 'ts_max(high, n)', 'high'),
  time('ts_min', '滚动最小值', 'min(x[t−n+1:t])', '含当日的完整窗口最小值。', 'ts_min(low, n)', 'low'),
  time('ts_rank', '当前值时序排名', '当前值在完整n期窗口中的1起始平均并列秩', '范围为[1,n]，不归一化；时序排名不是同日截面排名。需要百分位时显式除以n。', 'ts_rank(close, n)'),
  time('ema', '指数移动平均', '有限n期窗口：E₀=x₀；Eₖ=αxₖ+(1−α)Eₖ₋₁，α=2/(n+1)', '每个完整窗口以最旧值初始化，输出窗口末值；含缺失的窗口为空。不是无限历史递推EMA；ema是ts_ema的同义名，此边界是平台约定。', 'ema(close, n)'),
  time('ts_slope', '滚动趋势斜率', 'OLS：x[k] = a + b·k，k=1…n；输出b', '含截距，以窗口内等距观测序号为自变量；单位为x单位/观测。', 'ts_slope(close, n)', 'close', 2),
  time('ts_resi', '滚动趋势残差', 'x[t] − (a + b·n)', '与ts_slope同一OLS模型，输出窗口末点残差，不是窗口残差平均。', 'ts_resi(close, n)', 'close', 2),
  time('ts_rsquare', '滚动趋势拟合优度', '1 − SSE / SST', '与ts_slope同一OLS模型；常量响应SST=0时返回缺失，不强行记1。', 'ts_rsquare(close, n)', 'close', 2),
  { ...time('ts_corr', '滚动相关系数', 'Σ(x−x̄)(y−ȳ) / √(Σ(x−x̄)²Σ(y−ȳ)²)', '完整配对窗口Pearson相关，任一方零方差返回缺失。', 'ts_corr(close, volume, n)', 'close / volume', 2), category: '双变量时序' },
  ...(['ts_beta', 'ts_regression_slope'] as const).map(id => ({ ...time(id, id === 'ts_beta' ? '滚动Beta / 斜率' : '双变量回归斜率', 'OLS：x = a + b·y；b = cov(y,x) / var(y)', '平台约定第一参数x为响应，第二参数y为解释变量，含截距。报告没有明确回归方向，勿将两者倒置。解释变量零方差返回缺失。', `${id}(close, open, n)`, 'close / open', 2), category: '双变量时序' })),
  { ...time('ts_regression_resi', '双变量回归残差', 'x[t] − (a + b·y[t])，回归x对y', '完整配对窗口、含截距，输出末点残差。', 'ts_regression_resi(close, open, n)', 'close / open', 2), category: '双变量时序' },
  { ...time('ts_regression_rsquare', '双变量回归拟合优度', '1 − SSE / SST，回归x对y', '完整配对窗口、含截距；解释变量零方差时回归不可识别，响应零方差时R²未定义，均返回缺失。', 'ts_regression_rsquare(close, open, n)', 'close / open', 2), category: '双变量时序' },
  { ...entry('alpha101', 'Alpha101 · #101', '量价模板', '(close − open) / (high − low + 0.001)', '论文附录#101原式；固定0.001来自原式，不宣称在当前股票池有效。', 'open / high / low / close', 'factor = (close - open) / ((high - low) + 0.001)'), source: alpha, sourceLabel: 'Kakushadze · 101 Formulaic Alphas，附录#101' },
  financial('bm', '账面市值比 B/M', 'book_equity / market_equity', 'safe_div(book, market)', [input('book', '上财年账面权益', { min: 0 }), input('market', '上年12月末权益市值', { positive: true })], '负账面权益单独分类。'+money, '基本面', 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_form_btm.html', 'Kenneth French · Book-to-Market'),
  financial('ep', '盈利收益率 E/P', 'earnings / market_equity', 'safe_div(earnings, market)', [input('earnings', '指定期间盈利'), input('market', '匹配时点权益市值', { positive: true })], '允许负盈利；分母要求正市值。'+money, '基本面', 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/int_country_port_formed.html', 'Kenneth French · International valuation portfolios'),
  financial('dp', '股息收益率 D/P', '已支付股息12m / 期末权益市值', 'safe_div(dividend, market)', [input('dividend', '过去12个月已支付股息总额', { min: 0 }), input('market', '期末权益市值', { positive: true })], '不含未实施预案；总额与总市值需相同股数口径。', '基本面', 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_port_form_dp.html', 'Kenneth French · Dividend Yield；总额口径实现'),
  financial('op', '经营盈利能力 OP', '(revenue − COGS − interest − SG&A) / book_equity', 'safe_div(revenue - cogs - interest - sga, book)', [input('revenue','年度收入'),input('cogs','年度销售成本'),input('interest','年度利息费用'),input('sga','年度销售及管理费用'),input('book','财年末账面权益',{positive:true})], '费用分类须与会计口径核对。'+money, '基本面', 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/tw_5_ports_op_inv.html', 'Kenneth French · Operating Profitability'),
  financial('investment', '资产增长 INV', '(assets[t] − assets[t−1]) / assets[t−1]', 'safe_div(assets - previous, previous)', [input('assets','本财年末总资产'),input('previous','上财年末总资产',{positive:true})], '同口径相邻两财年资产增长，不能用日频滞后替代财报期。', '基本面', 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/tw_5_ports_op_inv.html', 'Kenneth French · Investment'),
  financial('gpa', '毛利润资产比 GP/A', '(revenue − COGS) / assets', 'safe_div(revenue - cogs, assets)', [input('revenue','年度收入'),input('cogs','年度销售成本'),input('assets','同财年末总资产',{positive:true})], '毛利润除期末资产，非净利润率。'+money, '基本面', 'https://www.nber.org/papers/w15940', 'Novy-Marx · NBER 15940 / JFE 2013'),
  financial('yoy', '财务同比变化', '(当期值 − 去年同期值) / |去年同期值|', 'safe_div(current - prior, abs(prior))', [input('current','当前同口径报告期值'),input('prior','去年同期同口径值')], '报告只说明同比变化；平台采用绝对值基期分母，使负基值改善方向可读。零基期返回缺失，非简单x/lag−1。'),
  financial('qoq', '财务环比变化', '(本季度值 − 上季度值) / |上季度值|', 'safe_div(current - prior, abs(prior))', [input('current','本季度单季值'),input('prior','上季度单季值')], '先把累计报表转换为同口径单季度值；平台采用绝对值基期分母，零基期返回缺失。'),
  financial('ttm', '单季度口径 TTM', 'q[t] + q[t−1] + q[t−2] + q[t−3]', 'q0 + q1 + q2 + q3', [input('q0','最近一个已披露单季度流量'),input('q1','前1季度单季流量'),input('q2','前2季度单季流量'),input('q3','前3季度单季流量')], '仅用于四个连续单季度的收入/利润/现金流等流量。不能把资产负债表余额或年初累计值直接求和。'),
  financial('ttm_ytd', '累计报表转 TTM', '上年全年值 + 本年累计值 − 上年同期累计值', 'annual + current_ytd - prior_ytd', [input('annual','最近完整财年流量'),input('current_ytd','本年截至报告期累计流量'),input('prior_ytd','上年相同报告期累计流量')], '平台财务口径补充；三个输入须同科目、同合并范围，当前报告期已披露。'),
  financial('cash_profit', '现金流利润覆盖', '经营现金流TTM / 净利润TTM', 'safe_div(cfo, profit)', [input('cfo','经营活动现金流量净额TTM'),input('profit','同期间净利润TTM')], '报告现金流质量主题的平台明确示例；负利润会改变比率解释，零利润不可算。'+money, '基本面交叉'),
  financial('cash_debt', '现金流债务覆盖', '经营现金流TTM / 期末有息债务', 'safe_div(cfo, debt)', [input('cfo','经营活动现金流量净额TTM'),input('debt','匹配时点有息债务',{positive:true})], '债务包含项须记录一致；这是研究模板，不是统一行业偿债评级。'+money, '基本面交叉'),
  financial('capex_revenue', '资本开支强度', '资本开支TTM / 营业收入TTM', 'safe_div(capex, revenue)', [input('capex','按正支出金额口径的资本开支TTM',{min:0}),input('revenue','营业收入TTM',{positive:true})], '报告资本纪律主题的平台模板；资本开支科目与费用不能混淆。'+money, '基本面交叉'),
  financial('asset_turnover', '资产周转率', '营业收入TTM / ((期初资产 + 期末资产)/2)', 'safe_div(revenue, (assets_begin + assets_end) / 2)', [input('revenue','营业收入TTM'),input('assets_begin','对应期间期初总资产',{positive:true}),input('assets_end','对应期间期末总资产',{positive:true})], '以平均资产为分母的明确平台口径；须核验期间对应，不套用不同行业。', '基本面交叉'),
  financial('cash_capex_spread', '现金流与投入归一差', '(CFO − CapEx) / (|CFO| + |CapEx|)', 'spread(cfo, capex)', [input('cfo','经营现金流TTM'),input('capex','正支出资本开支TTM',{min:0})], '将报告稳健组合与资本纪律主题组合的本平台示例，非报告披露的原式。'+money, '基本面交叉'),
  financial('mixed_rd_amount', '研发强度 × 市场关注', 'zscore(rd_expense_intensity) − zscore(amount)', 'rd_z - amount_z', [input('rd_z','同日同股票池研发强度截面Z分数'),input('amount_z','同日同股票池成交额截面Z分数')], 'HTML §4.1明确可读原式。这里只对你提供的两个真实截面Z分数求差；未接入财务PIT，不复制报告业绩。', '基本面交叉', OPERATOR_REFERENCE, '逐鹿Alpha专题（三十）§4.1 因子一原式'),
  financial('quality_confirm_geom', '质量与市场确认 · 几何组合', '√(基本面质量分位 × 市场确认分位)', 'geom_mean(quality_rank, market_rank)', [input('quality_rank','同日同股票池质量百分位',{min:0,max:1}),input('market_rank','同日同股票池市场确认百分位',{min:0,max:1})], '报告混合框架的平台模板；两个分位须已按真实截面计算，不能输入原始财务金额。', '基本面交叉'),
  financial('quality_confirm_harm', '质量与市场确认 · 调和组合', '2qp / (q+p)，q>0且p>0', 'harm_mean(quality_rank, market_rank)', [input('quality_rank','质量百分位',{positive:true,max:1}),input('market_rank','市场确认百分位',{positive:true,max:1})], '报告调和组合思想的平台模板；强调两腿同时成立，不是论文已验证因子。', '基本面交叉'),
  financial('mixed_quality_penalty', '基本面 + 确认 − 风险', '基本面Z分数 + 市场确认Z分数 − 风险Z分数', 'fundamental_z + market_z - risk_z', [input('fundamental_z','同日基本面截面Z分数'),input('market_z','同日市场确认截面Z分数'),input('risk_z','同日风险惩罚截面Z分数')], '对报告§3.3.4“基本面主线+市场确认+风险过滤”思想的等权平台示例；非图片公式复刻，不宣称有效性。', '基本面交叉'),
];
