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
    },
    challenge5: {
      dynamic:true, title:"急单插队", focus:"留空间，不等于只留读题空间", subtitle:"旧回答还在生成，新急单C与第二波D会在运行中进入队列。",
      conditions:["每轮4 Token；GPU共5块，初始A占3块（9位置）、B占1块（已读4/12位置），仅空闲1块。CPU空闲2块、每片搬2块；SSD不可用。", "C在T+2结束时到达：输入4 Token、优先级3；D在T+5结束时到达：输入6 Token、优先级2。A优先级1，B优先级2。", "到达后下一轮才可调度。到达计划是已知题设，回答会生成多长仍未知；每次结束、换出、重算后重新评估。"],
      questions:["第一轮继续A，还是给B读4个Token？分别算缓存增量与后路。", "C到达后，读完4个输入需要几块？第一个输出Token还要不要新块？", "写出前3轮安排，并在D到达时重新决定是否接入；若延后B，如何避免一直饿死它？"],
      checks:[number("initialFree","开局GPU空闲块",1,"A占ceil(9/4)=3块，B占1块，5-3-1=1。"),number("cFirstRound","C最早可参与的计算轮次",3,"C在第2片结束时到达，最早参与第3轮；不能安排进导致它到达的那一轮。"),number("bAfter","假设首轮给B读4：GPU总占块",5,"B从4到8增加1块；A仍3块，合计5块。A虽还能利用块内空位，之后仍要检查跨界。"),number("cPrefill","C从0读完4个输入：新增块",1,"4个位置占1块。是否能接入，还要看当时GPU空闲。"),number("cDecode","C读完4个输入后首次Decode：新增块",1,"从4到5要第2块。只留够Prefill的1块，不保证能输出首Token。")],
      goals:["急单C首Token优先","保持A输出连续","先推进B，控制长请求等待","分批接入，兼顾后续D"],
      reflection:"写明每一步使用的已知信息，以及C、D到达后如何改变原计划；不要用事后揭晓的结束长度倒推。",
      hints:["A从9到10不申请新块；B从4到8会新增1块。两种阶段消耗的Token不同，不能混在同一轮。", "急单C的输入4位置只占1块，但第5个位置需要第2块。把可接入与可继续回答分开判断。", "B当前只有1块缓存，CPU能放下；但换出和取回都计时。也可等待、分块或重算，按当时边界与业务目标比较，不要看到新请求就自动抢占。"],
      analysis:["第一轮A Decode消耗1 Token、新增0块；给B Prefill 4个Token消耗4、新增1块，GPU恰好用满。填满预算不是唯一目标。", "C最早第3轮可调度；完整读题需1块、首次输出再新增1块。若只腾出1块让C读完，而其他请求也卡边界，C仍可能不能出首Token。", "一种腾挪对象是B：换出当前1块缓存能放进CPU，单程1片；抢占则丢4个已计算位置，之后重建完整12位置，其中4个重复。题目不强迫使用某一种。", "D到达后重新核对等待与空间。提前给新请求留预算，不等于必须空等；对仍有块内空位的旧请求可以继续服务，并在笔记中说明何时恢复B。"]
    },
    challenge6: {
      dynamic:true, title:"搬运时的突发流量", focus:"腾得快，还是腾得够？", subtitle:"搬运会推进时间；急单不会因为GPU暂停计算就暂停到达。",
      conditions:["每轮4 Token；GPU共5块且满载：A缓存8位置/2块、B缓存8位置/2块、C已读4/8位置/1块。A、C优先级2，B优先级1。", "CPU总2块，其中其他任务固定占1块，只空闲1块；CPU每片搬2块。SSD空闲6块，每片搬1块。搬运期间停止计算，操作不可中途打断。", "D在T+1结束时到达：输入4、优先级3；E在T+2结束时到达：输入6、优先级3。没有硬性截止时间，需解释首Token、吞吐与恢复的取舍。"],
      questions:["比较开局C换到CPU与B换到SSD：何时能再次计算？释放多少块？", "如果B换到SSD，搬运结束前哪些新请求已到达？下一轮能否同时读完D、E？", "如果C换到CPU后立即读完D，是否已经留够D生成首Token的空间？给出后续腾挪或接入方案。"],
      checks:[choice("bCPU","开局B能否完整换到CPU",[["no","不能"],["yes","能，CPU总容量2块"]],"no","CPU只空闲1块，B需要2块，不能用总容量代替可用容量。"),number("bSSD","B换到SSD：单程耗时",2,"B占2块，SSD每片搬1块，需要2片；取回还要再计费。"),number("arrivals","从T+0搬B到SSD后：新到达数",2,"D在T+1、E在T+2到达，搬运完成时两者均已到达，可在下一次决策选择。"),number("cCPU","C换到CPU：单程耗时",1,"ceil(1/2)=1片；此时D到达，E尚未到达。"),number("dNext","D读完4输入后首次Decode：新增块",1,"4到5需要新块。C换出只腾1块，若全部给D读题，D首次输出仍需额外空间。")],
      goals:["快速响应第一条急单D","释放足够空间支持急单输出","尽量避免重算","兼顾E与旧请求的恢复"],
      reflection:"比较释放块数、单程与往返时间、搬运期间到达事件，以及取回时的GPU接纳条件。",
      hints:["C到CPU是1片换1块；B到SSD是2片换2块。更快返回工作台，不代表之后一定更快输出。", "B搬运期间D、E都会到达，但每轮只有4 Token，不能在一轮里读完4+6个输入。到达通知不代表已分配计算。", "若只释放1块又全用于D的4位置Prefill，GPU重新满载；A、B及D的下一步都要跨块。提前考虑再腾空间、换一种对象或调整接入顺序。"],
      analysis:["C到CPU单程1片、释放1块，可在T+1结束后响应D；B到SSD单程2片、释放2块，结束时D、E均已到达。不能在搬运的中间时间插入一次计算。", "B不能换到CPU，因为可用容量只有1块。若B用SSD，完整往返为4片；但多释放的空间可能支持D读题后继续生成，收益须结合后续安排判断。", "C换出后GPU从5块降到4块，D读4位置又占1块而满载。D首次Decode需要再新增1块，不能把Prefill成功当成首Token必然能生成。", "新请求到达后可重新权衡，不强迫先到先服务或一律抢占。恢复缓存时再检查完整块数与CPU/SSD占用，不要为了暂时不用的请求提前搬回数据。"]
    },
    challenge7: {
      dynamic:true, title:"不能全接的双波请求", focus:"无外存时，接入就是资源取舍", subtitle:"高优请求连续到达，但旧回答也不能靠“空等”自动腾出空间。",
      conditions:["每轮6 Token；GPU共6块，A缓存12位置/3块、优先级1，B缓存5位置/2块、优先级2，初始空闲1块。CPU/SSD不可用。", "C在T+1结束到达：输入8、优先级3；D在T+2结束到达：输入4、优先级3；E在T+4结束到达：输入6、优先级2。", "题面核算检查点：假设第一轮选择A+B Decode且两者都没结束。此假设只用于下面的检查点计算，不代表能预测后续自然结束位置。"],
      questions:["第一轮A+B能否同批运行？C在T+1到达后是否有GPU块可直接读题？", "在给定检查点，抢占A与抢占B分别释放多少块、丢多少已计算位置？为何不一定选重算最少的那个？", "D、E接连到达时，写出接入和恢复策略。如何避免为了每条新请求反复抢占同一个旧请求？"],
      checks:[number("firstBlocks","首轮A+B Decode：新增块",1,"A从12到13新增1块，B从5到6利用已有空位。"),number("afterFree","给定检查点：GPU空闲块",0,"A增长为4块，B仍2块，合计6块。C虽到达，却没有自动获得缓存。"),number("aReplay","检查点抢占A：丢弃已算位置",13,"首轮后A为13位置，重建必须保留其输入和已输出Token的完整上下文。"),number("bReplay","检查点抢占B：丢弃已算位置",6,"首轮后B为6位置，至少1轮独占6 Token预算可重建，仍须有空间。"),number("cFirstRound","C最早可参与的计算轮次",2,"C在T+1结束时到达，最早第2轮；但到达并不保证资源足够。")],
      goals:["让C、D尽快得到首Token","优先避免反复重算","照顾已开始输出的旧请求","控制所有请求的等待"],
      reflection:"在T+1、T+2、T+4三个到达点分别写下决策依据与恢复承诺；能利用现有块时不必立刻抢占。",
      hints:["开局A跨边界、B不跨边界，只新增1块，第一轮同批Decode合法。C到达不会自动扩大GPU。", "检查点A占4块、重建13位置；B占2块、重建6位置。A优先级低但重建贵，B重建便宜但优先级更高。", "B仍能在现有块内推进，A也可能有块内空位。先检查可运行请求，再决定是否为新请求腾空间；无法预知谁马上结束，不能把等待当成一定会释放。"],
      analysis:["第一轮A+B共2 Token、新增1块，峰值6/6。若都未结束，T+1时A=13位置、B=6位置，空闲0块；C只能排队或等待你腾空间。", "在该检查点抢占A释放4块、重建13位置，至少3轮独占6 Token预算；抢占B释放2块、重建6位置，至少1轮。两者都保留已输出文字，但代价与优先级不同。", "D、E会继续到达。可分块接入，明确要服务谁、为谁预留跨块空间；旧请求在存量块内仍可推进时，不必因新请求出现就自动清空缓存。", "本题无外存，缓存真正不够时只能等待可能的完成或抢占重算。不要用已输出多推断马上结束，也不要反复清空同一个请求却不给它重建与继续输出的机会。"]
    },
    challenge8: {
      dynamic:true, title:"长读题夹着短急单", focus:"Prefill预算之外，还要看Decode的后路", subtitle:"长输入可以分块，但连续读完它，可能挤掉随后急单的运行空间。",
      conditions:["每轮4 Token；GPU共5块，A缓存7位置/2块、优先级2，B已读4/12位置/1块、优先级1，初始空闲2块。", "CPU空闲2块、每片搬1块；SSD空闲4块、每片搬1块。C在T+1结束到达：输入4、优先级3；D在T+3结束到达：输入8、优先级3；E在T+5结束到达：输入4、优先级2。", "检查点假设前两轮都给B读4个Token，期间A未生成。此时即使B读完，也要重新检查第一个输出位置是否有缓存可写。"],
      questions:["B剩余上下文最少几轮能读完？连续读完后的GPU占用是多少？", "在给定检查点，A、B、C分别能否计算？先让A生成一个Token后，是否保证后续能继续？", "C、D到达时如何打断长Prefill、分块或换出缓存？说明何时恢复B，以及为何不一定把预算全填给它。"],
      checks:[number("bRemaining","开局B尚未读入的上下文位置",8,"B输入12、已缓存4，尚余8位置。"),number("prefillRounds","B读完剩余输入：最少轮数",2,"每轮4 Token，ceil(8/4)=2；以空间允许、预算全给B为前提。"),number("usedAfter","给定两轮Prefill后：GPU占块",5,"A仍2块，B缓存12位置占3块，GPU用满。"),number("aNext","该检查点A下一Token：新增块",0,"A从7到8仍占2块，能运行；再从8到9就需要新块。"),number("bNext","该检查点B首次输出：新增块",1,"B从12到13需要第4块，当前空闲0块，不能直接输出。")],
      goals:["尽快响应C、D的首Token","控制长Prefill对Decode的影响","减少搬运和重算","避免低优长请求一直等待"],
      reflection:"给出一套会根据到达与块边界调整的策略，而不是提前写死所有轮次。比较中断、搬运与重建的代价。",
      hints:["两轮B Prefill虽然都把4 Token用满，却把GPU从3块推到5块。C在第一轮后已到达，需要重新做接入判断。", "该检查点A还能从7到8，但下一次也会跨边界。B读完不等于能输出，C到达也不等于能入场。", "CPU只能放下完整2块以内的缓存：B读4后占2块尚可换出，读完12后占3块就放不进CPU。卸载资格会随你前面的读题决策变化。"],
      analysis:["B剩8位置，至少2轮Prefill。连续读完后A占2块、B占3块，GPU满载；A还能生成1个Token但不保证结束，B首次输出需要新增1块，C连读题也需要新块。", "如果A这一Token后没结束，则A=8、B=12都在块边界，新请求C也没缓存，需重新腾空间。不能用“先让A算一下”保证一定能解决拥塞。", "可在C到达后重新选择阶段、限制长Prefill的接入量，或比较换出与抢占。B缓存8位置/2块时可放入CPU，读到12位置/3块后却不能；当前能放不代表以后也能放。", "D、E的到达再次改变队列。搬运按完整块数耗时，本关CPU每片仅1块，不同于部分旧题的2块；恢复时也要考虑新请求占用的空间与旧请求的等待。"]
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
    if (CASES[state.levelId]?.dynamic) {
      const arrived=state.requests.filter(r=>r.arrival>0 && r.arrival<=state.time);
      result.push(`当前T+${state.time}，已到达的新请求：${arrived.length ? arrived.map(r=>r.id+"（T+"+r.arrival+"）").join("、") : "暂无"}。到达不等于已经读题或已生成首Token，需按当前资源重新接入。`);
      const urgent=arrived.filter(r=>!r.done && r.priority===3 && r.generated===0);
      if (urgent.length) result.push(`仍未输出首Token的高优请求：${urgent.map(r=>r.id+"（到达后"+(state.time-r.arrival)+"片）").join("、")}。Prefill算作服务，但不等于首Token已送达。`);
      const firstTransfer=decisions.find(d=>d.type==="memory" && ["cpu","ssd"].includes(d.destination));
      if (firstTransfer) {
        const duration=Math.ceil(firstTransfer.blocks/state.config[firstTransfer.destination+"Rate"]);
        const during=state.requests.filter(r=>r.arrival>firstTransfer.time && r.arrival<=firstTransfer.time+duration);
        result.push(`首次换出${firstTransfer.id}到${firstTransfer.destination.toUpperCase()}耗时${duration}片，期间${during.length ? during.map(r=>r.id).join("、")+"到达" : "没有新请求到达"}；搬运期间未插入计算，后续取回还需空间与时间。`);
      }
      const preempts=decisions.filter(d=>d.type==="memory" && d.destination==="recompute");
      const repeated=[...new Set(preempts.filter((d,i)=>preempts.slice(0,i).some(p=>p.id===d.id)).map(d=>d.id))];
      if (repeated.length) result.push(`你已多次抢占${repeated.join("、")}，检查是否反复重建又丢弃；为旧请求安排一次能持续推进的恢复窗口。`);
    }
    const active=G.visible(state).filter(r=>!r.done);
    if (active.length) {
      const runnable=active.filter(r=>G.status(r)!=="stored" && G.plan(state,G.status(r),[{id:r.id,tokens:1}]).ok);
      result.push(runnable.length ? `逐个单独检查时，可推进至少1个Token的请求：${runnable.map(r=>r.id).join("、")}。不代表能同批全选；还须合计Token、新增块并统一阶段。这不是自动推荐最优顺序。` : "当前没有任何请求能直接推进1个Token。先检查存储恢复或腾空间；空等本身不会自动释放缓存。");
    } else result.push("所有请求已完成。操作结果、核算答案和目标取舍应分别复盘，不能只用总时间判定所有策略的优劣。");
    return result;
  }
  const api={CASES,check,review};
  if (typeof module === "object" && module.exports) module.exports=api;
  else root.SchedulerChallenges=api;
})(typeof globalThis === "object" ? globalThis : this);
