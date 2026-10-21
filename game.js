(function () {
  "use strict";
  const G = SchedulerGame;
  const C = SchedulerChallenges;
  const $ = id => document.getElementById(id);
  const key = "deepinfer-scheduler-game-v1";
  const colors = { A: "#2456d8", B: "#c45c45", C: "#36835a", D: "#8c58ac", E: "#946510" };
  let state;
  let history = [];
  let phase = "prefill";
  let draft = {};
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
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
  function configDescription(id) {
    const level=G.LEVELS[id];
    const config=id===state.levelId ? state.config : level.config;
    return `${level.description} ${level.dynamic ? "题目预算固定；按到达事件逐轮调整，不必全部完成才提交判断。" : level.challenge ? "题目预算固定；先核算与排两轮，不必全部完成才提交判断。" : `CPU速度：${config.cpuRate}块/片；SSD：${config.ssdRate}块/片。参考目标：${level.target}片内完成。`}`;
  }
  function lockConfig(id) {
    for (const name of ["tokenConfig","blockConfig","cpuConfig"]) $(name).disabled=!!G.LEVELS[id].challenge;
  }
  function syncConfig() {
    $("level").value = state.levelId;
    $("tokenConfig").value = state.config.tokens;
    $("blockConfig").value = state.config.blocks;
    $("cpuConfig").value = state.config.cpu;
    lockConfig(state.levelId);
    $("levelDescription").textContent = configDescription(state.levelId);
  }
  function notes() { return state.challengeNotes ||= { answers:{}, goal:"", reflection:"", hints:0, checked:false, analysisOpen:false }; }
  function renderJudgment() {
    const exercise=C.CASES[state.levelId];
    if (!exercise) return;
    const n=notes();
    const results=C.check(state.levelId,n.answers);
    $("judgmentResult").innerHTML=n.checked ? `<p><strong>初始题面核算：${results.filter(r=>r.correct).length} / ${results.length}项正确。</strong> 核算与策略分开评价。</p><ul>${results.map(r=>`<li class="${r.correct ? "check-correct" : "check-wrong"}"><b>${r.correct ? "正确" : r.answered ? "需调整" : "未填写"} · ${r.label}</b><span>${r.explanation}</span></li>`).join("")}</ul><p>${n.goal ? `你的目标：${escape(n.goal)}。` : "你还没有选择策略目标。"} ${n.reflection.trim() ? "策略笔记已保存；这是开放题，程序不自动判定文字推理或唯一最优解。可下载复盘发给我点评。" : "请补上你的取舍理由与后续安排；程序不会替你判断业务目标。"}</p>` : "先填写你对初始题面的判断，点击核对后才显示答案。操作工作台不会自动揭晓这些核算。";
    if (exercise.dynamic) {
      if (n.checked) $("judgmentResult").querySelector("strong").textContent=`题面检查点核算：${results.filter(r=>r.correct).length} / ${results.length}项正确。`;
      else $("judgmentResult").textContent="按题目给定的初始条件或假设检查点填写；答案不随下方实操状态改变。点击核对才揭晓核算。";
    }
  }
  function renderChallenge(force=false) {
    const panel=$("challengePanel"), exercise=C.CASES[state.levelId];
    panel.hidden=!exercise;
    if (!exercise) { panel.dataset.level=""; return; }
    const n=notes();
    if (force || panel.dataset.level!==state.levelId) {
      panel.dataset.level=state.levelId;
      panel.innerHTML=`<div class="panel-title"><div><p class="eyebrow">CASE FILE / 初始题面始终保留</p><h2>${exercise.title}</h2></div><span>${exercise.focus}</span></div><p>${exercise.subtitle}</p><div class="case-columns"><div><h3>题目条件</h3><ul>${exercise.conditions.map(t=>`<li>${t}</li>`).join("")}</ul><h3>请先判断</h3><ol>${exercise.questions.map(t=>`<li>${t}</li>`).join("")}</ol><p class="small">优先级3最高；每轮只选一种阶段。除明确的输出上限外，不提前知道结束位置。实验用的输入/输出拆分仅用于运行，核算依据题面已知缓存位置。</p><a class="case-board-link" href="#board">去下方工作台操作验证 ↓</a></div><div><form id="judgmentForm"><fieldset><legend>我的资源核算（针对初始状态）</legend><div class="answer-grid">${exercise.checks.map(f=>`<label for="answer-${f.id}">${f.label}${f.type==="number" ? `<input id="answer-${f.id}" data-answer="${f.id}" type="number" min="0" step="1" value="${escape(n.answers[f.id] ?? "")}" inputmode="numeric" />` : `<select id="answer-${f.id}" data-answer="${f.id}"><option value="">请选择</option>${f.options.map(([v,t])=>`<option value="${v}" ${n.answers[f.id]===v ? "selected" : ""}>${t}</option>`).join("")}</select>`}</label>`).join("")}</div></fieldset><label for="strategyGoal">我的策略目标 / 选择</label><select id="strategyGoal"><option value="">请选择你的主要目标</option>${exercise.goals.map(t=>`<option ${n.goal===t ? "selected" : ""}>${t}</option>`).join("")}</select><label for="strategyNote">取舍理由与后续计划</label><textarea id="strategyNote" rows="4" maxlength="6000" placeholder="先安排什么？谁继续等待？下一轮块数如何变化？">${escape(n.reflection)}</textarea><p class="small">${exercise.reflection}</p><button class="primary" type="submit">核对我的判断</button></form><div id="judgmentResult" class="judgment-result" aria-live="polite"></div></div></div><div class="case-tools"><button id="caseHint" type="button">给我下一条提示</button><button id="caseReview" type="button">查看本次操作反馈</button><button id="caseReset" type="button">重置本题（可撤回）</button></div><ol id="caseHints" class="case-hints"></ol><div id="caseReviewResult" class="case-review" aria-live="polite"></div><details id="caseAnalysis" ${n.analysisOpen ? "open" : ""}><summary>查看完整参考解析（会揭晓核算答案）</summary><ol>${exercise.analysis.map(t=>`<li>${t}</li>`).join("")}</ol><p>参考路线不是唯一正确策略。自然结束长度只用于模拟，不应作为事前选择依据。</p></details>`;
    }
    if (exercise.dynamic) {
      panel.querySelector("legend").textContent="我的资源核算（按题目给定检查点）";
      panel.querySelector(".eyebrow").textContent="DYNAMIC CASE / 题面与到达计划始终保留";
    }
    $("caseHints").innerHTML=exercise.hints.slice(0,n.hints).map(t=>`<li>${t}</li>`).join("");
    $("caseHint").textContent=n.hints>=exercise.hints.length ? "提示已全部展开" : `给我第${n.hints+1}条提示`;
    $("caseHint").disabled=n.hints>=exercise.hints.length;
    if (n.reviewOpen) $("caseReviewResult").innerHTML=`<h3>基于你实际操作的反馈</h3><ul>${C.review(state,G).map(t=>`<li>${t}</li>`).join("")}</ul>`;
    else $("caseReviewResult").textContent="反馈仅分析已发生的操作与当前可运行性，不读取隐藏输出长度替你挑选请求。";
    renderJudgment();
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
      if (r.location === "gpu" && r.cached > 0) controls += `<button data-action="recompute" data-id="${r.id}">抢占重算</button><button data-action="cpu" data-id="${r.id}" ${state.config.cpu===0 ? 'disabled title="本题未配置CPU缓存"' : ""}>换到CPU</button><button data-action="ssd" data-id="${r.id}" ${state.config.ssd===0 ? 'disabled title="本题未配置SSD缓存"' : ""}>换到SSD</button>`;
      if (r.location !== "gpu") controls += `<button data-action="restore" data-id="${r.id}">取回GPU（${G.blocksFor(r.cached,state)}块）</button>`;
    }
    return `<article class="request-card ${r.done ? "done" : ""}" style="--request-color:${colors[r.id]}"><div class="request-head"><div class="request-heading"><span class="request-id">${r.id}</span><div><div class="request-title">${r.title}</div><div class="request-subtitle">到达：${r.arrival<0 ? `接班前${-r.arrival}片` : r.arrival+"片"} · 优先级${r.priority}</div></div></div><span class="badge ${stage}">${labels[stage]}</span></div><div class="request-stats"><div><span>原始输入</span><strong>${r.prompt} Token</strong></div><div><span>已输出 / ${r.knownLimit ? "已知上限" : "总长"}</span><strong>${r.generated} / ${r.done ? r.goal : r.knownLimit || "未知"}</strong></div><div><span>${r.location.toUpperCase()}占用</span><strong>${G.blocksFor(r.cached,state)}块 · ${r.cached}位置</strong></div><div><span>连续未服务</span><strong>${wait}片</strong></div></div><div class="request-progress" aria-hidden="true"><i style="width:${readProgress}%"></i></div><div class="request-actions">${controls}</div><p class="request-note">${r.done ? `已完成：总耗时${r.completedAt-r.arrival}片；所有缓存已释放。` : r.location !== "gpu" ? "缓存仍然完整，但CPU/SSD中的数据不能直接参与本游戏的GPU计算。" : stage === "prefill" ? `已缓存${r.cached} / ${r.prompt+r.generated}个已知上下文位置；还差${left}个。${r.replayUntil ? "已输出Token仍保留，重建缓存不重新抽样这些文字。" : ""}` : `下一步缓存位置将从${r.cached}增长到${r.cached+1}，需要新增${G.blocksFor(r.cached+1,state)-G.blocksFor(r.cached,state)}块。`}${!r.done && r.knownLimit ? ` 已知输出上限${r.knownLimit}，还可生成${Math.max(0,r.knownLimit-r.generated)}个Token；仍须通过执行前峰值检查。` : ""}</p></article>`;
  }
  function renderMemory(location, capacity) {
    let html = "";
    if (location==="cpu") for (let i=0;i<(state.config.cpuReserved || 0);i++) html+='<span class="block reserved" title="其他任务固定占用，本题不可移动">他</span>';
    for (const r of state.requests.filter(r=>!r.done && r.location===location)) {
      const n = G.blocksFor(r.cached,state);
      for (let i=0;i<n;i++) html += `<span class="block occupied" style="--request-color:${colors[r.id]}" title="请求${r.id} · 第${i+1}块">${r.id}</span>`;
    }
    for (let i=G.usage(state,location);i<capacity;i++) html += '<span class="block" title="空闲缓存块">·</span>';
    $(location+"Map").innerHTML = html || '<span class="block disabled">未配置</span>';
    $(location+"Usage").textContent = `${G.usage(state,location)} / ${capacity}块`;
  }
  function renderArrivals() {
    const panel=$("arrivalForecast");
    panel.hidden=!G.LEVELS[state.levelId].dynamic;
    if (panel.hidden) return;
    const labels={future:"未到达",prefill:"已到达 · 待读题",decode:"已到达 · 可输出",stored:"已到达 · 缓存换出",done:"已完成"};
    panel.innerHTML=`<div class="panel-title"><div><p class="eyebrow">ARRIVAL PLAN / 题设已知的到达计划</p><h2>接下来谁会来？</h2></div><span>当前 T+${state.time}</span></div><p>到达发生在指定时间片结束时，下一轮才可调度。搬运期间新请求仍会到达，但本游戏不能中途打断搬运；最终输出长度保持隐藏。</p><ol class="arrival-timeline">${G.forecast(state).map(r=>`<li class="arrival-${r.status}" data-arrival-id="${r.id}"><b>T+${r.arrival}</b><strong>${r.id} · ${r.title}</strong><span>输入${r.prompt} Token · 优先级${r.priority}</span><em>${labels[r.status]}</em></li>`).join("")}</ol>`;
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
    renderArrivals();
    $("log").innerHTML = state.log.slice(-30).reverse().map(item=>`<li><b>T+${item.time}</b><span>${item.message}</span></li>`).join("");
    $("costs").innerHTML = [["有效安排的计算回合",`${state.turns}轮`],["读入 / 生成的总工作",`${state.work} Token`],["其中重复计算",`${state.recomputed} Token`],["抢占次数",`${state.preemptions}次`],["单向搬运总量",`${state.transferred}块`],["搬运消耗",`${state.transferTime}片`],["计算轮Token填充率",`${Math.round(s.utilization*100)}%`],["已完成请求平均耗时",s.done ? `${s.average.toFixed(1)}片` : "暂无"]].map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    $("undo").disabled = history.length===0;
    $("idle").disabled = s.allDone;
    $("completion").hidden = !s.allDone;
    if (s.allDone) $("completion").innerHTML = G.LEVELS[state.levelId].challenge ? `<p class="eyebrow">CASE PRACTICE COMPLETE</p><h2>情景操作演练完成。</h2><p>用时 <strong>${state.time}片</strong>，重算 <strong>${state.recomputed} Token</strong>，搬运 <strong>${state.transferred}块</strong>。</p><p>情景题不按唯一用时打分。请回到题面核对资源计算，并说明优先级、公平性与恢复代价的取舍。自然结束长度现已揭晓，不应倒推成事前已知信息。</p><a href="#challengePanel">回到我的判断与解析 ↑</a>` : `<p class="eyebrow">SHIFT COMPLETE</p><h2>本班全部请求完成。</h2><p>用时 <strong>${state.time}片</strong>，重算 <strong>${state.recomputed} Token</strong>，搬运 <strong>${state.transferred}块</strong>。本局参考分：<strong>${s.score}/100</strong>。</p><p>${state.time <= G.LEVELS[state.levelId].target ? "达成该关参考时间目标！" : "可以再试一次：优先推进可运行任务，比较搬运与重算，减少空等。"} 输出长度现在已揭晓，可以回看你的判断。</p><small>参考分=max(0,100−1.5×时间片−0.4×重算Token−2×抢占次数)，不是唯一最优标准；优先级与公平性请结合日志复盘。</small>`;
    renderChallenge();
    renderPlan();
    save();
  }
  function accept(result, message) {
    if (!result.ok) { feedback(result.errors.join(" "),true); return; }
    const arrived=result.state.requests.filter(r=>r.arrival>state.time && r.arrival<=result.state.time);
    history.push(G.clone(state));
    if (history.length>80) history.shift();
    state = result.state;
    draft = {};
    render();
    feedback((message || state.log[state.log.length-1].message)+(arrived.length ? ` 新到达：${arrived.map(r=>r.id+"（优先级"+r.priority+"）").join("、")}；下次决策可安排，请重新核对预算。` : ""));
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
    state=history.pop(); draft={}; syncConfig(); renderChallenge(true); render(); feedback("已撤回上一步，资源、时间和请求进度一起恢复。");
  });
  $("level").addEventListener("change",()=>{
    const level=G.LEVELS[$("level").value];
    $("tokenConfig").value=level.config.tokens;
    $("blockConfig").value=level.config.blocks;
    $("cpuConfig").value=level.config.cpu;
    lockConfig($("level").value);
    $("levelDescription").textContent=configDescription($("level").value)+" 点击“按当前配置开局”后生效；当前工作台尚未改变。";
  });
  function loadLevel(id,overrides={}) {
    try {
      const next=G.create(id,overrides);
      history.push(G.clone(state)); state=next; draft={};
      if (history.length>80) history.shift();
      phase=G.visible(state).some(r=>G.status(r)==="decode") ? "decode" : "prefill";
      syncConfig(); renderChallenge(true); render(); feedback("新班次开始。先看看哪些请求已经读完，哪些需要新增缓存块。");
    } catch (error) { feedback(error.message,true); }
  }
  $("newGame").addEventListener("click",()=>loadLevel($("level").value,G.LEVELS[$("level").value].challenge ? {} : {tokens:Number($("tokenConfig").value),blocks:Number($("blockConfig").value),cpu:Number($("cpuConfig").value)}));
  $("challenges").addEventListener("click",event=>{
    const button=event.target.closest("button[data-challenge]");
    if (!button) return;
    loadLevel(button.dataset.challenge);
    $("challengePanel").scrollIntoView({block:"start"});
  });
  $("challengePanel").addEventListener("input",event=>{
    const n=notes(), el=event.target;
    if (el.dataset.answer) { n.answers[el.dataset.answer]=el.value; n.checked=false; renderJudgment(); }
    if (el.id==="strategyGoal") { n.goal=el.value; renderJudgment(); }
    if (el.id==="strategyNote") { n.reflection=el.value; renderJudgment(); }
    save();
  });
  $("challengePanel").addEventListener("submit",event=>{
    event.preventDefault(); notes().checked=true; renderJudgment(); save();
  });
  $("challengePanel").addEventListener("click",event=>{
    const id=event.target.closest("button")?.id;
    if (id==="caseHint") { notes().hints=Math.min(notes().hints+1,C.CASES[state.levelId].hints.length); renderChallenge(); save(); }
    if (id==="caseReview") { notes().reviewOpen=true; renderChallenge(); save(); }
    if (id==="caseReset") loadLevel(state.levelId);
  });
  $("challengePanel").addEventListener("toggle",event=>{
    if (event.target.id==="caseAnalysis" && event.target.isConnected) { notes().analysisOpen=event.target.open; save(); }
  },true);
  $("exportLog").addEventListener("click",()=>{
    const content=JSON.stringify({level:G.LEVELS[state.levelId].name,config:state.config,stats:G.stats(state),time:state.time,recomputed:state.recomputed,transferTime:state.transferTime,challengeNotes:state.challengeNotes,decisions:state.decisions,log:state.log},null,2);
    const url=URL.createObjectURL(new Blob([content],{type:"application/json;charset=utf-8"}));
    const link=document.createElement("a"); link.href=url; link.download="scheduler-review.json"; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  syncConfig(); render();
})();
