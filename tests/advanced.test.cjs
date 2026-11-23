const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../dist/data.js");
const C = require("../dist/core.js"),
  A = require("../dist/advanced.js");

test("pricing rejects invalid numbers before producing results", () => {
  for (const args of [
    { price: NaN },
    { price: Infinity },
    { price: 0 },
    { price: 1200, stock: -1 },
    { price: 1200, budget: -1 },
    { price: 1200, minMargin: 1 },
  ]) {
    assert.throws(() => C.pricing({ productId: 1, ...args }), /参数无效/);
  }
});
test("different research questions retrieve different evidence and actions", () => {
  const stock = A.research("东区饮料缺货与补货问题"),
    price = A.research("饮料竞品促销价格与定价");
  assert.notDeepEqual(stock.claims, price.claims);
  assert.ok(stock.accepted.some((e) => e.id === "E03"));
  assert.ok(!stock.accepted.some((e) => e.id === "E01"));
  assert.ok(price.accepted.some((e) => e.id === "E01"));
  assert.notEqual(stock.recommendation, price.recommendation);
  assert.ok(stock.scope.startsWith("东区"));
});
test("unsupported questions abstain instead of returning the default report", () => {
  for (const q of ["量子纠缠的实验结果", "招聘薪资多少", "火星地质勘探"]) {
    const r = A.research(q);
    assert.equal(r.accepted.length, 0);
    assert.equal(r.claims.length, 0);
    assert.match(r.summary, /资料不足/);
    assert.equal(r.hypotheses.length, 0);
  }
});
test("stale and same-source evidence are excluded while original source wins", () => {
  const r = A.research("饮料促销价格与活动");
  assert.ok(r.accepted.some((e) => e.id === "E01"));
  assert.ok(
    r.excluded.some((e) => e.id === "E04" && e.reason.includes("过期")),
  );
  assert.ok(
    r.excluded.some((e) => e.id === "E05" && e.reason.includes("重复")),
  );
  assert.ok(
    r.claims.every((c) =>
      c.evidence.every((id) => r.accepted.some((e) => e.id === id)),
    ),
  );
});
test("empty evidence cannot produce externally supported conclusions", () => {
  const r = A.research("饮料促销价格", []);
  assert.equal(r.claims.length, 0);
  assert.equal(r.quality.independentSources, 0);
});
test("scope changes the numeric report, and explicit seven-day scope is honored", () => {
  assert.notEqual(
    A.research("东区销售经营").summary,
    A.research("西区销售经营").summary,
  );
  assert.match(A.research("东区近7天库存").scope, /最近7天/);
});
test("TF-IDF scores matched text above unrelated text", () => {
  const s = A.tfidf("缺货与库存", ["门店库存缺货", "海盐饼干营销"]);
  assert.ok(s[0] > s[1]);
  assert.equal(s[1], 0);
});
test("CSV parser handles BOM, escaped quotes, CRLF and quoted line breaks", () => {
  assert.deepEqual(A.parseCSV('\ufeffa,b\r\n"x,y","a""b"\r\n"c\nd",e'), [
    ["a", "b"],
    ["x,y", 'a"b'],
    ["c\nd", "e"],
  ]);
  assert.throws(() => A.parseCSV('a,"broken'), /引号/);
});
const header =
  "user_id,group,converted,net_sales,variable_cost,campaign_cost\n";
test("experiment import rejects duplicate users and malformed costs", () => {
  assert.throws(
    () =>
      A.experimentRows(header + "u1,control,1,10,5,0\nu1,treatment,1,10,5,0"),
    /重复/,
  );
  for (const row of [
    "u1,bad,1,10,5,0",
    "u1,control,2,10,5,0",
    "u1,control,1,10,-5,0",
    "u1,control,1,,5,0",
  ])
    assert.throws(() =>
      A.experimentRows(header + row + "\nu2,control,0,0,0,0"),
    );
});
test("experiment estimates conversion and contribution differences against hand-computed values", () => {
  const r = A.experimentStats([
    { id: "a", group: "control", converted: 1, sales: 10, cost: 4, budget: 0 },
    { id: "b", group: "control", converted: 0, sales: 0, cost: 0, budget: 0 },
    {
      id: "c",
      group: "treatment",
      converted: 1,
      sales: 12,
      cost: 5,
      budget: 1,
    },
    {
      id: "d",
      group: "treatment",
      converted: 1,
      sales: 10,
      cost: 4,
      budget: 1,
    },
  ]);
  assert.equal(r.diff, 0.5);
  assert.equal(r.marginDiff, 2.5);
  assert.equal(r.stable, false);
  assert.ok(r.interval[0] <= r.diff && r.interval[1] >= r.diff);
  assert.throws(() => A.experimentStats([]), /至少/);
});
test("simulated results are reproducible and contain valid uncertainty intervals", () => {
  assert.deepEqual(A.simulatedExperiment(10), A.simulatedExperiment(10));
  const r = A.experimentStats(A.simulatedExperiment());
  assert.equal(r.control.n, 1200);
  assert.equal(r.treatment.n, 1200);
  assert.ok(r.marginInterval[0] <= r.marginDiff);
  assert.ok(r.marginInterval[1] >= r.marginDiff);
});
test("sample planning requires more users for a smaller detectable change", () => {
  assert.ok(A.sampleSize(0.08, 0.09) > A.sampleSize(0.08, 0.1));
  assert.ok(A.sampleSize(0.08, 0.095) > 1000);
  assert.throws(() => A.sampleSize(0.08, 0.08));
  assert.throws(() => A.sampleSize(0, 0.1));
});
test("assignment is deterministic and approximately balanced", () => {
  let count = 0;
  for (let i = 0; i < 1000; i++) {
    assert.equal(A.assignment(i), A.assignment(i));
    count += A.assignment(i) === "treatment";
  }
  assert.ok(count > 450 && count < 550);
});
test("sensitivity calculations use the supplied stock, fees and constraints", () => {
  const rows = A.sensitivity({
    productId: 1,
    baseUnits: 100,
    stock: 10,
    budget: 10000,
    minMargin: 0.9,
  });
  assert.equal(rows.length, 15);
  assert.ok(rows.every((r) => r.units <= 10));
  assert.ok(rows.every((r) => r.valid === false));
});
test("approval signatures change when price, product, terms or scene changes", () => {
  const s = {
    productId: 1,
    price: 1290,
    terms: "t",
    scenes: [{ caption: "a", voice: "v" }],
  };
  for (const changed of [
    { ...s, price: 1200 },
    { ...s, productId: 2 },
    { ...s, terms: "new" },
    { ...s, scenes: [{ caption: "b", voice: "v" }] },
  ])
    assert.notEqual(A.signature(s), A.signature(changed));
});
