const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boot() {
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://localhost:8787",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  w.URL.createObjectURL = () => "blob:test-output";
  w.URL.revokeObjectURL = () => {};
  for (const file of [
    "data.js",
    "core.js",
    "advanced.js",
    "advanced-ui.js",
    "app.js",
  ])
    w.eval(fs.readFileSync(path.join(root, "dist", file), "utf8"));
  const $ = (selector) => w.document.querySelector(selector);
  const click = (selector) => {
    assert.ok($(selector), "Missing control: " + selector);
    $(selector).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  };
  const submit = (selector) =>
    $(selector).dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
  const input = (selector, value, type = "input") => {
    $(selector).value = value;
    $(selector).dispatchEvent(new w.Event(type, { bubbles: true }));
  };
  const go = async (page) => {
    w.location.hash = page;
    await sleep(30);
  };
  return { dom, w, $, click, submit, input, go };
}

test("failed model calls preserve the previous script and restore retry controls", async () => {
  const t = boot();
  try {
    await t.go("content");
    t.submit("#contentForm");
    const before = t.w.localStorage.getItem("retail-v1-script");
    t.w.fetch = async () => {
      throw new Error("simulated network failure");
    };
    t.click('[data-action="llm-script"]');
    await sleep(30);
    assert.equal(t.w.localStorage.getItem("retail-v1-script"), before);
    assert.equal(t.$('[data-action="llm-script"]').disabled, false);
    assert.match(t.$("#toast").textContent, /未生成/);
    assert.ok(
      JSON.parse(t.w.localStorage.getItem("retail-v2-audit")).some(
        (x) => x.module === "模型脚本失败",
      ),
    );
  } finally {
    t.dom.window.close();
  }
});

test("late model responses cannot overwrite inputs revised during generation", async () => {
  const t = boot();
  try {
    await t.go("content");
    t.submit("#contentForm");
    const before = t.w.localStorage.getItem("retail-v1-script");
    let resolveRequest;
    const draft = JSON.parse(before);
    t.w.fetch = () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      });
    t.click('[data-action="llm-script"]');
    assert.equal(t.$('[data-action="llm-script"]').disabled, true);
    t.input('#contentForm [name="terms"]', "新版本活动说明");
    resolveRequest({
      ok: true,
      json: async () => ({ script: { ...draft, mode: "llm" } }),
    });
    await sleep(30);
    assert.equal(t.w.localStorage.getItem("retail-v1-script"), before);
    assert.match(t.$("#toast").textContent, /旧模型结果已丢弃/);
    assert.equal(t.$('[data-action="llm-script"]').disabled, false);
  } finally {
    t.dom.window.close();
  }
});

test("all six modules render through real application navigation handlers", async () => {
  const t = boot();
  try {
    for (const [route, title] of [
      ["overview", "经营驾驶舱"],
      ["market", "市场与竞品雷达"],
      ["strategy", "会员与策略中心"],
      ["content", "AIGC内容工厂"],
      ["research", "市场研究助手"],
      ["projects", "项目与价值管理"],
    ]) {
      t.click(`#nav a[href="#${route}"]`);
      await sleep(30);
      assert.equal(t.$("#main h1").textContent, title);
      assert.ok(t.$("#main .card"));
    }
  } finally {
    t.dom.window.close();
  }
});

test("promotion, sensitivity, script, approval and revision form one consistent workflow", async () => {
  const t = boot();
  try {
    await t.go("strategy");
    t.click('[data-tab="pricing"]');
    t.input('#pricingForm [name="price"]', "11.90");
    t.submit("#pricingForm");
    assert.match(t.$("#pricingResult").textContent, /满足当前约束/);
    assert.equal(t.$("#sensitivityPanel tbody").children.length, 15);
    const plan = JSON.parse(t.w.localStorage.getItem("retail-v1-plan"));
    assert.equal(plan.price, 1190);
    t.click('[data-action="plan-to-content"]');
    await sleep(30);
    assert.equal(t.$("#contentProduct").value, "1");
    t.submit("#contentForm");
    assert.match(t.$("#scriptBox").textContent, /11.90/);
    t.$("#approveContent").checked = true;
    t.$("#approveContent").dispatchEvent(
      new t.w.Event("change", { bubbles: true }),
    );
    const approval = JSON.parse(t.w.localStorage.getItem("retail-v1-approval"));
    assert.equal(approval.price, 1190);
    assert.ok(approval.signature.includes("1190"));
    t.input('#contentForm [name="terms"]', "修改后的活动说明");
    assert.equal(t.$("#approveContent").checked, false);
    t.click('[data-action="render-video"]');
    assert.match(t.$("#toast").textContent, /当前版本脚本/);
    const runs = JSON.parse(t.w.localStorage.getItem("retail-v2-audit"));
    assert.ok(runs.some((r) => r.module === "促销模拟"));
    assert.ok(runs.some((r) => r.module === "内容人工核对"));
  } finally {
    t.dom.window.close();
  }
});

test("question-specific report, abstention and source snapshots render correctly", async () => {
  const t = boot();
  try {
    await t.go("research");
    t.input("#researchForm textarea", "东区库存缺货与补货");
    t.submit("#researchForm");
    await sleep(1100);
    assert.ok(t.$('#researchReport [data-evidence="E03"]'));
    assert.equal(t.$('#researchReport [data-evidence="E01"]'), null);
    assert.match(t.$("#researchReport").textContent, /东区最近28天/);
    t.input("#researchForm textarea", "量子纠缠的实验结果");
    t.submit("#researchForm");
    await sleep(1100);
    assert.match(t.$("#researchReport").textContent, /资料不足/);
    assert.equal(t.$("#researchReport .citation"), null);
    assert.match(
      t.$("#researchReport").closest(".card").querySelector("h2").textContent,
      /研究报告/,
    );
    assert.equal(
      JSON.parse(t.w.localStorage.getItem("retail-v1-report")).question,
      "量子纠缠的实验结果",
    );
  } finally {
    t.dom.window.close();
  }
});

test("sample planning and simulated experiment are explicitly labelled and exportable", async () => {
  const t = boot();
  try {
    await t.go("strategy");
    t.click('[data-tab="experiments"]');
    t.submit("#sampleSizeForm");
    const expected = t.w.RetailAdvanced.sampleSize(0.08, 0.095);
    assert.ok(
      t
        .$("#sampleSizeResult")
        .textContent.includes(expected.toLocaleString("zh-CN")),
    );
    t.click('[data-extra-action="simulate-experiment"]');
    assert.match(t.$("#experimentResult").textContent, /95%/);
    assert.equal(t.$("#experimentOrigin").textContent, "模拟数据");
    assert.match(t.$("#experimentImportStatus").textContent, /非实际/);
    assert.ok(t.$('[data-extra-action="export-experiment"]'));
  } finally {
    t.dom.window.close();
  }
});

test("new project persists and its frozen input/output is available in the audit panel", async () => {
  const t = boot();
  try {
    await t.go("projects");
    t.click('[data-action="new-task"]');
    t.input('#taskForm [name="title"]', "核对门店补货与库存口径");
    t.submit("#taskForm");
    await sleep(30);
    const tasks = JSON.parse(t.w.localStorage.getItem("retail-v1-tasks"));
    assert.ok(tasks.some((task) => task.title === "核对门店补货与库存口径"));
    assert.ok(t.$("[data-run-id]"));
    t.click("[data-run-id]");
    assert.match(t.$("#modalBody").textContent, /试点任务创建/);
    assert.match(t.$("#modalBody").textContent, /核对门店补货与库存口径/);
  } finally {
    t.dom.window.close();
  }
});
