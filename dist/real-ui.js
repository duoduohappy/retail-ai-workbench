(function (root) {
  "use strict";
  const P = () => root.PUBLIC_RETAIL;
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
  const pct = (x) => (x * 100).toFixed(2) + "%",
    num = (x) => Number(x).toLocaleString("zh-CN"),
    gbp = (x) =>
      "£" +
      (x / 100).toLocaleString("en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  let accessCode = "";
  const reports = new Map();
  function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function saveAudit(module, inputs, outputs, sources = []) {
    root.RetailAdvanced?.snapshot(module, inputs, outputs, sources);
  }
  async function request(path, body, options = {}) {
    const controller = new AbortController(),
      timer = options.signal
        ? null
        : setTimeout(() => controller.abort(), 45000);
    try {
      const headers = { "Content-Type": "application/json" };
      if (accessCode) headers["X-Retail-Demo-Code"] = accessCode;
      const res = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options.signal || controller.signal,
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          "当前页面没有可用的Python后端，请使用本地服务或更新Render部署。",
        );
      }
      if (!res.ok) {
        const error = new Error(data.error || "模型任务未完成");
        error.code = data.errorCode;
        throw error;
      }
      return data;
    } catch (err) {
      if (err.name === "AbortError")
        throw new Error("请求超时，原结果保留；请稍后手动重试。");
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function health() {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) throw new Error("当前为静态页面，无Python模型服务");
    return res.json();
  }
  function modelPanel() {
    const d = document.querySelector("#modal");
    document.querySelector("#modalTitle").textContent = "AI服务配置与联网验证";
    document.querySelector("#modalBody").innerHTML =
      `<div class="notice">模型API Key只配置在Render或本地环境变量里，本页面不接收API Key。公网调用使用另设的演示访问码；访问码仅留在本次页面内存。</div><div id="modelHealth" class="report">正在读取配置状态（不调用模型）…</div><form id="accessCodeForm"><label class="field">演示访问码<input name="code" type="password" autocomplete="off" placeholder="对应RETAIL_DEMO_ACCESS_CODE，可在Render自设"></label><button class="secondary" type="submit" style="margin-top:12px">本次会话使用此访问码</button></form><p class="data-note" id="accessCodeStatus">${accessCode ? "本次页面已设置访问码" : "尚未设置访问码；本机调用可不填"}</p><div class="actions"><button class="primary" data-real-action="probe-model">实际验证模型连接</button><button class="secondary" data-real-action="refresh-health">刷新配置状态</button></div><p class="data-note">“实际验证”会发送一次短请求并消耗少量Token。不会自动重试或切换付费模型；云端“免费额度用完即停”仍需保持开启。</p><div id="modelProbeResult" class="report"></div>`;
    d.showModal();
    refreshHealth();
  }
  async function refreshHealth() {
    const box = document.querySelector("#modelHealth");
    if (!box) return;
    try {
      const h = await health();
      if (!box.isConnected) return;
      box.innerHTML = `<div class="stat-line"><span>模型配置</span><strong>${h.modelConfigured ? esc(h.model) : "未配置"}</strong></div><div class="stat-line"><span>当前配置最近验证</span><strong>${h.connectionVerified ? "已成功调用" : "尚未通过实际调用验证"}</strong></div><div class="stat-line"><span>本进程调用次数</span><strong>${h.callsUsed ?? 0} / ${h.maxCallsPerProcess ?? 20}</strong></div><div class="stat-line"><span>输出Token上限</span><strong>${h.maxOutputTokens ?? "未提供"}</strong></div>${h.accessCodeRequired && !h.accessCodeConfigured ? '<p class="down">公网模型调用前，请在Render设置RETAIL_DEMO_ACCESS_CODE。</p>' : ""}<p class="data-note">配置项：RETAIL_LLM_ENDPOINT（或RETAIL_LLM_BASE_URL）、RETAIL_LLM_MODEL=qwen4-max、RETAIL_LLM_API_KEY。接口地址与Key必须同地域。${esc(h.note || "")}</p>`;
    } catch (err) {
      box.textContent = err.message;
    }
  }
  function modelReportHtml(r) {
    return `<div class="notice"><strong>实际模型输出 · ${esc(r.generation.model)}</strong> · ${r.generation.latencyMs}ms · 用量 ${r.generation.usage?.total_tokens ?? "未返回"} Token。Token用量不等于账单金额。</div><h3>${esc(r.question)}</h3><p>${esc(r.summary)}</p><h3>有原文引用的发现</h3>${r.findings
      .map(
        (f) =>
          `<div class="evidence"><p>${esc(f.statement)}</p>${f.quotes
            .map((q) => {
              const s = r.sources.find((x) => x.id === q.sourceId);
              return `<details><summary>${esc(q.sourceId)} · ${esc(s.title)}</summary><blockquote>${esc(q.quote)}</blockquote><p class="data-note">${esc(s.publisher || "用户资料")} · ${esc(s.published || "未标日期")} ${s.synthetic ? "· 模拟证据" : s.historical ? "· 历史资料" : "· 用户提供，未独立核实"}</p></details>`;
            })
            .join("")}</div>`,
      )
      .join(
        "",
      )}<h3>待验证假设</h3>${r.hypotheses.map((x) => `<p>${esc(x)}</p>`).join("") || "<p>未提出额外假设。</p>"}<h3>行动建议</h3>${r.actions.map((x) => `<p>${esc(x)}</p>`).join("")}<p class="data-note">来源ID与原文摘录已通过程序匹配。${esc(r.limits)}</p><button class="secondary" data-real-action="export-live-report" data-live-request="${esc(r.generation.requestId)}">导出模型报告及来源</button>`;
  }
  function researchControls() {
    return `<section class="card" style="margin-top:22px"><div class="card-head"><div><h2>模型研究 · 在证据检查后生成</h2><p>先运行上方资料检索，再由模型根据有效资料形成带逐字引用的报告。</p></div><button class="secondary" data-real-action="model-panel">AI服务与访问码</button></div><div class="card-body"><button class="primary" data-real-action="research-custom">调用模型生成研究报告</button><p class="data-note">会实际调用已配置模型并消耗Token。无有效证据时不调用；引用不匹配时拒绝将结果标为成功。</p><div class="report" id="customModelReport"></div></div></section>`;
  }
  function publicDashboard() {
    const p = P(),
      e = p.recommendation;
    return `<div class="notice"><strong>真实公开数据 · 历史验证</strong>：${p.meta.start}至${p.meta.end}，英国在线礼品零售，金额单位为英镑。与主驾驶舱的虚构门店数据分开，不能用来判断目标企业或当前市场。</div><div class="kpis">${[
      ["原始交易行", num(p.quality.rawRows)],
      ["清洗后交易行", num(p.quality.acceptedRows)],
      ["净交易金额", gbp(p.summary.netAmount)],
      ["可评估会员", num(e.eligibleUsers)],
    ]
      .map(
        ([t, v]) =>
          `<div class="card kpi"><div class="kpi-top">${t}</div><strong class="kpi-value" style="font-size:25px">${v}</strong><p class="data-note">UCI Online Retail · GBP</p></div>`,
      )
      .join(
        "",
      )}</div><div class="grid equal"><section class="card"><div class="card-head"><h2>月份交易金额</h2></div>${table(
      ["月份", "正向金额", "撤销/负向金额", "净额"],
      p.monthly.map((m) => [
        esc(m.month) +
          (m.partial ? ' <span class="pill orange">不完整月</span>' : ""),
        gbp(m.positiveSales),
        gbp(m.cancellationAmount),
        gbp(m.netAmount),
      ]),
    )}</section><section class="card"><div class="card-head"><h2>数据来源与清洗口径</h2></div><div class="card-body report"><p>${esc(p.meta.attribution)}</p><p><a href="${esc(p.meta.sourceUrl)}" target="_blank" rel="noopener">UCI官方数据页</a> · <a href="${esc(p.meta.licenseUrl)}" target="_blank" rel="noopener">CC BY 4.0许可</a></p><p>原始行数 ${num(p.quality.rawRows)} = 保留 ${num(p.quality.acceptedRows)} + 排除 ${num(Object.values(p.quality.excludedRows).reduce((a, b) => a + b, 0))}。</p>${table(
      ["排除原因", "行数"],
      Object.entries(p.quality.excludedRows).map(([k, v]) => [esc(k), num(v)]),
    )}<p>缺失CustomerID的 ${num(p.quality.acceptedRowsMissingCustomerId)} 行保留在经营汇总中，排除出会员级推荐评估。</p><p>保留原始重复行；原数据未证明它们属于误重复。取消交易按取消发生日期记账，未与原始订单逐笔匹配。</p><p class="data-note">原始ZIP的SHA-256：<code style="word-break:break-all">${esc(p.meta.archiveSha256)}</code></p><a class="secondary" href="assets/public-retail.json" download>下载分析、评估及来源记录</a></div></section></div><section class="card" style="margin-bottom:22px"><div class="card-head"><h2>真实数据上的推荐基线对照</h2><span class="pill">时间切分 · K=${e.k}</span></div><div class="card-body"><p class="subtle">仅使用United Kingdom、CustomerID非空的正向购买发票。训练截止${e.trainEnd}；测试${e.testStart}至${e.testEnd}。候选为训练期前${e.candidateProducts}种商品；两种方法都排除训练期已购。</p>${table(
      ["指标", "热门基线", "商品篮关联"],
      [
        ["HitRate@10", pct(e.baseline.hitRate), pct(e.personalized.hitRate)],
        ["Recall@10", pct(e.baseline.recall), pct(e.personalized.recall)],
        ["NDCG@10", e.baseline.ndcg.toFixed(6), e.personalized.ndcg.toFixed(6)],
      ],
    )}<div class="notice warn" style="margin-top:18px">评估仅覆盖有历史、且未来未购商品落入候选集合的 ${e.eligibleUsers} 名用户。候选对未来未购商品的覆盖率为 <strong>${pct(e.candidateFutureItemCoverage)}</strong>，不能把此结果推广到所有用户和商品，也不代表线上收益。</div><p>用户配对NDCG差值95%Bootstrap区间：[${e.pairedNdcgDifference95CI.join(", ")}]，重采样${e.bootstrapResamples}次。此区间反映评估用户间差异，不是因果效应。</p><p class="data-note">${e.skippedLargeBasketsForPairs} 个包含超过100个候选SKU的批发大篮子不参与商品共现学习；其交易仍计入经营汇总。</p></div></section><section class="card" style="margin-bottom:22px"><div class="card-head"><h2>推荐样例与保留集核对</h2></div>${table(
      ["展示编码", "训练期购买示例", "推荐商品", "保留集命中"],
      e.examples.map((x) => [
        esc(x.customer),
        x.history
          .map(([id, n]) => `${esc(p.productNames[id] || id)} (${n})`)
          .join("<br>"),
        x.recommended
          .slice(0, 5)
          .map((id) => esc(p.productNames[id] || id))
          .join("<br>"),
        x.hits.length
          ? x.hits.map((id) => esc(p.productNames[id] || id)).join("<br>")
          : "未命中",
      ]),
    )}<div class="card-body"><p class="data-note">展示前5个满足评估条件的用户，编码为摘要，不公开原始CustomerID；摘要不是匿名化安全保证。</p></div></section><section class="card"><div class="card-head"><div><h2>让真实模型解读公开数据</h2><p>后端读取已核对的汇总及评估结果作为证据，不让模型重新计算或编造金额。</p></div><button class="secondary" data-real-action="model-panel">AI服务与访问码</button></div><div class="card-body"><label class="field">分析问题<textarea id="publicModelQuestion">请概括这份历史零售数据的经营特点，解释推荐对照结果的适用范围，并提出下一步需要验证的事项。</textarea></label><button class="primary" data-real-action="research-public" style="margin-top:16px">调用Qwen生成有引用的分析</button><p class="data-note">此按钮会实际消耗模型Token；尚未配置模型时会明确报错，不用模板冒充模型输出。</p><div class="report" id="publicModelReport"></div></div></section>`;
  }
  async function runResearch(button, sourceSet) {
    const publicMode = sourceSet === "public",
      box = document.querySelector(
        publicMode ? "#publicModelReport" : "#customModelReport",
      );
    let body;
    if (publicMode)
      body = {
        sourceSet: "public",
        question: document.querySelector("#publicModelQuestion").value.trim(),
      };
    else {
      const ctx = root.RetailResearchContext?.();
      if (!ctx?.sources?.length) {
        box.textContent =
          "请先检索出与当前问题匹配的有效证据；本次未调用模型。";
        return;
      }
      body = ctx;
    }
    if (body.question.length < 2) {
      box.textContent = "请填写至少两个字符的研究问题。";
      return;
    }
    const captured = JSON.stringify(body),
      previous = box.innerHTML;
    button.disabled = true;
    box.innerHTML =
      '<div class="notice">正在实际调用模型并核对原文引用，已有报告暂时保留…</div>' +
      previous;
    try {
      const data = await request("/api/research", body);
      if (!box.isConnected) return;
      const current = publicMode
        ? {
            sourceSet: "public",
            question: document
              .querySelector("#publicModelQuestion")
              .value.trim(),
          }
        : root.RetailResearchContext?.();
      if (JSON.stringify(current) !== captured) {
        box.innerHTML =
          '<div class="notice warn">输入或证据已变化，迟到的模型结果未采用，请重新生成。</div>' +
          previous;
        saveAudit("模型研究结果未采用", body, { discarded: true });
        return;
      }
      reports.set(data.report.generation.requestId, data.report);
      box.innerHTML = modelReportHtml(data.report);
      saveAudit(
        "模型引用研究",
        body,
        data.report,
        data.report.sources.map((s) => s.id),
      );
    } catch (err) {
      if (box.isConnected)
        box.innerHTML =
          '<div class="notice warn">本次未生成：' +
          esc(err.message) +
          "</div>" +
          previous;
      saveAudit(
        "模型研究失败",
        { question: body.question },
        { error: err.message },
      );
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "accessCodeForm") {
      e.preventDefault();
      accessCode = new FormData(e.target).get("code") || "";
      e.target.querySelector("input").value = "";
      document.querySelector("#accessCodeStatus").textContent = accessCode
        ? "访问码已设置，仅在本次页面内存保留。"
        : "访问码已清除。";
    }
  });
  document.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-real-action]");
    if (!button) return;
    const action = button.dataset.realAction;
    if (action === "model-panel") modelPanel();
    if (action === "refresh-health") refreshHealth();
    if (action === "research-public") runResearch(button, "public");
    if (action === "research-custom") runResearch(button, "custom");
    if (action === "probe-model") {
      const box = document.querySelector("#modelProbeResult");
      button.disabled = true;
      box.textContent = "正在实际验证模型连接…";
      try {
        const data = await request("/api/model-test", {});
        if (box.isConnected)
          box.innerHTML =
            '<div class="notice">验证成功：' +
            esc(data.generation.model) +
            "，用量 " +
            esc(data.generation.usage?.total_tokens ?? "平台未返回") +
            " Token，耗时 " +
            esc(data.generation.latencyMs) +
            "ms。</div>";
        saveAudit("模型连通性验证", {}, data);
        await refreshHealth();
      } catch (err) {
        if (box.isConnected) box.textContent = "未通过验证：" + err.message;
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    }
    if (action === "export-live-report") {
      const report = reports.get(button.dataset.liveRequest);
      if (!report) return;
      const blob = new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "模型研究报告-含引用与用量.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  });
  root.RetailModel = {
    request,
    health,
    setAccessCode: (value) => {
      accessCode = String(value || "");
    },
  };
  root.RetailReal = {
    dashboard: publicDashboard,
    researchControls,
    modelPanel,
    modelReportHtml,
  };
})(globalThis);
