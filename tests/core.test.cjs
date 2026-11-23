const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../dist/data.js");
const C = require("../dist/core.js");
require("../dist/advanced.js");
const D = globalThis.RETAIL_DATA;
test("all-year totals match source SQLite control totals", () => {
  const s = C.summary(C.range(365));
  assert.equal(s.orders, 37704);
  assert.equal(s.sales, 138098083);
  assert.equal(s.cogs, 73660970);
  assert.equal(s.gross, s.sales - s.cogs);
});
test("store and product totals reconcile and dates do not overlap", () => {
  const r = C.range(),
    s = C.summary(r);
  for (const dim of ["store", "product"]) {
    const b = C.breakdown(r, dim);
    assert.equal(
      C.sum(b, (x) => x.sales),
      s.sales,
    );
    assert.equal(
      C.sum(b, (x) => x.gross),
      s.gross,
    );
  }
  assert.equal(
    C.sum(C.series(r), (x) => x.sales),
    s.sales,
  );
  const previous = C.range(28, "all", 28);
  assert.equal(C.day(previous.end, 1), r.start);
});
test("fixed-order decomposition sums exactly to observed change", () => {
  for (const n of [7, 28, 90])
    for (const store of ["all", 1, 4]) {
      const a = C.summary(C.range(n, store)),
        b = C.summary(C.range(n, store, n)),
        d = C.decomposition(a, b);
      assert.ok(
        Math.abs(d.traffic + d.conversion + d.aov - (a.sales - b.sales)) < 1e-7,
      );
    }
});
test("returns reduce sales and cogs consistently", () => {
  const o = { items: [[1, 3, 1000, 1]] };
  assert.equal(C.orderNet(o), 2000);
  assert.equal(C.orderCost(o), 2 * C.product(1).cost);
});
test("planted stockouts and conversion deterioration are visible", () => {
  assert.equal(C.stockouts(C.range()).length, 6);
  assert.ok(
    C.summary(C.range(28, 1)).conversion <
      C.summary(C.range(28, 1, 28)).conversion,
  );
  assert.equal(C.stockouts(C.range(28, 4)).length, 0);
});
test("recommendations filter training purchases and observed stock, and cold start works", () => {
  for (const uid of [1, 28, 200, 999999]) {
    const rec = C.recommend(uid, 1),
      bought = D.model.users[uid] || {};
    assert.ok(rec.length > 0);
    for (const p of rec) {
      assert.ok(!bought[p.id]);
      assert.ok(p.stock > 0);
    }
  }
});
test("evaluation uses chronologically separated windows and valid metrics", () => {
  assert.ok(D.evaluation.trainEnd < D.evaluation.testStart);
  assert.equal(D.evaluation.users, 315);
  for (const group of ["baseline", "personalized"])
    for (const value of Object.values(D.evaluation[group]))
      assert.ok(value >= 0 && value <= 1);
});
test("pricing obeys stock and minimum contribution constraints", () => {
  const a = C.pricing({ productId: 1, price: 1000, baseUnits: 100, stock: 30 });
  assert.equal(a.units, 30);
  assert.equal(a.sales, 30000);
  assert.equal(a.gross, 30 * (1000 - 650));
  const bad = C.pricing({ productId: 1, price: 500 });
  assert.equal(bad.valid, false);
  assert.equal(C.pricing({ productId: 1, price: 1200, stock: 0 }).valid, false);
});
test("evidence workflow rejects expired and same-origin duplicates", () => {
  const r = C.research("饮料缺货与促销价格");
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
test("future evidence and empty evidence do not produce external claims", () => {
  assert.equal(C.evidenceStatus({ published: "2027-01-01" }), "future");
  assert.equal(C.research("test", []).claims.length, 0);
});
