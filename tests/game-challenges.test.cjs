const test=require("node:test");
const assert=require("node:assert/strict");
const G=require("../game-engine.js");
const C=require("../game-challenges.js");
test("all eight cases have questions, progressive hints and manual analysis",()=>{
  assert.equal(Object.keys(C.CASES).length,8);
  for(const [id,c] of Object.entries(C.CASES)) {
    assert.equal(G.LEVELS[id].challenge,true); assert.ok(c.questions.length>=3);
    assert.equal(c.hints.length,3); assert.ok(c.analysis.length>=3);
    assert.equal(C.check(id).every(r=>!r.answered && !r.correct),true);
  }
});
test("objective resource checks accept correct answers, not blank or fractional guesses",()=>{
  const answers={challenge1:{aTokens:"3",aBlocks:"2",bTokens:"6",bBlocks:"2"},challenge2:{runnable:"none",cpuFit:"C",cpuCost:"1",ssdCost:"2"},challenge3:{decodeTokens:"2",decodeBlocks:"1",prefillTokens:"6",prefillBlocks:"2"},challenge4:{canA:"no",aBlocks:"1",canC:"yes",bReplay:"8",bRounds:"2",cReplay:"5",cRounds:"1"},challenge5:{initialFree:"1",cFirstRound:"3",bAfter:"5",cPrefill:"1",cDecode:"1"},challenge6:{bCPU:"no",bSSD:"2",arrivals:"2",cCPU:"1",dNext:"1"},challenge7:{firstBlocks:"1",afterFree:"0",aReplay:"13",bReplay:"6",cFirstRound:"2"},challenge8:{bRemaining:"8",prefillRounds:"2",usedAfter:"5",aNext:"0",bNext:"1"}};
  for(const [id,a] of Object.entries(answers)) assert.equal(C.check(id,a).every(r=>r.correct),true,id);
  assert.equal(C.check("challenge1",{aTokens:"3.2"})[0].correct,false);
  assert.equal(C.check("challenge1",{aTokens:"   "})[0].answered,false);
  assert.equal(C.check("challenge4",{canA:"yes"})[0].correct,false);
});
test("dynamic feedback observes arrivals, transfer time and repeated preemption",()=>{
  let s=G.reclaim(G.create("challenge6"),"B","ssd").state;
  const review=C.review(s,G).join(" ");
  assert.ok(review.includes("T+2")); assert.ok(review.includes("D、E到达"));
  assert.ok(review.includes("未输出首Token"));
  const changed=G.clone(s); for(const r of changed.requests) r.goal+=100;
  assert.deepEqual(C.review(changed,G),C.review(s,G));
  s=G.reclaim(G.create("challenge5"),"B","recompute").state;
  s=G.execute(s,"prefill",[{id:"B",tokens:4}]).state;
  s=G.reclaim(s,"B","recompute").state;
  assert.ok(C.review(s,G).some(t=>t.includes("多次抢占B")));
});
test("operation feedback uses observed state and decisions, not unknown output goals",()=>{
  const s=G.create("challenge3");
  const t=G.execute(s,"decode",[{id:"A",tokens:1},{id:"B",tokens:1}]).state;
  const before=C.review(t,G);
  for(const r of t.requests) r.goal+=100;
  assert.deepEqual(C.review(t,G),before);
  assert.ok(before.some(t=>t.includes("首Token")));
  assert.ok(C.review(G.create("challenge2"),G)[0].includes("还没操作"));
});
