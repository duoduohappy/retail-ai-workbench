(function (root) {
  "use strict";
  const C = root.RetailCore,
    D = () => root.RETAIL_DATA;
  const normalize = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/饮品/g, "饮料")
      .replace(/无货/g, "缺货")
      .replace(/跟价/g, "定价");
  const definitions = {
    price: /价格|单价|定价|促销|折扣|活动|竞品|规格|降价/,
    stock: /库存|缺货|补货|可售/,
    member: /会员|复购|客户|顾客|召回|流失|rfm/,
    content: /内容|视频|脚本|素材/,
    business: /销售|经营|毛利|转化|收入|市场/,
  };
  function tokenize(s) {
    const x = normalize(s),
      tokens = x.match(/[a-z0-9_-]{2,}/g) || [];
    for (const chunk of x.match(/[\u4e00-\u9fff]+/g) || [])
      for (let i = 0; i < chunk.length - 1; i++)
        tokens.push(chunk.slice(i, i + 2));
    return tokens;
  }
  function tfidf(query, documents) {
    const tokens = documents.map(tokenize),
      df = {};
    for (const list of tokens)
      for (const t of new Set(list)) df[t] = (df[t] || 0) + 1;
    const vector = (list) => {
      const v = {};
      for (const t of list) if (df[t]) v[t] = (v[t] || 0) + 1;
      for (const t in v)
        v[t] =
          (1 + Math.log(v[t])) *
          (Math.log((documents.length + 1) / (df[t] + 1)) + 1);
      return v;
    };
    const q = vector(tokenize(query)),
      qnorm = Math.sqrt(Object.values(q).reduce((s, n) => s + n * n, 0));
    return tokens.map((list) => {
      const v = vector(list),
        norm = Math.sqrt(Object.values(v).reduce((s, n) => s + n * n, 0));
      return qnorm && norm
        ? Object.keys(q).reduce((s, t) => s + q[t] * (v[t] || 0), 0) /
            (qnorm * norm)
        : 0;
    });
  }
  function research(question, evidence = D().evidence) {
    const q = normalize(question),
      topics = Object.keys(definitions).filter((t) => definitions[t].test(q)),
      specific = topics.filter((t) => t !== "business");
    const scores = tfidf(
      q,
      evidence.map((e) => e.title + " " + e.text),
    );
    const candidates = [],
      excluded = [];
    for (let i = 0; i < evidence.length; i++) {
      const e = evidence[i],
        text = normalize(e.title + " " + e.text),
        matches = (specific.length ? specific : topics).filter((t) =>
          definitions[t].test(text),
        );
      const relevant =
        (topics.length ? matches.length > 0 : false) || scores[i] > 0.13;
      if (!relevant) {
        excluded.push({
          ...e,
          reason: "与当前问题的主题或文本不匹配",
          retrievalScore: +scores[i].toFixed(4),
        });
        continue;
      }
      const status = C.evidenceStatus(e);
      const item = {
        ...e,
        retrievalScore: +(scores[i] + matches.length * 0.15).toFixed(4),
      };
      if (status !== "valid") {
        excluded.push({
          ...item,
          reason: status === "expired" ? "活动已过期" : "发布时间晚于观察时点",
        });
        continue;
      }
      candidates.push(item);
    }
    candidates.sort(
      (a, b) =>
        Number(a.kind === "转载") - Number(b.kind === "转载") ||
        b.retrievalScore - a.retrievalScore,
    );
    const accepted = [],
      seen = new Set();
    for (const e of candidates) {
      const group = e.group || e.id;
      if (seen.has(group)) {
        excluded.push({ ...e, reason: "同一原始信源的重复记录" });
        continue;
      }
      seen.add(group);
      accepted.push(e);
    }
    const region = q.includes("东区")
      ? "东区"
      : q.includes("西区")
        ? "西区"
        : null;
    const store = D().stores.find((s) => q.includes(s.name));
    const days = /近\s*7\s*天|最近一周/.test(q)
      ? 7
      : /近\s*90\s*天/.test(q)
        ? 90
        : 28;
    const ids = store
      ? [store.id]
      : region
        ? D()
            .stores.filter((s) => s.region === region)
            .map((s) => s.id)
        : D().stores.map((s) => s.id);
    const aggregate = (offset) => {
      const xs = ids.map((id) => C.summary(C.range(days, id, offset)));
      return {
        sales: C.sum(xs, (x) => x.sales),
        gross: C.sum(xs, (x) => x.gross),
        orders: C.sum(xs, (x) => x.orders),
        visitors: C.sum(xs, (x) => x.visitors),
      };
    };
    const a = aggregate(0),
      b = aggregate(days),
      scope =
        (store?.name || region || "全门店") + `最近${days}天（该区域全部品类）`,
      change = b.sales ? (a.sales / b.sales - 1) * 100 : 0;
    const sufficient = accepted.length > 0,
      claims = accepted.map((e) => ({
        text: e.text,
        evidence: [e.id],
        type: e.kind === "内部记录" ? "内部事实" : "外部观察",
        synthetic: !!e.synthetic,
      }));
    let hypotheses = [],
      recommendation =
        "请补充与该问题直接相关的原文、发布日期、适用区域与业务数据；当前资料不足，不输出外部事实结论。";
    if (sufficient) {
      if (topics.includes("stock")) {
        hypotheses.push(
          "零库存快照与销售变化可能有关，需核对补货、盘点及营业时段的实际可售率。",
        );
        recommendation =
          "先核查门店实际缺货与补货执行，确认数据准确后，在可比门店评估补货改善的效果。";
      }
      if (topics.includes("price")) {
        hypotheses.push(
          "观察到的竞争价格受规格、活动期与购买门槛影响；价格差不能单独证明销量变化原因。",
        );
        recommendation =
          "核对规格、价格条件与活动期限；比较库存约束下的费用后贡献，再设计范围受控的促销试点。";
      }
      if (!hypotheses.length) {
        hypotheses.push(
          "经营变化的原因尚未被识别，需结合库存、价格、门店执行与对照数据验证。",
        );
        recommendation =
          "确定业务基线与可比范围，核查证据后安排受控试点，并同时观察净毛利与负向指标。";
      }
    }
    return {
      question,
      accepted,
      excluded,
      claims,
      scope,
      topics,
      summary: sufficient
        ? `${scope}净销售额较前一等长周期变化 ${change.toFixed(1)}%。以下仅列出与当前问题匹配且在有效期内的资料；它们不构成因果证明。`
        : "资料不足：当前证据库未找到与该问题直接匹配的有效资料，未生成研究结论。",
      hypotheses,
      recommendation,
      quality: {
        method: "中文双字词TF-IDF + 主题过滤 + 时效检查 + 同源去重",
        retrieved: candidates.length,
        independentSources: accepted.length,
        coverage: sufficient ? "可供人工复核" : "不足以回答",
      },
      limitations:
        "内置外部资料均为模拟证据。用户添加资料未经独立核实；检索仅在本地资料库内执行，不是实时互联网搜索。",
    };
  }
  function sampleSize(p0, p1) {
    if (!(p0 > 0 && p0 < 1 && p1 > 0 && p1 < 1 && p0 !== p1))
      throw new Error("转化率需在0与1之间且两组不同");
    const p = (p0 + p1) / 2;
    return Math.ceil(
      (1.96 * Math.sqrt(2 * p * (1 - p)) +
        0.84 * Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))) **
        2 /
        (p1 - p0) ** 2,
    );
  }
  function assignment(id, salt = "retail-v2") {
    let h = 2166136261;
    for (const c of salt + ":" + String(id)) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 2 ? "treatment" : "control";
  }
  function parseCSV(text) {
    const rows = [],
      row = [];
    let field = "",
      quoted = false;
    const s = String(text).replace(/^\uFEFF/, "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') {
        if (quoted && s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === "," && !quoted) {
        row.push(field);
        field = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && s[i + 1] === "\n") i++;
        row.push(field);
        if (row.some((v) => v !== "")) rows.push(row.splice(0));
        else row.length = 0;
        field = "";
      } else field += c;
    }
    if (quoted) throw new Error("CSV存在未闭合引号");
    row.push(field);
    if (row.some((v) => v !== "")) rows.push(row);
    return rows;
  }
  function experimentRows(csv) {
    const rows = parseCSV(csv);
    if (rows.length < 3) throw new Error("至少需要表头及两行数据");
    const expected = [
        "user_id",
        "group",
        "converted",
        "net_sales",
        "variable_cost",
        "campaign_cost",
      ],
      head = rows.shift().map((x) => x.trim().toLowerCase());
    for (const h of expected)
      if (!head.includes(h)) throw new Error("缺少字段 " + h);
    const seen = new Set();
    return rows.map((row, index) => {
      const v = Object.fromEntries(head.map((h, i) => [h, row[i]?.trim()]));
      if (!v.user_id || seen.has(v.user_id))
        throw new Error(`第${index + 2}行用户ID为空或重复；每名用户只能一行`);
      seen.add(v.user_id);
      if (!["control", "treatment"].includes(v.group))
        throw new Error(`第${index + 2}行组别必须为control或treatment`);
      if (!["0", "1"].includes(v.converted))
        throw new Error(`第${index + 2}行converted必须为0或1`);
      for (const k of ["net_sales", "variable_cost", "campaign_cost"])
        if (
          v[k] === "" ||
          v[k] === undefined ||
          !Number.isFinite(+v[k]) ||
          +v[k] < 0
        )
          throw new Error(`第${index + 2}行${k}不是非负数字`);
      return {
        id: v.user_id,
        group: v.group,
        converted: +v.converted,
        sales: +v.net_sales,
        cost: +v.variable_cost,
        budget: +v.campaign_cost,
      };
    });
  }
  function experimentStats(rows) {
    const summarize = (group) => {
      const xs = rows.filter((x) => x.group === group);
      if (xs.length < 2) throw new Error("每组至少需要2名独立用户");
      const n = xs.length,
        success = C.sum(xs, (x) => x.converted),
        p = success / n,
        contributions = xs.map((x) => x.sales - x.cost - x.budget),
        mean = C.sum(contributions, (x) => x) / n,
        variance = C.sum(contributions, (x) => (x - mean) ** 2) / (n - 1);
      return {
        n,
        success,
        p,
        mean,
        variance,
        total: C.sum(contributions, (x) => x),
        stable: success >= 5 && n - success >= 5,
      };
    };
    const control = summarize("control"),
      treatment = summarize("treatment"),
      diff = treatment.p - control.p,
      se = Math.sqrt(
        (control.p * (1 - control.p)) / control.n +
          (treatment.p * (1 - treatment.p)) / treatment.n,
      ),
      marginDiff = treatment.mean - control.mean,
      marginSE = Math.sqrt(
        control.variance / control.n + treatment.variance / treatment.n,
      );
    return {
      control,
      treatment,
      diff,
      interval: [Math.max(-1, diff - 1.96 * se), Math.min(1, diff + 1.96 * se)],
      marginDiff,
      marginInterval: [
        marginDiff - 1.96 * marginSE,
        marginDiff + 1.96 * marginSE,
      ],
      stable: control.stable && treatment.stable,
      note: "95%区间采用正态近似，假设用户独立；不是因果设计或随机分流成功的证明。重复查看结果会影响固定样本推断，达到预设周期与样本前不据此提前停止。",
    };
  }
  function simulatedExperiment(n = 1200) {
    let seed = 20261123;
    const rand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const rows = [];
    for (const group of ["control", "treatment"])
      for (let i = 0; i < n; i++) {
        const converted = rand() < (group === "control" ? 0.08 : 0.095) ? 1 : 0,
          sales = converted ? Math.round((20 + rand() * 80) * 100) / 100 : 0;
        rows.push({
          id: group + "-" + i,
          group,
          converted,
          sales,
          cost: Math.round(sales * 0.57 * 100) / 100,
          budget: group === "treatment" ? 0.5 : 0,
        });
      }
    return rows;
  }
  function sensitivity(args) {
    const p = C.product(args.productId),
      rows = [];
    for (const ratio of [1, 0.97, 0.94, 0.91, 0.88])
      for (const elasticity of [-0.5, -1.3, -2.2]) {
        const price = Math.round(p.price * ratio);
        rows.push({
          ratio,
          elasticity,
          ...C.pricing({ ...args, price, elasticity }),
        });
      }
    return rows;
  }
  function snapshot(module, inputs, outputs, sources = []) {
    let entries = [];
    try {
      entries = JSON.parse(localStorage.getItem("retail-v2-audit") || "[]");
    } catch {}
    const entry = {
      id: "RUN-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      module,
      dataVersion: D().meta.version,
      asOf: D().meta.asOf,
      inputs: JSON.parse(JSON.stringify(inputs)),
      outputs: JSON.parse(JSON.stringify(outputs)),
      sources: [...sources],
    };
    entries.push(entry);
    try {
      localStorage.setItem(
        "retail-v2-audit",
        JSON.stringify(entries.slice(-200)),
      );
    } catch {}
    return entry;
  }
  const signature = (script) =>
    JSON.stringify([
      script?.productId,
      script?.price,
      script?.terms,
      script?.scenes,
    ]);
  root.RetailAdvanced = {
    tfidf,
    research,
    sampleSize,
    assignment,
    parseCSV,
    experimentRows,
    experimentStats,
    simulatedExperiment,
    sensitivity,
    snapshot,
    signature,
  };
  C.research = research;
  if (typeof module !== "undefined") module.exports = root.RetailAdvanced;
})(globalThis);
