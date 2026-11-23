(function (root) {
  "use strict";
  const A = root.RetailAdvanced,
    C = root.RetailCore,
    D = root.RETAIL_DATA;
  const esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const money = (n) =>
    "¥" +
    n.toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const pct = (n) => (n * 100).toFixed(2) + "%";
  function download(name, value, type = "application/json") {
    const blob =
        value instanceof Blob
          ? value
          : new Blob(
              [
                "\ufeff",
                typeof value === "string"
                  ? value
                  : JSON.stringify(value, null, 2),
              ],
              { type },
            ),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  let experiment = null,
    experimentOrigin = "模拟数据";
  function experiments() {
    return `<div class="notice"><strong>把离线算法与线上经营验证分开。</strong>先固定假设、分流单位、样本和观察周期，再评估转化与每用户贡献。这里可以用模拟数据检查流程，或导入匿名用户级CSV。</div><div class="grid equal"><section class="card"><div class="card-head"><h2>试点样本量规划</h2></div><div class="card-body"><form id="sampleSizeForm"><div class="form-grid"><label class="field">基准转化率（%）<input type="number" name="p0" min="0.1" max="99" step="0.1" value="8" required></label><label class="field">希望检测到的转化率（%）<input type="number" name="p1" min="0.1" max="99" step="0.1" value="9.5" required></label></div><p class="data-note">双侧显著性水平5%、统计功效80%，两组等样本正态近似。不包含流失预留与聚类设计效应。</p><button type="submit" class="primary">估算每组样本</button></form><div id="sampleSizeResult"></div></div></section><section class="card"><div class="card-head"><h2>导入试点结果</h2></div><div class="card-body"><label class="field">匿名用户级CSV（金额单位：元）<input class="file-input" id="experimentCSV" type="file" accept=".csv,text/csv"></label><p class="data-note">每用户一行：user_id、group、converted、net_sales、variable_cost、campaign_cost。group取control或treatment；converted取0或1。导入只在本浏览器处理，不上传。</p><div class="actions"><button class="secondary" data-extra-action="sample-csv">下载模拟CSV</button><button class="primary" data-extra-action="simulate-experiment">运行模拟样例</button></div><p id="experimentImportStatus" class="data-note">不使用模拟结果声称真实增长。CSV字段完整也不证明分流与数据真实可靠。</p></div></section></div><section class="card"><div class="card-head"><h2>实验结果与不确定性</h2><span class="pill orange" id="experimentOrigin">${esc(experimentOrigin)}</span></div><div class="card-body" id="experimentResult">${experiment ? experimentHTML(experiment) : '<div class="empty">先运行模拟样例，或导入一份匿名用户级结果。</div>'}</div></section><div class="notice warn" style="margin-top:22px">随机分流必须在策略触达前完成。时间、预算、主指标和停止规则应事先约定；不能把促销前后对比直接当成因果效果，也不能因重复查看显著性而随时停止实验。</div>`;
  }
  function experimentHTML(r) {
    return (
      table(
        ["指标", "对照组", "策略组"],
        [
          ["独立用户", r.control.n, r.treatment.n],
          ["成交转化率", pct(r.control.p), pct(r.treatment.p)],
          ["每用户费用后贡献", money(r.control.mean), money(r.treatment.mean)],
        ],
      ) +
      `<div class="cost-grid"><div>转化率差（百分点）<strong>${(r.diff * 100).toFixed(2)}</strong></div><div>差值95%近似区间<strong style="font-size:16px">[${(r.interval[0] * 100).toFixed(2)}, ${(r.interval[1] * 100).toFixed(2)}]</strong></div><div>每用户贡献差<strong>${money(r.marginDiff)}</strong></div></div><p>贡献差95%近似区间：<strong>[${money(r.marginInterval[0])}, ${money(r.marginInterval[1])}]</strong></p><div class="notice ${r.stable ? "" : "warn"}">${r.stable ? "可展示正态近似区间，仍需核实独立用户、随机分流与预设观察周期。" : "至少一组成功或失败人数不足5，正态区间可能不可靠，请勿据此下确定结论。"} ${r.interval[0] <= 0 && r.interval[1] >= 0 ? "转化差区间包含0，当前结果仍兼容无差异。" : ""}</div><p class="data-note">${esc(r.note)} 金额贡献 = 净销售额 − 变动成本 − 活动费用；需确认费用未重复扣除。</p><button class="secondary" data-extra-action="export-experiment">导出评估与输入快照</button>`
    );
  }
  function sensitivity(plan) {
    if (!plan) return "";
    const rows = A.sensitivity(plan);
    return `<section class="card" style="margin-top:23px"><div class="card-head"><h2>价格敏感性 · 比较假设，而非承诺预测</h2><span class="pill gray">5档价格 × 3档弹性</span></div>${table(
      ["价格折扣", "弹性假设", "销量上限后", "费用后贡献", "约束"],
      rows.map((r) => [
        Math.round(r.ratio * 100) + "%标价",
        r.elasticity,
        r.units + "件",
        money(r.gross / 100),
        r.valid ? "满足当前条件" : "不满足",
      ]),
    )}<div class="card-body"><p class="data-note">不同弹性下的优选价格可能不同。这张表帮助识别策略对需求假设的依赖；每个情景均使用当前输入的基准销量、库存、费用和贡献率下限。</p></div></section>`;
  }
  function auditPanel() {
    let entries = [];
    try {
      entries = JSON.parse(localStorage.getItem("retail-v2-audit") || "[]");
    } catch {}
    return `<section class="card"><div class="card-head"><div><h2>运行记录与交付证据</h2><p>输入、输出、引用和时间随每次运行保存；只存当前浏览器，不是服务端防篡改审计。</p></div><button class="secondary" data-extra-action="export-audit">导出全部记录</button></div>${table(
      ["运行时间", "模块", "数据快照", "输入/输出摘要"],
      entries
        .slice(-8)
        .reverse()
        .map((e) => [
          esc(new Date(e.at).toLocaleString("zh-CN")),
          esc(e.module),
          esc(e.asOf),
          `<button class="text-link" data-run-id="${esc(e.id)}">查看冻结输入与输出</button>`,
        ]),
    )}${entries.length ? "" : '<div class="empty">运行促销、研究、脚本、审批或实验后，会生成记录。</div>'}</section>`;
  }
  function assets() {
    return `<section class="card" style="margin-bottom:23px"><div class="card-head"><div><h2>AI素材库 · 实际生成案例</h2><p>虚构燕麦饮商品图 · 内置图像生成工具产出 · 当前页面不提供在线生图</p></div><span class="pill">AI生成素材</span></div><div class="card-body"><div class="grid equal" style="margin-bottom:0"><img src="assets/oat-drink-ai.png" alt="AI生成的虚构鲜萃燕麦饮商品营销图" style="width:100%;border-radius:8px"><div class="report"><h3>素材来源与审核</h3><p>生成方式：内置图像生成工具。图片中的商品、包装和品牌均为演示设计，无真实商品功效与认证背书。</p><p>已检查：商品名称、250ml规格、包装可见性和营销文案留白。该素材仅匹配鲜萃燕麦饮，其他商品使用示意包装，避免错配。</p><div class="actions"><a class="secondary" href="assets/oat-drink-ai.png" download>下载AI素材</a><a class="secondary" href="assets/ai-generation.json" download>下载提示词与来源记录</a><a class="secondary" href="assets/retail-ai-film.mp4" download>下载有声营销样片</a></div><p class="data-note">成片：AI生成静态素材 + 模板动效 + 本地语音。生成式静态图、排版合成视频、实时模型调用分别标记。</p></div></div></div></section>`;
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "sampleSizeForm") {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const n = A.sampleSize(+f.get("p0") / 100, +f.get("p1") / 100);
        document.querySelector("#sampleSizeResult").innerHTML =
          `<div class="hero-note">预计每组至少 <strong>${n.toLocaleString("zh-CN")}</strong> 名独立用户，总计 ${(n * 2).toLocaleString("zh-CN")} 名。低流量场景需调整最小可检测差异或延长观察周期。</div>`;
        A.snapshot(
          "实验设计",
          {
            p0: +f.get("p0") / 100,
            p1: +f.get("p1") / 100,
            alpha: 0.05,
            power: 0.8,
          },
          { perGroup: n },
        );
      } catch (err) {
        document.querySelector("#sampleSizeResult").textContent = err.message;
      }
    }
  });
  document.addEventListener("change", async (e) => {
    if (e.target.id === "experimentCSV") {
      const file = e.target.files[0];
      if (!file) return;
      const status = document.querySelector("#experimentImportStatus");
      if (file.size > 5 * 1024 * 1024) {
        status.textContent = "文件超过5MB，请先在本地聚合为每用户一行。";
        return;
      }
      try {
        const rows = A.experimentRows(await file.text());
        if (rows.length > 50000)
          throw new Error("最多支持50,000行，请缩小试点范围");
        experiment = A.experimentStats(rows);
        experimentOrigin = "用户导入（未核实真实性）";
        document.querySelector("#experimentOrigin").textContent =
          experimentOrigin;
        document.querySelector("#experimentResult").innerHTML =
          experimentHTML(experiment);
        status.textContent = `已读取 ${rows.length} 名独立用户；仅在本浏览器计算。`;
        A.snapshot(
          "导入实验评估",
          { fileName: file.name, users: rows.length, origin: experimentOrigin },
          experiment,
        );
      } catch (err) {
        status.textContent = "未导入：" + err.message;
      }
    }
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-extra-action]");
    if (el) {
      const action = el.dataset.extraAction;
      if (action === "simulate-experiment") {
        experiment = A.experimentStats(A.simulatedExperiment());
        experimentOrigin = "模拟数据";
        document.querySelector("#experimentOrigin").textContent =
          experimentOrigin;
        document.querySelector("#experimentResult").innerHTML =
          experimentHTML(experiment);
        document.querySelector("#experimentImportStatus").textContent =
          "已运行固定种子模拟样例，非实际试点结果。";
        A.snapshot(
          "模拟实验评估",
          { seed: 20261123, origin: experimentOrigin },
          experiment,
        );
      }
      if (action === "sample-csv") {
        const rows = A.simulatedExperiment();
        download(
          "模拟实验样例.csv",
          [
            "user_id,group,converted,net_sales,variable_cost,campaign_cost",
            ...rows.map((x) =>
              [x.id, x.group, x.converted, x.sales, x.cost, x.budget].join(","),
            ),
          ].join("\r\n"),
          "text/csv",
        );
      }
      if (action === "export-experiment" && experiment)
        download("试点评估.json", {
          origin: experimentOrigin,
          result: experiment,
          note: "样本设计与数据真实性需另行核实",
        });
      if (action === "export-audit") {
        let entries = [];
        try {
          entries = JSON.parse(localStorage.getItem("retail-v2-audit") || "[]");
        } catch {}
        download("运行与审核记录.json", entries);
      }
      return;
    }
    const run = e.target.closest("[data-run-id]");
    if (run) {
      const entries = JSON.parse(
          localStorage.getItem("retail-v2-audit") || "[]",
        ),
        entry = entries.find((x) => x.id === run.dataset.runId);
      const dialog = document.querySelector("#modal");
      document.querySelector("#modalTitle").textContent =
        "运行快照 · " + entry.module;
      document.querySelector("#modalBody").innerHTML =
        "<pre>" + esc(JSON.stringify(entry, null, 2)) + "</pre>";
      dialog.showModal();
    }
  });
  root.RetailExtra = { experiments, sensitivity, auditPanel, assets };
})(globalThis);
