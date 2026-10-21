(function () {
  "use strict";
  const G = SchedulerGame;
  const $ = id => document.getElementById(id);
  const key = "deepinfer-scheduler-game-v1";
  const colors = { A: "#2456d8", B: "#c45c45", C: "#36835a", D: "#8c58ac" };
  let state;
  let history = [];
  let phase = "prefill";
  let draft = {};
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && saved.version === 1 && G.LEVELS[saved.levelId] && Array.isArray(saved.requests) && saved.config.blockSize === 4) state = saved;
  } catch { /* Storage may be unavailable; the game still works. */ }
  if (!state) state = G.create();
  if (G.visible(state).some(r => G.status(r) === "decode")) phase = "decode";

  function save() {
    try { localStorage.setItem(key, JSON.stringify(state)); $("saveStatus").textContent = "本局已自动保存在当前浏览器；关掉页面也能继续。"; }
    catch { $("saveStatus").textContent = "浏览器未允许本地存储，本局仅在当前页面保留。"; }
  }
  function feedback(text, error = false) { $("feedback").textContent = text; $("feedback").className = error ? "error" : ""; }
  function syncConfig() {
    $("level").value = state.levelId;
    $("tokenConfig").value = state.config.tokens;
    $("blockConfig").value = state.config.blocks;
    $("cpuConfig").value = state.config.cpu;
    $("levelDescription").textContent = `${G.LEVELS[state.levelId].description} CPU速度：${state.config.cpuRate}块/片；SSD：1块/片。参考目标：${G.LEVELS[state.levelId].target}片内完成。`;
  }
  function allocations() { return Object.entries(draft).map(([id,tokens]) => ({ id, tokens: Number(tokens) })); }
  function renderPlan() {
    $("choosePrefill").setAttribute("aria-pressed", String(phase === "prefill"));
    $("chooseDecode").setAttribute("aria-pressed", String(phase === "decode"));
    $("phaseHelp").textContent = phase === "prefill" ? "在请求卡片输入本轮读入数量，可以分块。重算也走Prefill；读完后下一轮才能Decode。" : "勾选要继续回答的请求，每个消耗1个Token。可以同批生成，前提是新增长度有缓存可存。";
    const result = G.plan(state, phase, allocations());
    const noDraft = result.tokens === 0;
    $("planMeter").innerHTML = `<div class="plan-meter-row"><span>本轮Token</span><b>${result.tokens} / ${state.config.tokens}</b></div><div class="meter ${result.tokens > state.config.tokens ? "over" : ""}"><span style="width:${result.tokens/state.config.tokens*100}%"></span></div><div class="plan-meter-row"><span>需新增GPU块</span><b>${result.extraBlocks} / ${state.config.blocks - G.usage(state)} 空闲</b></div>`;
    $("planStatus").textContent = noDraft ? "还没有安排任务。输入Token数量或勾选请求。" : result.ok ? `资源检查通过。执行后本轮消耗${result.tokens}个Token；峰值新增${result.extraBlocks}块。任务完成后可能释放更多块。` : result.errors.join(" ");
    $("planStatus").className = !noDraft && !result.ok ? "invalid" : "";
    $("execute").disabled = G.finished(state);
  }
  function card(r) {
    const stage = G.status(r);
    const left = Math.max(0, r.prompt + r.generated - r.cached);
    const labels = { done: "已完成", stored: r.location.toUpperCase()+"已保存", prefill: r.generated ? "Prefill · 重算" : "Prefill · 读题", decode: "Decode · 回答中" };
    const wait = r.done ? 0 : state.time - Math.max(r.arrival,r.lastService);
    const readProgress = r.done ? 100 : Math.min(100, r.cached / (r.prompt+r.generated)*100);
    let controls = "";
    if (!r.done) {
      if (stage === "prefill" && phase === "prefill") controls = `<label for="allocate-${r.id}">本轮读入 <input id="allocate-${r.id}" type="number" min="0" max="${left}" step="1" value="${draft[r.id] || 0}" data-allocate="${r.id}" /> Token（还需${left}）</label>`;
      else if (stage === "decode" && phase === "decode") controls = `<label for="decode-${r.id}"><input id="decode-${r.id}" type="checkbox" data-decode="${r.id}" ${draft[r.id] ? "checked" : ""} /> 本轮生成1个Token</label>`;
      else if (r.location === "gpu") controls = `<span class="small">切换到${stage === "prefill" ? "Prefill" : "Decode"}阶段才能计算此请求。</span>`;
      if (r.location === "gpu" && r.cached > 0) controls += `<button data-action="recompute" data-id="${r.id}">抢占重算</button><button data-action="cpu" data-id="${r.id}">换到CPU</button><button data-action="ssd" data-id="${r.id}">换到SSD</button>`;
      if (r.location !== "gpu") controls += `<button data-action="restore" data-id="${r.id}">取回GPU（${G.blocksFor(r.cached,state)}块）</button>`;
    }
    return `<article class="request-card ${r.done ? "done" : ""}" style="--request-color:${colors[r.id]}"><div class="request-head"><div class="request-heading"><span class="request-id">${r.id}</span><div><div class="request-title">${r.title}</div><div class="request-subtitle">到达：${r.arrival}片 · 优先级${r.priority}</div></div></div><span class="badge ${stage}">${labels[stage]}</span></div><div class="request-stats"><div><span>原始输入</span><strong>${r.prompt} Token</strong></div><div><span>已输出 / 总长</span><strong>${r.generated} / ${r.done ? r.goal : "未知"}</strong></div><div><span>${r.location.toUpperCase()}占用</span><strong>${G.blocksFor(r.cached,state)}块 · ${r.cached}位置</strong></div><div><span>连续未服务</span><strong>${wait}片</strong></div></div><div class="request-progress" aria-hidden="true"><i style="width:${readProgress}%"></i></div><div class="request-actions">${controls}</div><p class="request-note">${r.done ? `已完成：总耗时${r.completedAt-r.arrival}片；所有缓存已释放。` : r.location !== "gpu" ? "缓存仍然完整，但CPU/SSD中的数据不能直接参与本游戏的GPU计算。" : stage === "prefill" ? `已缓存${r.cached} / ${r.prompt+r.generated}个已知上下文位置；还差${left}个。${r.replayUntil ? "已输出Token仍保留，重建缓存不重新抽样这些文字。" : ""}` : `下一步缓存位置将从${r.cached}增长到${r.cached+1}，需要新增${G.blocksFor(r.cached+1,state)-G.blocksFor(r.cached,state)}块。`}</p></article>`;
  }
  function renderMemory(location, capacity) {
    let html = "";
    for (const r of state.requests.filter(r=>!r.done && r.location===location)) {
      const n = G.blocksFor(r.cached,state);
      for (let i=0;i<n;i++) html += `<span class="block occupied" style="--request-color:${colors[r.id]}" title="请求${r.id} · 第${i+1}块">${r.id}</span>`;
    }
    for (let i=G.usage(state,location);i<capacity;i++) html += '<span class="block" title="空闲缓存块">·</span>';
    $(location+"Map").innerHTML = html || '<span class="block disabled">未配置</span>';
    $(location+"Usage").textContent = `${G.usage(state,location)} / ${capacity}块`;
  }
  function render() {
    const s = G.stats(state);
    $("timeMetric").textContent = state.time;
    $("tokenMetric").textContent = state.config.tokens;
    $("freeMetric").textContent = `${state.config.blocks-s.gpu} / ${state.config.blocks}`;
    $("doneMetric").textContent = `${s.done} / ${s.total}`;
    $("waitMetric").textContent = `${s.longestWait}片`;
    const future = state.requests.filter(r=>r.arrival>state.time);
    $("arrivalInfo").textContent = future.length ? `后续还有${future.length}个请求，最早在第${Math.min(...future.map(r=>r.arrival))}片到达` : "所有请求均已到达";
    $("requests").innerHTML = G.visible(state).map(card).join("") || '<p class="small">暂时没有请求，可以空等1片。</p>';
    renderMemory("gpu",state.config.blocks); renderMemory("cpu",state.config.cpu); renderMemory("ssd",state.config.ssd);
    $("log").innerHTML = state.log.slice(-30).reverse().map(item=>`<li><b>T+${item.time}</b><span>${item.message}</span></li>`).join("");
    $("costs").innerHTML = [["有效安排的计算回合",`${state.turns}轮`],["读入 / 生成的总工作",`${state.work} Token`],["其中重复计算",`${state.recomputed} Token`],["抢占次数",`${state.preemptions}次`],["单向搬运总量",`${state.transferred}块`],["搬运消耗",`${state.transferTime}片`],["计算轮Token填充率",`${Math.round(s.utilization*100)}%`],["已完成请求平均耗时",s.done ? `${s.average.toFixed(1)}片` : "暂无"]].map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    $("undo").disabled = history.length===0;
    $("idle").disabled = s.allDone;
    $("completion").hidden = !s.allDone;
    if (s.allDone) $("completion").innerHTML = `<p class="eyebrow">SHIFT COMPLETE</p><h2>本班全部请求完成。</h2><p>用时 <strong>${state.time}片</strong>，重算 <strong>${state.recomputed} Token</strong>，搬运 <strong>${state.transferred}块</strong>。本局参考分：<strong>${s.score}/100</strong>。</p><p>${state.time <= G.LEVELS[state.levelId].target ? "达成该关参考时间目标！" : "可以再试一次：优先推进可运行任务，比较搬运与重算，减少空等。"} 输出长度现在已揭晓，可以回看你的判断。</p><small>参考分=max(0,100−1.5×时间片−0.4×重算Token−2×抢占次数)，不是唯一最优标准；优先级与公平性请结合日志复盘。</small>`;
    renderPlan();
    save();
  }
  function accept(result, message) {
    if (!result.ok) { feedback(result.errors.join(" "),true); return; }
    history.push(G.clone(state));
    if (history.length>80) history.shift();
    state = result.state;
    draft = {};
    render();
    feedback(message || state.log[state.log.length-1].message);
  }
  $("requests").addEventListener("input", event=>{
    const id=event.target.dataset.allocate;
    if (!id) return;
    draft[id]=event.target.value==="" ? 0 : Number(event.target.value);
    renderPlan();
  });
  $("requests").addEventListener("change",event=>{
    const id=event.target.dataset.decode;
    if (!id) return;
    draft[id]=event.target.checked ? 1 : 0;
    renderPlan();
  });
  $("requests").addEventListener("click",event=>{
    const button=event.target.closest("button[data-action]");
    if (button) accept(G.reclaim(state,button.dataset.id,button.dataset.action));
  });
  function switchPhase(next) { phase=next; draft={}; feedback(""); render(); }
  $("choosePrefill").addEventListener("click",()=>switchPhase("prefill"));
  $("chooseDecode").addEventListener("click",()=>switchPhase("decode"));
  $("execute").addEventListener("click",()=>accept(G.execute(state,phase,allocations())));
  $("idle").addEventListener("click",()=>accept(G.idle(state)));
  $("hint").addEventListener("click",()=>feedback(G.hint(state)));
  $("undo").addEventListener("click",()=>{
    if (!history.length) return;
    state=history.pop(); draft={}; syncConfig(); render(); feedback("已撤回上一步，资源、时间和请求进度一起恢复。");
  });
  $("level").addEventListener("change",()=>{
    const level=G.LEVELS[$("level").value];
    $("tokenConfig").value=level.config.tokens;
    $("blockConfig").value=level.config.blocks;
    $("cpuConfig").value=level.config.cpu;
    $("levelDescription").textContent=level.description+" 点击“按当前配置开局”后生效。";
  });
  $("newGame").addEventListener("click",()=>{
    try {
      const next=G.create($("level").value,{tokens:Number($("tokenConfig").value),blocks:Number($("blockConfig").value),cpu:Number($("cpuConfig").value)});
      history.push(G.clone(state)); state=next; draft={};
      phase=G.visible(state).some(r=>G.status(r)==="decode") ? "decode" : "prefill";
      syncConfig(); render(); feedback("新班次开始。先看看哪些请求已经读完，哪些需要新增缓存块。");
    } catch (error) { feedback(error.message,true); }
  });
  $("exportLog").addEventListener("click",()=>{
    const content=JSON.stringify({level:G.LEVELS[state.levelId].name,config:state.config,stats:G.stats(state),time:state.time,recomputed:state.recomputed,transferTime:state.transferTime,log:state.log},null,2);
    const url=URL.createObjectURL(new Blob([content],{type:"application/json;charset=utf-8"}));
    const link=document.createElement("a"); link.href=url; link.download="scheduler-review.json"; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  syncConfig(); render();
})();
