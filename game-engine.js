/* Educational single-worker simulator. No model execution or production benchmarks. */
(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const LEVELS = {
    start: {
      name: "01 · 第一班调度", description: "练习分块读题与同批输出。先让所有请求完成。", target: 14,
      config: { tokens: 8, blocks: 8, blockSize: 4, cpu: 4, ssd: 8, cpuRate: 4, ssdRate: 1 },
      requests: [
        { id: "A", title: "解释一段代码", prompt: 8, goal: 3, priority: 2, arrival: 0 },
        { id: "B", title: "一个简短问题", prompt: 4, goal: 2, priority: 3, arrival: 0 },
        { id: "C", title: "总结学习笔记", prompt: 6, goal: 3, priority: 1, arrival: 3 }
      ]
    },
    pressure: {
      name: "02 · 显存告急", description: "A、B正在回答，C等待读题。先看看谁还能继续，而不是急着抢占。", target: 15,
      config: { tokens: 8, blocks: 6, blockSize: 4, cpu: 3, ssd: 8, cpuRate: 3, ssdRate: 1 },
      requests: [
        { id: "A", title: "正在写长回答", prompt: 8, goal: 7, generated: 4, ready: true, priority: 1, arrival: 0 },
        { id: "B", title: "正在解释概念", prompt: 4, goal: 3, generated: 1, ready: true, priority: 3, arrival: 0 },
        { id: "C", title: "刚来的问题", prompt: 8, goal: 3, priority: 2, arrival: 0 }
      ]
    },
    storage: {
      name: "03 · 搬运还是重算", description: "GPU只剩一块，CPU也放不下所有缓存。存储操作会花时间，后续还有新请求。", target: 24,
      config: { tokens: 6, blocks: 5, blockSize: 4, cpu: 2, ssd: 8, cpuRate: 2, ssdRate: 1 },
      requests: [
        { id: "A", title: "长上下文问答", prompt: 8, goal: 5, generated: 2, ready: true, priority: 2, arrival: 0 },
        { id: "B", title: "快速说明", prompt: 4, goal: 2, ready: true, priority: 3, arrival: 0 },
        { id: "C", title: "新来的文档", prompt: 12, goal: 3, priority: 2, arrival: 1 },
        { id: "D", title: "稍后到达的任务", prompt: 4, goal: 2, priority: 1, arrival: 5 }
      ]
    },
    challenge1: {
      name: "进阶1 · 合法，但安全吗？", challenge: true,
      description: "比较同批Decode与给D读入6个Token：本轮放得下，不代表下一轮还有路。", target: 30,
      config: { tokens: 6, blocks: 8, blockSize: 4, cpu: 0, ssd: 0, cpuRate: 2, ssdRate: 1 },
      requests: [
        { id: "A", title: "跨块边界的回答", prompt: 8, generated: 4, ready: true, goal: 7, priority: 2, arrival: 0 },
        { id: "B", title: "高优先级请求", prompt: 4, generated: 3, ready: true, goal: 6, priority: 3, arrival: 0 },
        { id: "C", title: "刚读完题的请求", prompt: 4, ready: true, goal: 4, priority: 1, arrival: 0 },
        { id: "D", title: "等待读入的新问题", prompt: 10, goal: 3, priority: 2, arrival: 0 }
      ]
    },
    challenge2: {
      name: "进阶2 · 满载后的腾挪", challenge: true,
      description: "GPU已满，CPU总共2块但只空闲1块。比较换出目的地与重算代价。", target: 30,
      config: { tokens: 6, blocks: 6, blockSize: 4, cpu: 2, cpuReserved: 1, ssd: 8, cpuRate: 2, ssdRate: 1 },
      requests: [
        { id: "A", title: "高优先级回答", prompt: 8, generated: 4, ready: true, goal: 7, priority: 3, arrival: 0 },
        { id: "B", title: "另一条活跃回答", prompt: 4, generated: 4, ready: true, goal: 7, priority: 2, arrival: 0 },
        { id: "C", title: "尚未读完的上下文", prompt: 12, cached: 4, goal: 3, priority: 1, arrival: 0 }
      ]
    },
    challenge3: {
      name: "进阶3 · 谁值得先服务？", challenge: true,
      description: "高优先级首Token、久等的读题请求、连续输出之间没有唯一权重。先选目标再排两轮。", target: 30,
      config: { tokens: 6, blocks: 10, blockSize: 4, cpu: 0, ssd: 0, cpuRate: 2, ssdRate: 1 },
      requests: [
        { id: "A", title: "持续输出的回答", prompt: 8, generated: 5, ready: true, goal: 9, priority: 1, arrival: 0 },
        { id: "B", title: "等首Token的高优请求", prompt: 4, ready: true, goal: 3, priority: 3, arrival: -2 },
        { id: "C", title: "已经久等的读题请求", prompt: 10, cached: 4, goal: 3, priority: 2, arrival: -7 }
      ]
    },
    challenge4: {
      name: "进阶4 · 结束前也要有空间", challenge: true,
      description: "A再生成1个Token就触发输出上限，但GPU已满。先检查峰值，再选择牺牲谁的缓存。", target: 30,
      config: { tokens: 6, blocks: 6, blockSize: 4, cpu: 0, ssd: 0, cpuRate: 2, ssdRate: 1 },
      requests: [
        { id: "A", title: "已知即将达到长度上限", prompt: 5, generated: 3, ready: true, goal: 4, knownLimit: 4, priority: 2, arrival: 0 },
        { id: "B", title: "缓存较长的回答", prompt: 7, generated: 1, ready: true, goal: 4, priority: 2, arrival: 0 },
        { id: "C", title: "缓存较短的回答", prompt: 4, generated: 1, ready: true, goal: 4, priority: 2, arrival: 0 }
      ]
    },
    challenge5: {
      name: "进阶5 · 急单插队", challenge: true, dynamic: true,
      description: "5块GPU缓存、每轮4 Token。C在第2片、D在第5片到达；给急单留空间也要照顾旧请求。", target: 35,
      config: { tokens: 4, blocks: 5, blockSize: 4, cpu: 2, ssd: 0, cpuRate: 2, ssdRate: 1 },
      requests: [
        { id: "A", title: "持续生成的旧回答", prompt: 8, generated: 1, ready: true, goal: 6, priority: 1, arrival: 0 },
        { id: "B", title: "读到一半的长问题", prompt: 12, cached: 4, goal: 3, priority: 2, arrival: 0 },
        { id: "C", title: "新到达的高优急单", prompt: 4, goal: 2, priority: 3, arrival: 2 },
        { id: "D", title: "第二波新请求", prompt: 6, goal: 3, priority: 2, arrival: 5 }
      ]
    },
    challenge6: {
      name: "进阶6 · 搬运时的突发流量", challenge: true, dynamic: true,
      description: "GPU开局满载。两条急单会在搬运期间到达，比较快速释放1块和慢速释放2块的接入代价。", target: 40,
      config: { tokens: 4, blocks: 5, blockSize: 4, cpu: 2, cpuReserved: 1, ssd: 6, cpuRate: 2, ssdRate: 1 },
      requests: [
        { id: "A", title: "正在回答的中优请求", prompt: 6, generated: 2, ready: true, goal: 5, priority: 2, arrival: 0 },
        { id: "B", title: "占两块的低优回答", prompt: 4, generated: 4, ready: true, goal: 7, priority: 1, arrival: 0 },
        { id: "C", title: "已经缓存一块的读题请求", prompt: 8, cached: 4, goal: 3, priority: 2, arrival: 0 },
        { id: "D", title: "第一条突发急单", prompt: 4, goal: 2, priority: 3, arrival: 1 },
        { id: "E", title: "第二条突发急单", prompt: 6, goal: 3, priority: 3, arrival: 2 }
      ]
    },
    challenge7: {
      name: "进阶7 · 不能全接的双波请求", challenge: true, dynamic: true,
      description: "6块GPU缓存，无CPU/SSD。新请求接连到达，每次抢占都要算清重建成本与公平性。", target: 40,
      config: { tokens: 6, blocks: 6, blockSize: 4, cpu: 0, ssd: 0, cpuRate: 2, ssdRate: 1 },
      requests: [
        { id: "A", title: "占三块的低优回答", prompt: 8, generated: 4, ready: true, goal: 9, priority: 1, arrival: 0 },
        { id: "B", title: "仍有块内空位的回答", prompt: 4, generated: 1, ready: true, goal: 4, priority: 2, arrival: 0 },
        { id: "C", title: "第一波高优长输入", prompt: 8, goal: 3, priority: 3, arrival: 1 },
        { id: "D", title: "紧接着到达的高优请求", prompt: 4, goal: 2, priority: 3, arrival: 2 },
        { id: "E", title: "后来到达的普通请求", prompt: 6, goal: 3, priority: 2, arrival: 4 }
      ]
    },
    challenge8: {
      name: "进阶8 · 长读题夹着短急单", challenge: true, dynamic: true,
      description: "每轮4 Token、GPU仅5块。连续推进长Prefill会用完空间，而短急单在第1、3、5片到达。", target: 40,
      config: { tokens: 4, blocks: 5, blockSize: 4, cpu: 2, ssd: 4, cpuRate: 1, ssdRate: 1 },
      requests: [
        { id: "A", title: "接近块边界的旧回答", prompt: 6, generated: 1, ready: true, goal: 5, priority: 2, arrival: 0 },
        { id: "B", title: "长输入的分块Prefill", prompt: 12, cached: 4, goal: 3, priority: 1, arrival: 0 },
        { id: "C", title: "第一条短急单", prompt: 4, goal: 2, priority: 3, arrival: 1 },
        { id: "D", title: "第三片到达的文档请求", prompt: 8, goal: 3, priority: 3, arrival: 3 },
        { id: "E", title: "第五片到达的短请求", prompt: 4, goal: 3, priority: 2, arrival: 5 }
      ]
    }
  };

  function blocksFor(tokens, state) { return Math.ceil(tokens / state.config.blockSize); }
  function status(r) {
    if (r.done) return "done";
    if (r.location !== "gpu") return "stored";
    return r.cached < r.prompt + r.generated ? "prefill" : "decode";
  }
  function usage(state, location = "gpu") {
    return state.requests.filter(r => !r.done && r.location === location)
      .reduce((total, r) => total + blocksFor(r.cached, state), location === "cpu" ? state.config.cpuReserved || 0 : 0);
  }
  function visible(state) { return state.requests.filter(r => r.arrival <= state.time); }
  function forecast(state) {
    return state.requests.filter(r=>r.arrival>0).sort((a,b)=>a.arrival-b.arrival).map(r=>({
      id:r.id, title:r.title, arrival:r.arrival, prompt:r.prompt, priority:r.priority,
      status:r.arrival>state.time ? "future" : status(r)
    }));
  }
  function finished(state) { return state.requests.every(r => r.done); }
  function create(levelId = "start", overrides = {}) {
    const level = LEVELS[levelId] || LEVELS.start;
    if (level.challenge && Object.entries(overrides).some(([key,value]) => value !== level.config[key])) {
      throw new Error("情景题资源固定，不能修改题目预算。普通关卡仍可自定义。");
    }
    const config = { ...level.config, ...overrides };
    for (const key of ["tokens", "blocks", "blockSize", "cpuRate", "ssdRate"]) {
      if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error("资源配置必须为正整数");
    }
    for (const key of ["cpu", "ssd"]) {
      if (!Number.isInteger(config[key]) || config[key] < 0) throw new Error("存储容量不能为负数");
    }
    if (!Number.isInteger(config.cpuReserved || 0) || (config.cpuReserved || 0) < 0 || (config.cpuReserved || 0) > config.cpu) throw new Error("CPU固定占用不能超过容量");
    const state = {
      version: 1, levelId, config, time: 0, turns: 0,
      work: 0, capacity: 0, recomputed: 0, transferred: 0, transferTime: 0, preemptions: 0,
      requests: level.requests.map(source => {
        const generated = source.generated || 0;
        const cached = source.cached ?? (source.ready ? source.prompt + generated : 0);
        return { ...source, generated, cached, location: "gpu", done: false, completedAt: null,
          lastService: source.arrival, firstService: source.ready ? 0 : null, replayUntil: 0 };
      }),
      decisions: [],
      log: [{ time: 0, message: "你已接班。先检查请求阶段、Token预算和GPU缓存块，再提交一轮计划。" }]
    };
    if (usage(state) > config.blocks) throw new Error("初始活跃缓存超过GPU块数，请增加块预算");
    return state;
  }
  function plan(state, phase, allocations) {
    const errors = [];
    const changes = [];
    let tokens = 0;
    let extra = 0;
    const seen = new Set();
    if (finished(state)) errors.push("本关已完成，可以复盘或重新开局。");
    if (!["prefill", "decode"].includes(phase)) errors.push("请选择Prefill或Decode。");
    for (const item of allocations) {
      if (seen.has(item.id)) { errors.push("同一请求只能安排一次。"); continue; }
      seen.add(item.id);
      const r = state.requests.find(request => request.id === item.id);
      if (!r || r.arrival > state.time || r.done) { errors.push(`${item.id}当前不可调度。`); continue; }
      const n = Number(item.tokens);
      if (!Number.isInteger(n) || n < 0) { errors.push(`${r.id}的Token数量必须是非负整数。`); continue; }
      if (n === 0) continue;
      if (status(r) !== phase) {
        errors.push(`${r.id}当前${r.location !== "gpu" ? "在存储层，需要先取回缓存" : status(r) === "prefill" ? "还没读完上下文，需要Prefill" : "已经读完上下文，需要Decode"}。`);
        continue;
      }
      const remaining = r.prompt + r.generated - r.cached;
      if (phase === "prefill" && n > remaining) errors.push(`${r.id}只剩${remaining}个上下文Token未处理，不能安排${n}个。`);
      if (phase === "decode" && n !== 1) errors.push("本游戏关闭推测解码，每个Decode请求每轮只能推进1个Token。");
      const need = blocksFor(r.cached + n, state) - blocksFor(r.cached, state);
      tokens += n;
      extra += need;
      changes.push({ id: r.id, tokens: n, extraBlocks: need });
    }
    if (tokens > state.config.tokens) errors.push(`Token超预算：计划${tokens}，本轮最多${state.config.tokens}。`);
    const free = state.config.blocks - usage(state);
    if (extra > free) errors.push(`KV块不足：需要新增${extra}块，GPU当前只空闲${free}块。`);
    if (tokens === 0) errors.push("还没有安排任务；若想等待新请求，可以点击“空等1片”。");
    return { ok: errors.length === 0, errors, tokens, extraBlocks: extra, freeAfter: free - extra, changes };
  }
  function advance(state, duration) {
    const oldTime = state.time;
    state.time += duration;
    for (const r of state.requests) {
      if (r.arrival > oldTime && r.arrival <= state.time) state.log.push({ time: r.arrival, message: `新请求${r.id}到达：输入${r.prompt} Token，优先级${r.priority}。` });
    }
  }
  function execute(original, phase, allocations) {
    const check = plan(original, phase, allocations);
    if (!check.ok) return { ok: false, state: original, ...check };
    const state = clone(original);
    const messages = [];
    for (const item of check.changes) {
      const r = state.requests.find(request => request.id === item.id);
      if (phase === "prefill") {
        const overlap = Math.max(0, Math.min(r.cached + item.tokens, r.replayUntil) - r.cached);
        state.recomputed += overlap;
        r.cached += item.tokens;
        messages.push(`${r.id}读入${item.tokens}个Token${overlap ? `（其中${overlap}个为重算）` : ""}，${status(r) === "decode" ? "下一轮可Decode" : `尚余${r.prompt + r.generated - r.cached}个`}`);
      } else {
        r.cached += 1;
        r.generated += 1;
        messages.push(`${r.id}生成1个Token`);
        if (r.generated >= r.goal) {
          r.done = true;
          r.completedAt = state.time + 1;
          const released = blocksFor(r.cached, state);
          r.cached = 0;
          messages.push(`${r.id}遇到结束条件，释放${released}块缓存`);
        }
      }
      r.lastService = state.time + 1;
      if (r.firstService === null) r.firstService = state.time;
    }
    state.turns += 1;
    state.work += check.tokens;
    state.capacity += state.config.tokens;
    (state.decisions ||= []).push({ type: "compute", time: state.time, phase, allocations: check.changes.map(r => ({ id: r.id, tokens: r.tokens })), extraBlocks: check.extraBlocks });
    advance(state, 1);
    state.log.push({ time: state.time, message: `${phase === "prefill" ? "Prefill" : "Decode"}完成：${messages.join("；")}。` });
    return { ok: true, state, check };
  }
  function reclaim(original, id, destination) {
    const request = original.requests.find(r => r.id === id);
    const fail = message => ({ ok: false, state: original, errors: [message] });
    if (!request || request.done || request.arrival > original.time) return fail("该请求当前不可操作。");
    if (finished(original)) return fail("本关已经完成。");
    if (destination === "restore") {
      if (request.location === "gpu") return fail("这个请求已经在GPU上。");
      const need = blocksFor(request.cached, original);
      if (need > original.config.blocks - usage(original)) return fail(`取回需要${need}块GPU空间；请先释放足够的缓存块。`);
    } else {
      if (request.location !== "gpu" || request.cached === 0) return fail("只能操作GPU上已有缓存的请求。");
      if (!["recompute", "cpu", "ssd"].includes(destination)) return fail("未知的缓存操作。");
      if (destination !== "recompute" && usage(original, destination) + blocksFor(request.cached, original) > original.config[destination]) return fail(`${destination.toUpperCase()}剩余容量不够，不能换出这个请求。`);
    }
    const state = clone(original);
    const r = state.requests.find(item => item.id === id);
    const blocks = blocksFor(r.cached, state);
    const decision = { type: "memory", time: state.time, id, destination, cached: r.cached, blocks };
    if (destination === "recompute") {
      const dropped = r.cached;
      r.replayUntil = Math.max(r.replayUntil, dropped);
      r.cached = 0;
      state.preemptions += 1;
      state.log.push({ time: state.time, message: `抢占${r.id}：释放${blocks}块GPU缓存，保留输入与${r.generated}个已输出Token；之后要重新Prefill已知上下文。此操作本身不消耗时间片。` });
    } else {
      const from = r.location;
      const tier = destination === "restore" ? from : destination;
      const cost = Math.ceil(blocks / state.config[`${tier}Rate`]);
      r.location = destination === "restore" ? "gpu" : destination;
      state.transferred += blocks;
      state.transferTime += cost;
      advance(state, cost);
      state.log.push({ time: state.time, message: `${r.id}的${blocks}块缓存从${from.toUpperCase()}搬到${r.location.toUpperCase()}，耗时${cost}片，缓存内容保留。${destination === "restore" ? "GPU空间已重新占用。" : "GPU空间现已释放。"}` });
    }
    (state.decisions ||= []).push(decision);
    return { ok: true, state };
  }
  function idle(original) {
    if (finished(original)) return { ok: false, state: original, errors: ["本关已完成。"] };
    const state = clone(original);
    (state.decisions ||= []).push({ type: "idle", time: state.time });
    advance(state, 1);
    state.log.push({ time: state.time, message: "空等1片。已有缓存仍然占用资源，没有自动清空。" });
    return { ok: true, state };
  }
  function hint(state) {
    if (finished(state)) return "本关完成。比较时间、重算量与搬运量，再换一种方案挑战自己。";
    const current = visible(state).filter(r => !r.done);
    const decodes = current.filter(r => status(r) === "decode").sort((a,b) => b.priority - a.priority || b.generated - a.generated);
    for (const r of decodes) {
      const result = plan(state, "decode", [{ id: r.id, tokens: 1 }]);
      if (result.ok) return `${r.id}已读完上下文，本轮能继续Decode。你也可以选择多个可运行请求同批输出；不要把“已输出多”当成“马上结束”。`;
    }
    const prefills = current.filter(r => status(r) === "prefill");
    const free = state.config.blocks - usage(state);
    for (const r of prefills) {
      const slots = (blocksFor(r.cached, state) + free) * state.config.blockSize - r.cached;
      const n = Math.min(slots, state.config.tokens, r.prompt + r.generated - r.cached);
      if (n > 0) return `${r.id}可先做Prefill，例如安排${n}个Token。部分读题后缓存会留下，下一轮预算会重置。`;
    }
    const stored = current.find(r => r.location !== "gpu");
    if (stored && blocksFor(stored.cached, state) <= free) return `${stored.id}的缓存还在${stored.location.toUpperCase()}，先取回再计算。取回要耗时，也要重新占GPU块。`;
    if (current.some(r => r.location === "gpu" && r.cached > 0)) return "GPU块紧张。比较抢占重算与换到CPU/SSD的代价；也检查是否有请求能在现有块内继续生成。";
    return "暂时没有可执行任务，可以空等1片，等待后续请求到达。";
  }
  function stats(state) {
    const done = state.requests.filter(r => r.done);
    const average = done.length ? done.reduce((n,r) => n + r.completedAt - r.arrival,0) / done.length : 0;
    const score = Math.max(0, Math.round(100 - state.time * 1.5 - state.recomputed * 0.4 - state.preemptions * 2));
    return { done: done.length, total: state.requests.length, allDone: finished(state), average,
      gpu: usage(state), cpu: usage(state,"cpu"), ssd: usage(state,"ssd"),
      utilization: state.capacity ? state.work / state.capacity : 0, score,
      longestWait: Math.max(0, ...visible(state).filter(r=>!r.done).map(r=>state.time - Math.max(r.arrival,r.lastService))) };
  }
  const api = { LEVELS, create, clone, blocksFor, status, usage, visible, forecast, finished, plan, execute, reclaim, idle, hint, stats };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SchedulerGame = api;
})(typeof globalThis === "object" ? globalThis : this);
