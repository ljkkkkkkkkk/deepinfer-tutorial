/* Hand-authored teaching feedback. No remote model, hidden-length oracle, or strategy grading. */
(function (root) {
  "use strict";
  const number = (id,label,answer,explanation) => ({id,label,answer:String(answer),explanation,type:"number"});
  const choice = (id,label,options,answer,explanation) => ({id,label,options,answer,explanation,type:"choice"});
  const CASES = {
    challenge1: {
      title:"合法，但安全吗？", focus:"本轮合法 ≠ 后续安全", subtitle:"比较甲：A、B、C同批Decode；乙：D做6个Token的Prefill。",
      conditions:["每轮6 Token；GPU共8块，初始占6块、空闲2块。每块4个位置。", "A缓存12位置/3块，B缓存7位置/2块，C缓存4位置/1块；D输入10个Token，尚未读题。", "CPU/SSD不可用。若讨论后续卡住的风险，按“没有请求提前结束”的条件推演；实际结束后应重新判断。"],
      questions:["甲、乙各消耗多少Token、新增多少块？本轮是否合法？", "若选乙且无人结束，接下来还有谁能推进？何时会卡在块边界？", "选甲、选乙或提出第三种安排，并解释后路。"],
      checks:[number("aTokens","甲：消耗Token",3,"三个Decode请求各生成1个Token，共3个。"),number("aBlocks","甲：新增块",2,"A从12到13新增1块；B从7到8不增块；C从4到5新增1块。"),number("bTokens","乙：消耗Token",6,"D读入6个Token。"),number("bBlocks","乙：新增块",2,"D从0到6，占ceil(6/4)=2块。两个方案本轮都合法。")],
      goals:["先推进A/B/C","先给D读题","第三种安排"],
      reflection:"写下你选择的方案、下一步谁还能算，以及如果没人结束会怎么办。",
      hints:["先算每个请求的“块数差”，不要把所有Decode都当成必须申请新块。", "D读6后占2块，GPU用满。再看A=12、B=7、C=4、D=6距离各自块边界还有多少空位。", "乙之后B可到8、D可到8，但在无人结束的条件下，最终所有未完成请求都需要新块。甲也需要逐轮检查，不能理解为永不卡住。"],
      analysis:["甲消耗3 Token、新增2块；乙消耗6 Token、新增2块，都合法。", "乙会占满GPU。此后B还能生成1个Token，D还能读2个；若无人完成，A=12、B=8、C=4、D=8都会卡在块边界。此时只能抢占重算来腾空间。", "甲照顾已有输出与高优先级B，乙推进新请求。也可以先给D读4个，只占1块。关键是说明选择目标、给谁留出跨块空间，而不是把填满Token当作唯一目标。"]
    },
    challenge2: {
      title:"满载后的腾挪", focus:"总容量 ≠ 当前可用容量", subtitle:"已经没有可直接执行的计算。比较换出目的地与重算代价。",
      conditions:["每轮6 Token；GPU共6块且已满。A=12位置/3块，B=8位置/2块，C已读4/12位置、占1块。", "CPU总容量2块，其中1块由其他任务固定占用，本题不能移动；只剩1块空闲。SSD空闲8块。", "CPU每片搬2块，SSD每片搬1块，向上取整。搬运期间暂停计算，取回还要再付一次搬运费。"],
      questions:["现在有没有请求能直接计算？A、B、C谁能换到CPU？", "换到CPU、SSD或抢占重算，选谁？为什么？", "腾出空间后安排哪一轮计算？核对新增块和Token。"],
      checks:[choice("runnable","开局能直接计算的请求",[["none","都不能"],["A","A"],["B","B"],["C","C"]],"none","A、B下一Token都要新增1块；C读第5个位置也要新增1块，GPU没有空闲。"),choice("cpuFit","开局谁能完整换到CPU",[["C","只有C"],["AB","A、B"],["BC","B、C"],["all","全部"]],"C","CPU实际只空闲1块，只有占1块的C能放下。"),number("cpuCost","C换到CPU：单程时间片",1,"ceil(1/2)=1片；以后取回至少还需1片。"),number("ssdCost","B换到SSD：单程时间片",2,"B占2块，SSD每片搬1块，需要2片。")],
      goals:["换出C到CPU","换出某请求到SSD","抢占重算","其他安排"],
      reflection:"写下腾挪对象与目的地、下一轮计算，以及恢复时需要的空间和代价。",
      hints:["A、B、C都正好位于块边界。CPU的2块不是都能用，灰色“他”块一直保留。", "C换到CPU可释放1块，足以让A或B跨一个边界；但通常不能让A、B同批跨界。", "抢占C只丢掉已计算的4个位置；恢复完整12位置还要读8个新位置。重算量与总待Prefill量不要混为一谈。"],
      analysis:["开局没有可直接计算的请求。CPU仅C放得下；SSD可放A、B或C，单程分别3、2、1片。", "一种路线是C换到CPU，用1片释放1块，再推进高优先级A。也可用SSD腾出更多块，或抢占缓存；没有给定业务权重时，不唯一判最优。", "抢占A/B/C会分别丢掉12/8/4个已计算位置；C本来还有8个没读，重建完成需要总计12个Prefill位置，其中4个是重复工作。", "恢复不是免费：取回需要GPU能装下完整缓存，搬运再计时；抢占后则用后续Token预算重建。"]
    },
    challenge3: {
      title:"谁值得先服务？", focus:"先选目标，再排两轮", subtitle:"对比高优先级首Token、久等请求与正在输出的回答。",
      conditions:["每轮6 Token；GPU共10块，初始占6块、空闲4块。CPU/SSD不可用。", "A=13位置/4块、优先级1，上一轮刚服务；B=4位置/1块、优先级3，还没输出首Token，已等2片。", "C输入共10个Token，已缓存4位置/1块、尚余6个，优先级2，已连续7片未服务。负数到达时间表示接班前已在等待。"],
      questions:["给出接下来两轮的阶段、请求、Token分配与新增块。", "优先照顾了谁？谁的首Token或输出连续性受到影响？", "如果业务要求变成高优先级首Token优先，你会怎么调整？"],
      checks:[number("decodeTokens","开局A+B同批Decode：Token",2,"A、B各生成1个Token。"),number("decodeBlocks","开局A+B同批Decode：新增块",1,"A从13到14仍占4块；B从4到5需要第2块。"),number("prefillTokens","开局读完C剩余上下文：Token",6,"C输入10、已缓存4，剩余6。"),number("prefillBlocks","开局读完C：新增块",2,"C从1块增长到ceil(10/4)=3块，新增2块。")],
      goals:["高优先级B尽快得到首Token","优先缓解C的久等","优先保持A输出连续","平衡多个目标"],
      reflection:"写下两轮安排及其代价，再写出切换到“B首Token优先”时的调整。策略文字只保存，不自动判对错。",
      hints:["A+B同批Decode与读完C在开局都可行。这里不是寻找唯一能执行的按钮。", "先Decode A+B能让B立刻看到首Token；先Prefill C能结束C长时间没得到服务的状态。读完题不等于已输出首Token。", "例如先Decode A+B，再Prefill C；也可以先Prefill C，再同批Decode A/B/C。两种合法路线的等待与连续性不同，按你的目标解释取舍。"],
      analysis:["先Decode A+B，再Prefill C：第一轮消耗2 Token、增1块；第二轮消耗6 Token、增2块。B较早得到首Token，但C再等一片、A第二轮暂停输出。", "先Prefill C，再Decode A/B/C：第一轮6 Token、增2块；第二轮3 Token、增1块（B跨块，A和C利用现有空位）。C较早被服务，B的首Token推迟一片。", "两者都合法，没有统一业务权重就不应强行评成唯一答案。若明确B首Token优先，第一轮应包含B的Decode；不能靠已输出长度猜剩余长度。"]
    },
    challenge4: {
      title:"结束前也要有空间", focus:"先通过峰值检查，再谈释放", subtitle:"A下一Token一定触发长度上限，但执行前仍必须有缓存可写。",
      conditions:["每轮6 Token；GPU共6块且已满。CPU/SSD不可用，只能抢占重算。", "A输入5、已输出3，缓存8位置/2块；B输入7、已输出1，缓存8位置/2块；C输入4、已输出1，缓存5位置/2块。", "A设置最多输出4个Token，所以再成功生成1个就结束。这是明确配置，不是提前知道自然结束位置；B、C最终输出长度仍未知。"],
      questions:["A一定会结束，就能直接执行吗？峰值需要多少块？", "C能否直接Decode？这样是否一定能解决A的问题？", "抢占B或C让A先完成，你选谁？之后重建多少位置、最少几轮？"],
      checks:[choice("canA","开局能否直接执行A",[["no","不能"],["yes","能，结束后释放就够"]],"no","不能借用尚未发生的释放。A从8到9需要新增1块，但开局空闲0块。"),number("aBlocks","A下一步：新增块",1,"ceil(9/4)-ceil(8/4)=1。A运行时自身需要3块，总峰值7块超过6块。"),choice("canC","开局能否直接执行C",[["yes","能，但不保证能解救A"],["no","不能，GPU满了"]],"yes","C从5到6不需要新块，可以运行；除非完成释放缓存，否则A仍无新块可用。"),number("bReplay","抢占B后：需重建位置",8,"保留7个输入+1个已输出Token，要重建8个上下文位置。"),number("bRounds","B重建：最少Prefill轮数",2,"每轮最多6个，ceil(8/6)=2；假设空间允许且预算全给B。"),number("cReplay","抢占C后：需重建位置",5,"4个输入+1个已输出Token，共5个。"),number("cRounds","C重建：最少Prefill轮数",1,"ceil(5/6)=1，仍以空间允许、预算全给C为前提。")],
      goals:["抢占B，先完成A","抢占C，先完成A","先推进C再观察","其他安排"],
      reflection:"写下你腾空间的选择、A执行前的峰值检查，以及被抢占请求的恢复预算。",
      hints:["A现在占2块，下一位置是9，自身需要3块。结束释放发生在成功生成之后。", "B和C都能释放2块，但需要重建的已知上下文分别为8和5个位置。", "若业务目标与优先级相同、只比较这次恢复代价，抢占C少重算3个位置、少1轮独占预算的Prefill。若先推进C，也不能假定它下一Token必结束。"],
      analysis:["A不能直接执行：运行前需要新增1块，总峰值7/6块。即使已知生成后释放，也不能跳过峰值检查。C可直接运行，因为5到6仍占2块，但不能保证立刻释放缓存。", "抢占B或C都立即释放2块。随后A从8到9新增1块，峰值为5/6块；A达到上限后释放自身3块。", "抢占B重建8位置，至少2轮Prefill；抢占C重建5位置，至少1轮。若其他目标相同，C的恢复代价更低。输入与已输出Token保留，重建不重新生成那些文字。"]
    }
  };
  function check(id, answers = {}) {
    return CASES[id].checks.map(field => {
      const value = String(answers[field.id] ?? "").trim();
      const answered = value !== "";
      const correct = answered && (field.type === "number" ? Number(value) === Number(field.answer) && Number.isInteger(Number(value)) : value === field.answer);
      return { id:field.id, label:field.label, answered, correct, explanation:field.explanation };
    });
  }
  function review(state,G) {
    const result=[];
    const decisions=state.decisions || [];
    const computes=decisions.filter(d=>d.type==="compute");
    if (!decisions.length) return ["还没操作。先填写你的核算与策略，再在下方工作台试两轮；初始题面始终保留，答案不会随运行状态改变。"];
    if (state.levelId === "challenge1" && computes[0]?.phase === "prefill") {
      const n=computes[0].allocations.find(a=>a.id==="D")?.tokens || 0;
      if (n>4) result.push("你第一轮给D读入超过4个位置，占用2块并填满GPU。在无人结束的条件下，B和D即使暂时还能推进，也可能随后一起卡在块边界；检查后路，不要只看本轮合法。");
      else if (n>0) result.push("你先分块读D，没有一次用掉两块空闲块。检查这块余量接下来给谁跨边界，而不是默认永远安全。");
    }
    if (state.levelId === "challenge2") {
      const m=decisions.find(d=>d.type==="memory");
      if (m) result.push(`你的首次腾挪是${m.id}${m.destination==="recompute" ? "抢占重算" : "换到"+m.destination.toUpperCase()}，涉及${m.blocks}块、${m.cached}个已计算位置。${m.destination==="recompute" ? "之后重建消耗Token；对未读完的C，要区分重算部分与原本未读部分。" : "记得取回还要付费，GPU也必须接得住。"}`);
    }
    if (state.levelId === "challenge3") {
      const first=computes[0];
      if (first) result.push(first.phase==="decode" && first.allocations.some(a=>a.id==="B") ? "你的第一轮包含B的Decode，让高优先级请求先看到首Token；也要交代C再等一片、A是否中断的代价。" : first.phase==="prefill" && first.allocations.some(a=>a.id==="C") ? "你的第一轮服务了久等的C；Prefill本身不会输出首Token，B的首次输出和A的连续性仍需权衡。" : "比较第一轮是否服务B或C，并在策略笔记中解释为什么照顾A或其他目标。");
      result.push(`已执行${computes.length}轮计算。题目要求比较前两轮，不必等全部完成才复盘；合法性由工作台核算，目标取舍由你解释。`);
    }
    if (state.levelId === "challenge4") {
      const m=decisions.find(d=>d.type==="memory" && d.destination==="recompute");
      if (m) result.push(`你抢占了${m.id}：释放${m.blocks}块，丢弃${m.cached}个已计算位置。若完整重建且每轮预算全给它，至少需要${Math.ceil(m.cached/state.config.tokens)}轮Prefill；实际恢复仍要检查空间。`);
      if (state.requests.find(r=>r.id==="A").done) result.push("A已达到明确的输出上限并释放缓存。工作台是在成功通过执行前的峰值检查后才释放，并未提前借用这部分空间。");
    }
    const active=G.visible(state).filter(r=>!r.done);
    if (active.length) {
      const runnable=active.filter(r=>G.status(r)!=="stored" && G.plan(state,G.status(r),[{id:r.id,tokens:1}]).ok);
      result.push(runnable.length ? `当前至少能推进1个Token的请求：${runnable.map(r=>r.id).join("、")}。这不是自动推荐最优顺序，请继续比较业务目标。` : "当前没有任何请求能直接推进1个Token。先检查存储恢复或腾空间；空等本身不会自动释放缓存。");
    } else result.push("所有请求已完成。操作结果、核算答案和目标取舍应分别复盘，不能只用总时间判定所有策略的优劣。");
    return result;
  }
  const api={CASES,check,review};
  if (typeof module === "object" && module.exports) module.exports=api;
  else root.SchedulerChallenges=api;
})(typeof globalThis === "object" ? globalThis : this);
