(function (root) {
  "use strict";
  const D = () => root.RETAIL_DATA;
  const day = (date, n) =>
    new Date(Date.parse(date + "T00:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
  const sum = (xs, fn) => xs.reduce((a, x) => a + fn(x), 0);
  const product = (id) => D().products.find((p) => p.id === +id);
  function range(days = 28, store = "all", offset = 0) {
    const end = day(D().meta.asOf, -offset),
      start = day(end, 1 - days);
    return { start, end, store };
  }
  const includes = (o, r) =>
    o.date >= r.start &&
    o.date <= r.end &&
    (r.store === "all" || o.store === +r.store);
  const orderNet = (o) => sum(o.items, (i) => (i[1] - i[3]) * i[2]);
  const orderCost = (o) =>
    sum(o.items, (i) => (i[1] - i[3]) * product(i[0]).cost);
  function summary(r) {
    const orders = D().orders.filter((o) => includes(o, r));
    const sales = sum(orders, orderNet),
      cogs = sum(orders, orderCost),
      visitors = sum(
        D().traffic.filter((o) => includes(o, r)),
        (t) => t.visitors,
      );
    return {
      sales,
      cogs,
      gross: sales - cogs,
      margin: sales ? (sales - cogs) / sales : 0,
      orders: orders.length,
      visitors,
      conversion: visitors ? orders.length / visitors : 0,
      aov: orders.length ? sales / orders.length : 0,
      units: sum(orders, (o) => sum(o.items, (i) => i[1] - i[3])),
      members: new Set(orders.filter((o) => o.member).map((o) => o.member))
        .size,
    };
  }
  function breakdown(r, dimension = "store") {
    return (dimension === "store" ? D().stores : D().products)
      .map((x) => {
        const os = D().orders.filter(
          (o) => includes(o, r) && (dimension !== "store" || o.store === x.id),
        );
        let sales = 0,
          cogs = 0,
          units = 0;
        for (const o of os)
          for (const i of o.items)
            if (dimension === "store" || i[0] === x.id) {
              sales += (i[1] - i[3]) * i[2];
              cogs += (i[1] - i[3]) * product(i[0]).cost;
              units += i[1] - i[3];
            }
        return {
          ...x,
          sales,
          gross: sales - cogs,
          units,
          margin: sales ? (sales - cogs) / sales : 0,
        };
      })
      .sort((a, b) => b.sales - a.sales);
  }
  function series(r) {
    const map = new Map();
    for (let d = r.start; d <= r.end; d = day(d, 1))
      map.set(d, { date: d, sales: 0, gross: 0 });
    for (const o of D().orders)
      if (includes(o, r)) {
        map.get(o.date).sales += orderNet(o);
        map.get(o.date).gross += orderNet(o) - orderCost(o);
      }
    return [...map.values()];
  }
  function decomposition(current, previous) {
    const traffic =
      (current.visitors - previous.visitors) *
      previous.conversion *
      previous.aov;
    const conversion =
      current.visitors *
      (current.conversion - previous.conversion) *
      previous.aov;
    const aov =
      current.visitors * current.conversion * (current.aov - previous.aov);
    return {
      traffic,
      conversion,
      aov,
      note: "固定顺序：客流→转化率→客单价。此为精确代数分解，贡献随顺序变化，不代表因果。",
    };
  }
  function stockouts(r) {
    const rows = D().inventory.filter(
      (i) =>
        i[0] >= r.start &&
        i[0] <= r.end &&
        (r.store === "all" || i[1] === +r.store),
    );
    const counts = new Map();
    for (const i of rows)
      if (i[3] === 0) {
        const key = i[1] + "-" + i[2];
        const v = counts.get(key) || { store: i[1], product: i[2], days: 0 };
        v.days++;
        counts.set(key, v);
      }
    return [...counts.values()].sort((a, b) => b.days - a.days);
  }
  function memberStats() {
    const map = new Map(
      D().members.map((m) => [
        m.id,
        {
          ...m,
          last: null,
          frequency: 0,
          monetary: 0,
          categories: {},
          bought: {},
        },
      ]),
    );
    const start = day(D().meta.asOf, -89);
    for (const o of D().orders) {
      if (!o.member) continue;
      const m = map.get(o.member);
      if (!m.last || o.date > m.last) m.last = o.date;
      if (o.date >= start) {
        m.frequency++;
        m.monetary += orderNet(o);
        for (const i of o.items) {
          const p = product(i[0]),
            q = i[1] - i[3];
          m.categories[p.category] = (m.categories[p.category] || 0) + q;
          m.bought[p.id] = (m.bought[p.id] || 0) + q;
        }
      }
    }
    return [...map.values()]
      .map((m) => {
        const recency = m.last
          ? Math.round(
              (Date.parse(D().meta.asOf) - Date.parse(m.last)) / 86400000,
            )
          : 999;
        const segment =
          recency > 30
            ? "待唤醒"
            : m.frequency >= 12 && m.monetary >= 30000
              ? "高价值"
              : m.frequency >= 5
                ? "稳定复购"
                : "新客培育";
        return {
          ...m,
          recency,
          segment,
          preference:
            Object.entries(m.categories).sort((a, b) => b[1] - a[1])[0]?.[0] ||
            m.favorite,
        };
      })
      .sort((a, b) => b.monetary - a.monetary);
  }
  function recommend(uid, store = 1, limit = 5) {
    const model = D().model,
      bought = model.users[String(uid)] || {},
      scores = {};
    for (const [p, n] of Object.entries(bought))
      for (const [other, similarity] of model.similarities[p] || [])
        if (!(String(other) in bought))
          scores[other] = (scores[other] || 0) + similarity * Math.log1p(n);
    const ranked = Object.keys(scores)
      .map(Number)
      .sort((a, b) => scores[b] - scores[a] || a - b);
    for (const p of model.popular)
      if (!ranked.includes(p) && !(String(p) in bought)) ranked.push(p);
    const stock = new Map(
      D()
        .inventory.filter((i) => i[0] === D().meta.asOf && i[1] === +store)
        .map((i) => [i[2], i[3]]),
    );
    return ranked
      .filter((id) => (stock.get(id) || 0) > 0)
      .slice(0, limit)
      .map((id) => ({
        ...product(id),
        score: scores[id] || 0,
        stock: stock.get(id),
        reason: scores[id]
          ? "基于训练期购买记录与商品篮关联；已过滤训练期已购商品"
          : "热门商品回退；已过滤训练期已购商品",
      }));
  }
  function pricing({
    productId,
    price,
    baseUnits = 100,
    elasticity = -1.3,
    stock = 500,
    budget = 0,
    minMargin = 0.15,
  }) {
    if (
      ![
        +productId,
        price,
        baseUnits,
        elasticity,
        stock,
        budget,
        minMargin,
      ].every(Number.isFinite) ||
      price <= 0 ||
      !Number.isInteger(price) ||
      baseUnits < 0 ||
      stock < 0 ||
      budget < 0 ||
      elasticity > 0 ||
      minMargin < 0 ||
      minMargin >= 1
    )
      throw new RangeError("促销参数无效");
    const p = product(productId);
    if (!p) throw new RangeError("商品不存在");
    const demand = baseUnits * Math.pow(price / p.price, elasticity);
    const units = Math.min(stock, Math.max(0, Math.round(demand)));
    const sales = units * price,
      cost = units * p.cost,
      gross = sales - cost - budget;
    const margin = sales ? gross / sales : 0;
    const baselineUnits = Math.min(stock, baseUnits),
      baselineGross = baselineUnits * (p.price - p.cost);
    return {
      units,
      demand,
      sales,
      cost,
      gross,
      margin,
      baselineGross,
      delta: gross - baselineGross,
      valid: price > 0 && margin >= minMargin && stock > 0,
      note: "需求由手动弹性假设计算，未从历史数据识别因果弹性；增量为情景差额。",
    };
  }
  function evidenceStatus(e, asOf = D().meta.asOf) {
    if (e.expires && e.expires < asOf) return "expired";
    if (e.published > asOf) return "future";
    return "valid";
  }
  function research(question, evidence = D().evidence) {
    if (!root.RetailAdvanced) throw new Error("Research engine not loaded");
    return root.RetailAdvanced.research(question, evidence);
  }
  const metrics = [
    [
      "净销售额",
      "Σ(数量－退货数量)×折后成交单价",
      "单位分；按订单日期归属，退货计回原订单，演示不含税费及运费",
    ],
    [
      "商品毛利",
      "净销售额－净销量×固定商品成本",
      "不含人工、租金和渠道费用；商品成本为模拟固定成本",
    ],
    [
      "订单数",
      "窗口内已支付订单数量",
      "包含后来全额退货订单；与客流同店同时间范围",
    ],
    ["客单价", "净销售额÷已支付订单数", "分母包含全退订单"],
    [
      "转化率",
      "已支付订单数÷进店客流",
      "模拟客流；非去重人数，非严格个人级转化",
    ],
    [
      "复购会员率",
      "窗口内购买≥2笔会员÷购买≥1笔会员",
      "当前窗口口径；不是新客队列留存",
    ],
    [
      "库存快照",
      "观察日门店SKU库存件数",
      "零库存天数为日快照缺货天数，不能推断全日缺货",
    ],
    [
      "会员RFM",
      "最近购买间隔／近90天订单数／近90天净销售额",
      "规则分层，非流失概率或LTV预测",
    ],
    ["坪效／人效", "窗口净销售额÷面积／员工数", "面积与人数固定；未按工时折算"],
  ];
  root.RetailCore = {
    day,
    sum,
    product,
    range,
    includes,
    orderNet,
    orderCost,
    summary,
    breakdown,
    series,
    decomposition,
    stockouts,
    memberStats,
    recommend,
    pricing,
    evidenceStatus,
    research,
    metrics,
  };
  if (typeof module !== "undefined") module.exports = root.RetailCore;
})(globalThis);
