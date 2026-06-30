/**
 * Serenity 评分引擎 v1.1 — 浏览器端 JavaScript 版
 * ==================================================
 * 8正向维度 (0-5分) + 8惩罚维度 (0-5分)，含产业链分析模板。
 * 从 serenity_batch_score.py 1:1 翻译。
 *
 * 用法:
 *   const result = Serenity.scoreStock(stock);
 *   // stock: { code, name, ratio, peTTM, price, sectors: [], isAiConcept }
 *   // result: { score, verdict, dimensions, analysis, flags, summary }
 */

const Serenity = (() => {
  'use strict';

  // ─── 维度权重定义 ───
  const POSITIVE_WEIGHTS = {
    demand_inflection: 15,
    chokepoint_severity: 15,
    evidence_quality: 15,
    supplier_concentration: 12,
    expansion_difficulty: 12,
    valuation_disconnect: 11,
    architecture_coupling: 10,
    catalyst_timing: 10,
  };

  const PENALTY_LABELS = {
    dilution_financing: '稀释/融资',
    governance: '公司治理',
    geopolitics: '地缘政治',
    liquidity: '流动性',
    hype_risk: '炒作风险',
    accounting_quality: '会计质量',
    cyclicality: '周期性',
    alternative_design_risk: '替代方案',
  };

  // ─── 板块深度分析模板 ───
  const SECTOR_ANALYSIS = {
    'CPO概念': {
      chain_position: '光通信产业链中上游，共封装光学(CPO)技术方案的核心参与者，介于光芯片/光模块与交换机/服务器之间',
      competitive_moat: 'CPO技术壁垒极高：光引擎设计+先进封装+散热+测试，仅少数企业掌握。量产后先发优势显著，客户粘性强',
      demand_driver: 'AI算力集群对带宽/功耗的极致需求（800G/1.6T光互联），NVIDIA/Google/微软等巨头推动CPO从demo走向量产',
      risk_factors: [
        '技术成熟度：CPO量产良率仍低，2026-2027为关键窗口期',
        '客户集中：核心客户为少数头部交换机/云厂商，议价权受限',
        '替代方案：线性驱动可插拔(LPO)作为折中方案仍在演进',
        '估值泡沫：市场对CPO预期已大幅定价，任何延迟都将重创股价',
      ],
      catalyst: '2026H2行业龙头CPO产品送样/量产公告是核心催化剂',
      valuation_note: 'PE(TTM)偏高反映市场对CPO放量预期，需验证收入能否兑现',
    },
    '光通信': {
      chain_position: '光通信产业链中游，涵盖光模块/光器件/光纤光缆，是AI数据中心互联的核心物理层',
      competitive_moat: '800G/1.6T光模块技术迭代快，龙头先发优势+客户认证壁垒高，二线厂商追赶需2-3年',
      demand_driver: 'AI训练集群Scale-up互联+Scale-out网络拉动高速光模块需求爆发，2026年800G渗透率加速提升',
      risk_factors: [
        '价格战：光模块行业历来价格年降15-20%，规模效应是关键',
        '芯片供应：DSP/EML激光器芯片受制于海外供应商，断供风险',
        '技术替代：硅光/薄膜铌酸锂对传统InP方案的冲击',
      ],
      catalyst: '季度财报中光模块出货量及毛利率环比变化',
      valuation_note: '龙头已享受AI溢价，关注估值与增速匹配度(PEG)',
    },
    '存储芯片': {
      chain_position: '存储芯片设计/制造/封测环节，NAND/DRAM/HBM为主要品类，属于半导体成熟制程但资本密集',
      competitive_moat: 'HBM领域SK海力士/三星垄断，国产在NAND/NOR Flash有替代机会。3D NAND层数竞赛持续，资本壁垒极高',
      demand_driver: 'AI服务器HBM需求暴增+端侧AI带动LPDDR/NAND需求+存储周期底部回升三重驱动',
      risk_factors: [
        '强周期：存储价格波动大，下行周期利润可能转负',
        '技术代差：国产NAND与国际龙头层数差距约1-2代',
        '设备断供：美国对华半导体设备限制持续升级',
        '巨量产能：合肥/武汉存储基地大量扩产可能导致供给过剩',
      ],
      catalyst: '存储现货价格周度数据，龙头厂商减产/扩产公告',
      valuation_note: 'PE(TTM)在周期底部可能极高/负数，需结合PB和周期位置综合判断',
    },
    '液冷服务': {
      chain_position: '数据中心散热产业链，涵盖冷板液冷/浸没液冷/冷却液/CDU等子系统，是AI算力密度提升的刚需配套',
      competitive_moat: '冷板液冷技术门槛中等但客户认证周期长(1-2年)，已进入头部云厂商供应链的企业有先发优势',
      demand_driver: '单机柜功率从6kW→30kW+，风冷物理极限突破，液冷渗透率从<10%→2028年>40%的确定性趋势',
      risk_factors: [
        '技术路线分歧：冷板 vs 浸没路线尚未统一，选错路线的公司可能被淘汰',
        '标准化缺失：液冷接口/工质标准仍在制定中，行业碎片化',
        '供应链：冷却液(氟化液)受环保法规限制，3M停产带来缺口',
      ],
      catalyst: 'NVIDIA GB300/下一代GPU液冷方案发布，互联网大厂液冷POC转向批量部署',
      valuation_note: '液冷处于渗透率早期，高成长可给予估值溢价，关注交付确认和毛利率趋势',
    },
    'PCB概念': {
      chain_position: '印制电路板上游材料/中游制造/下游应用，AI相关主要是高多层/HDI/封装基板',
      competitive_moat: 'AI服务器用20+层高速PCB技术壁垒高，认证周期长，龙头市占率提升趋势明确',
      demand_driver: 'AI服务器PCB价值量是传统服务器的5-8倍，交换机升级800G带动更高端需求',
      risk_factors: [
        '产能过剩：国内PCB行业产能扩张过快，普通板竞争激烈',
        '原材料波动：铜箔/树脂/玻纤布价格影响毛利率',
        '技术升级：封装基板(ABF/BT)向更高层数演进，追赶难度大',
      ],
      catalyst: '季度产能利用率及高端板占比变化，新客户认证突破',
      valuation_note: 'AI PCB处于量价齐升通道，关注高端化进度和海外产能布局',
    },
    '先进封装': {
      chain_position: '半导体后道环节，涵盖CoWoS/3D IC/Chiplet/FC-BGA等，是延续摩尔定律的关键路径',
      competitive_moat: 'CoWoS产能被台积电垄断，国内在FC-BGA/SiP等方向追赶。先进封装设备(临时键合/解键合)是国产替代稀缺环节',
      demand_driver: 'NVIDIA H/B系列GPU高度依赖CoWoS封装，Chiplet趋势下先进封装需求持续超越晶圆产能增长',
      risk_factors: [
        '技术依赖：最先进的CoWoS/HBM封装仍由台积电/三星主导',
        '资本密集：先进封装单线投资10亿美元+，回报周期长',
        '良率爬坡：Chiplet/3D封装良率提升缓慢，影响盈利能力',
      ],
      catalyst: '国内先进封装项目投产公告，Chiplet标准制定进展',
      valuation_note: '先进封装设备/材料环节稀缺性突出，估值可参考全球龙头PS倍数',
    },
    '热管理': {
      chain_position: '电子散热全产业链，涵盖风冷/液冷/石墨烯/均温板/热管/导热材料等，横跨消费电子到数据中心',
      competitive_moat: '高端散热方案(VC均温板/石墨烯散热膜)有工艺壁垒，消费电子散热转向AI服务器散热是能力验证的关键',
      demand_driver: 'AI手机/PC+数据中心双重拉动，单机散热价值量从0.5→2-3美元提升数倍',
      risk_factors: [
        '技术门槛：部分散热技术(热管/风冷)门槛偏低，价格竞争激烈',
        '客户切换成本低：散热厂商替换难度不高，需持续技术创新',
        '与液冷重叠：部分热管理企业液冷业务尚在早期，竞争力不明',
      ],
      catalyst: '苹果/三星AI手机散热方案规格提升，数据中心液冷项目中标',
      valuation_note: '热管理从消费电子向AI基础设施延伸的逻辑待验证，关注新客户拓展',
    },
    '数据中心': {
      chain_position: '算力基础设施最下游，涵盖IDC运营/服务器组装/算力调度等，是AI算力的物理载体',
      competitive_moat: '核心城市IDC资源稀缺(能耗指标+土地)，已锁定资源的运营商有区位壁垒。算力调度/运维是差异化方向',
      demand_driver: 'AI训练推理需求指数级增长，大模型军备竞赛驱动算力基建持续投入',
      risk_factors: [
        '电费/租金成本刚性：IDC主要成本为电力，电价上涨侵蚀利润',
        '供给过剩风险：部分地区IDC建设过热，上架率可能不及预期',
        '技术替代：边缘计算/分布式推理可能分流集中式IDC需求',
      ],
      catalyst: '季度机柜上架率变化，大客户签约(云厂商/AI公司)',
      valuation_note: 'IDC属稳定现金流资产，PE估值中枢15-25x，AI概念IDC溢价需业绩验证',
    },
    '华为算力': {
      chain_position: '国产算力产业链核心，以华为昇腾芯片和生态为轴心，涵盖服务器/PCB/散热/连接器等供应链环节',
      competitive_moat: '华为昇腾是国内唯一能对标NVIDIA的AI训练芯片方案，政策+生态壁垒极高，供应链企业有排他性优势',
      demand_driver: '国产替代政策刚性推动+AI大模型厂商被迫转昇腾生态+运营商/政府集采倾斜',
      risk_factors: [
        '芯片产能：昇腾先进制程产能受限(7nm)，供给瓶颈制约规模',
        '生态差距：CUDA生态统治力强，昇腾迁移成本高/性能损耗大',
        '地缘政治：华为实体清单升级风险，可能进一步限制技术获取',
      ],
      catalyst: '昇腾新品发布(910C/下一代)，政府AI算力采购大单公告',
      valuation_note: '华为供应链标的享受国产替代溢价，需区分实质受益和概念炒作',
    },
    '算力租赁': {
      chain_position: '云计算/GPU算力流通环节，轻资产模式匹配算力供需，是AI创业公司获取算力的主要渠道',
      competitive_moat: '先发卡位GPU资源+客户粘性(训练中迁移成本高)，但行业进入门槛低，竞争格局尚未稳定',
      demand_driver: 'AI创业潮拉动GPU租赁需求，NVIDIA高端卡供不应求导致租赁价格高企',
      risk_factors: [
        '资产贬值：GPU更新迭代快(H100→B200→下一代)，租赁卡贬值速度快',
        '大厂自建：云厂商/大模型公司自建算力将分流租赁需求',
        '价格战：新进入者增加将压低租赁单价，利润率下行',
      ],
      catalyst: '高端GPU到货/上架公告，季度算力出租率数据',
      valuation_note: '算力租赁短期弹性大但长期竞争格局差，高倍数不可持续',
    },
    '东数西算': {
      chain_position: '国家战略级算力布局，引导数据中心向西部(贵州/内蒙古/甘肃/宁夏)迁移，东部聚焦低时延业务',
      competitive_moat: '西部IDC运营享受电费/土地成本优势+政策补贴，但需求端(时延敏感型仍需东部)存在结构性矛盾',
      demand_driver: '政策驱动下运营商/互联网公司逐步将离线计算/存储迁移西部，短期增量有限但长期趋势确定',
      risk_factors: [
        '需求不匹配：西部IDC上架率普遍低于东部，冷热数据分层尚未成熟',
        '网络时延：跨区域数据传输时延限制实时计算应用',
        '政策依赖：一旦补贴退坡，西部IDC经济性将受挑战',
      ],
      catalyst: '国家级算力调度平台上线，西部IDC上架率突破50%',
      valuation_note: '东数西算偏政策主题，需看到实质性上架率/收入增长才能支撑估值',
    },
    '铜缆连接': {
      chain_position: '高速互联连接器/线缆产业链，DAC(直连铜缆)/ACC(有源铜缆)是AI服务器内部短距互联的主流方案',
      competitive_moat: '800G/1.6T DAC技术壁垒高(信号完整性+散热)，全球仅少数连接器巨头掌握。国内企业从配套切入',
      demand_driver: 'AI服务器内部GPU-to-GPU互联距离短(<3m)，DAC成本仅为光模块1/5-1/10，性价比驱动渗透率持续提升',
      risk_factors: [
        '距离限制：DAC随速率提升传输距离缩短，超过3m需转向AOC/光模块',
        '技术迭代：AEC(有源电缆)性价比提升可能挤压DAC份额',
        '客户集中：主要客户为少数服务器ODM/云厂商',
      ],
      catalyst: 'NVIDIA下一代GPU集群互联方案发布，DAC/AEC供应商认证突破',
      valuation_note: '铜缆连接是AI互联中成本最优方案，确定性较高但增速受限于传输距离',
    },
  };

  const DEFAULT_AI_ANALYSIS = {
    chain_position: 'AI产业链相关环节，具体定位需进一步研究',
    competitive_moat: 'AI赛道整体享受需求景气，但个股竞争力差异大，需关注产业链位置和技术壁垒',
    demand_driver: 'AI算力需求增长是行业共同驱动因素，关注公司是否处于供给侧受限环节',
    risk_factors: ['AI相关收入占比可能较低，概念炒作风险需关注', '行业竞争格局可能恶化', '技术路线变更可能导致现有方案被替代'],
    catalyst: '关注公司AI相关业务季度收入增速和客户拓展',
    valuation_note: 'AI概念可能带来估值溢价，需验证基本面对估值的支撑',
  };

  const DEFAULT_NON_AI_ANALYSIS = {
    chain_position: '非AI核心赛道，行业属性与AI关联度较低',
    competitive_moat: '需结合自身行业格局评估竞争力，AI标签可能是偶然关联',
    demand_driver: '主要驱动因素来自自身行业周期，AI间接拉动有限',
    risk_factors: ['与AI产业链关联不紧密，主题退潮后可能回调', '主业景气度是核心变量'],
    catalyst: '关注公司主业经营改善和行业景气度回升',
    valuation_note: '若PE(TTM)/动态PE比值异常高，可能反映盈利低谷而非AI溢价',
  };

  // ─── 维度评分映射 ───
  function dimScoreMap(ratio, peTTM, sectors, isAi) {
    const dims = {
      // 正向维度 (默认 evidence_quality=3, 其余0)
      demand_inflection: 0,
      chokepoint_severity: 0,
      evidence_quality: 3,
      supplier_concentration: 0,
      expansion_difficulty: 0,
      valuation_disconnect: 0,
      architecture_coupling: 0,
      catalyst_timing: 0,
      // 惩罚维度 (含默认值)
      dilution_financing: 0,
      governance: 0,
      geopolitics: 0,
      liquidity: 0,
      hype_risk: 0,
      accounting_quality: 3,
      cyclicality: 2,
      alternative_design_risk: 1,
    };

    // demand_inflection: AI概念 + ratio区间
    if (isAi) {
      dims.demand_inflection = 4;
      if (sectors.some(s => ['CPO概念', '光通信', '先进封装', '存储芯片'].includes(s))) {
        dims.demand_inflection = 5; // AI核心硬件 → 最强需求拐点
      }
    } else {
      dims.demand_inflection = 2;
    }

    // chokepoint_severity: 稀缺板块加分
    const chokeScores = {
      '先进封装': 5, 'CPO概念': 5, '光通信': 4, '存储芯片': 4,
      '铜缆连接': 3, '华为算力': 4, 'PCB概念': 3, '液冷服务': 3, '热管理': 2,
    };
    for (const s of sectors) {
      if (chokeScores[s] !== undefined) {
        dims.chokepoint_severity = Math.max(dims.chokepoint_severity, chokeScores[s]);
      }
    }

    // supplier_concentration: 稀有板块+AI
    if (isAi) {
      dims.supplier_concentration = dims.chokepoint_severity >= 4 ? 3 : 2;
    }

    // expansion_difficulty
    const hardScores = {
      'CPO概念': 5, '先进封装': 5, '存储芯片': 4, '光通信': 3, 'PCB概念': 2,
    };
    for (const s of sectors) {
      if (hardScores[s] !== undefined) {
        dims.expansion_difficulty = Math.max(dims.expansion_difficulty, hardScores[s]);
      }
    }

    // valuation_disconnect: ratio越高越担忧
    if (ratio > 100) {
      dims.valuation_disconnect = 5;
    } else if (ratio > 10) {
      dims.valuation_disconnect = 3;
    } else if (ratio >= 3) {
      dims.valuation_disconnect = 4; // 合理偏高但有机会
    } else {
      dims.valuation_disconnect = 2;
    }

    // architecture_coupling
    const coupledScores = {
      'CPO概念': 5, '光通信': 4, 'PCB概念': 3, '先进封装': 4, '铜缆连接': 4,
    };
    for (const s of sectors) {
      if (coupledScores[s] !== undefined) {
        dims.architecture_coupling = Math.max(dims.architecture_coupling, coupledScores[s]);
      }
    }
    if (isAi) {
      dims.architecture_coupling = Math.max(dims.architecture_coupling, 2);
    }

    // catalyst_timing
    dims.catalyst_timing = isAi ? 4 : 2;

    // Penalties
    if (peTTM > 5000) {
      dims.liquidity = 4;
      dims.hype_risk = 4;
    } else if (peTTM > 1000) {
      dims.liquidity = 2;
      dims.hype_risk = 2;
    }

    if (ratio > 100) {
      dims.hype_risk = 5;
      dims.liquidity = 4;
    }

    const sectorStr = sectors.join(',');
    if (sectorStr.includes('芯片') || sectorStr.includes('半导体')) {
      dims.geopolitics = 3;
      dims.cyclicality = 3;
    }

    if (sectors.includes('存储芯片')) {
      dims.cyclicality = 4;
    }

    return dims;
  }

  // ─── 总分计算 + flags ───
  function calcScoreAndFlags(dims) {
    // pos满分: 5*110 = 550 → 归一化到 0-100
    let posScore = 0;
    for (const [k, w] of Object.entries(POSITIVE_WEIGHTS)) {
      posScore += (dims[k] || 0) * w;
    }

    let penTotal = 0;
    for (const k of Object.keys(PENALTY_LABELS)) {
      penTotal += (dims[k] || 0) * 1.0;
    }

    const posNormalized = (posScore / 550.0) * 100.0;
    const score = Math.max(0, Math.min(100, Math.round(posNormalized - penTotal)));

    let verdict = 'Worth tracking';
    if (score >= 85) verdict = 'Top priority';
    else if (score >= 70) verdict = 'High priority';
    else if (score >= 55) verdict = 'Worth tracking';

    // flags
    const flags = [];
    for (const k of Object.keys(PENALTY_LABELS)) {
      if ((dims[k] || 0) >= 4) {
        flags.push(k);
      }
    }
    if ((dims.demand_inflection || 0) === 5) {
      flags.unshift('demand_surge');
    }

    return { score, verdict, flags };
  }

  // ─── 对外主入口：对单只股票评分 ───
  function scoreStock(stock) {
    const ratio = stock.ratio || 1;
    const peTTM = stock.peTTM || 100;
    const sectors = stock.sectors || [];
    const isAi = stock.isAiConcept || false;
    const name = stock.name || '';

    // 1. 维度拆分
    const dims = dimScoreMap(ratio, peTTM, sectors, isAi);
    const { score, verdict, flags } = calcScoreAndFlags(dims);

    // 2. 产业链分析
    let analysis = null;
    for (const s of sectors) {
      if (SECTOR_ANALYSIS[s]) {
        analysis = Object.assign({}, SECTOR_ANALYSIS[s]);
        break;
      }
    }
    if (!analysis) {
      analysis = Object.assign({}, isAi ? DEFAULT_AI_ANALYSIS : DEFAULT_NON_AI_ANALYSIS);
    }

    // 3. 个性化摘要
    const summaryParts = [];
    summaryParts.push(name + '（' + (sectors[0] || '未分类') + '）');

    if (ratio > 50) {
      summaryParts.push(
        'PE(TTM)/动态PE比值' + ratio.toFixed(0) + 'x极高，主要因当前处于微利或亏损收窄阶段，TTM包含较多亏损季度导致PE(TTM)虚高'
      );
    } else if (ratio > 5) {
      summaryParts.push(
        'PE(TTM)/动态PE比值' + ratio.toFixed(1) + 'x，TTM估值显著高于动态估值，反映最近季度盈利环比改善明显'
      );
    } else if (ratio >= 1.5) {
      summaryParts.push('比值为' + ratio.toFixed(1) + 'x，TTM与动态PE适度偏离，盈利趋势稳中向好');
    } else {
      summaryParts.push('比值为' + ratio.toFixed(1) + 'x，TTM与动态PE基本一致，盈利相对稳定');
    }

    summaryParts.push(analysis.demand_driver);
    if (analysis.risk_factors && analysis.risk_factors.length > 0) {
      summaryParts.push('主要风险：' + analysis.risk_factors[0]);
    }
    summaryParts.push('催化剂：' + (analysis.catalyst || '待跟踪'));

    const summary = summaryParts.join('。') + '。';

    return {
      score: score,
      verdict: verdict,
      dimensions: {
        positive: Object.fromEntries(Object.keys(POSITIVE_WEIGHTS).map(k => [k, dims[k] || 0])),
        penalties: Object.fromEntries(Object.keys(PENALTY_LABELS).map(k => [k, dims[k] || 0])),
      },
      analysis: analysis,
      flags: flags,
      summary: summary,
      method: 'browser_v1.1',
    };
  }

  // ─── 批量评分 ───
  function scoreAll(stocks) {
    return stocks.map(s => {
      s.serenity = scoreStock(s);
      return s;
    });
  }

  // ─── 公共API ───
  return {
    scoreStock,
    scoreAll,
    POSITIVE_WEIGHTS,
    PENALTY_LABELS,
    SECTOR_ANALYSIS,
    // 方便前端展示时用的中文维度名
    dimNames: {
      demand_inflection: '需求拐点',
      chokepoint_severity: '卡脖子/稀缺',
      evidence_quality: '证据质量',
      supplier_concentration: '供应商集中度',
      expansion_difficulty: '扩产难度',
      valuation_disconnect: '估值脱节',
      architecture_coupling: '架构耦合',
      catalyst_timing: '催化剂时机',
    },
    penNames: {
      dilution_financing: '稀释/融资',
      governance: '公司治理',
      geopolitics: '地缘政治',
      liquidity: '流动性',
      hype_risk: '炒作风险',
      accounting_quality: '会计质量',
      cyclicality: '周期性',
      alternative_design_risk: '替代方案',
    },
    MAX_POS_SCORE: 550,
  };
})();

// Node.js/CommonJS 兼容导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Serenity;
}
