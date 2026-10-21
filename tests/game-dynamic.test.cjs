const test=require("node:test");
const assert=require("node:assert/strict");
const G=require("../game-engine.js");
const ids=["challenge5","challenge6","challenge7","challenge8"];
function invariant(s) {
  for(const [tier,cap] of [["gpu",s.config.blocks],["cpu",s.config.cpu],["ssd",s.config.ssd]]) assert.ok(G.usage(s,tier)<=cap,`${s.levelId} ${tier} capacity`);
  for(const r of s.requests) {
    assert.ok(r.cached>=0 && r.cached<=r.prompt+r.generated);
    if(r.arrival>s.time) { assert.equal(r.cached,0); assert.equal(r.generated,0); assert.equal(r.done,false); }
  }
}
function compute(s,phase,a) {
  const r=G.execute(s,phase,Object.entries(a).map(([id,tokens])=>({id,tokens})));
  assert.equal(r.ok,true,r.errors?.join(" ")); invariant(r.state); return r.state;
}
function memory(s,id,destination) {
  const r=G.reclaim(s,id,destination); assert.equal(r.ok,true,r.errors?.join(" ")); invariant(r.state); return r.state;
}
test("four new levels have tighter budgets, fixed resources and multiple future arrivals",()=>{
  const expected={challenge5:{gpu:4,blocks:5,tokens:4,waves:[2,5]},challenge6:{gpu:5,blocks:5,tokens:4,waves:[1,2]},challenge7:{gpu:5,blocks:6,tokens:6,waves:[1,2,4]},challenge8:{gpu:3,blocks:5,tokens:4,waves:[1,3,5]}};
  for(const id of ids) {
    const s=G.create(id),e=expected[id];
    assert.equal(G.LEVELS[id].dynamic,true); assert.equal(G.usage(s),e.gpu);
    assert.equal(s.config.blocks,e.blocks); assert.equal(s.config.tokens,e.tokens);
    assert.deepEqual(G.forecast(s).map(r=>r.arrival),e.waves);
    assert.throws(()=>G.create(id,{blocks:10}),/固定/); invariant(s);
  }
});
test("forecast discloses known arrivals but never hidden output length",()=>{
  const s=G.create("challenge6");
  const forecast=G.forecast(s);
  assert.deepEqual(forecast.map(r=>r.status),["future","future"]);
  assert.deepEqual(Object.keys(forecast[0]).sort(),["id","title","arrival","prompt","priority","status"].sort());
  for(const r of s.requests) r.goal+=100;
  assert.deepEqual(G.forecast(s),forecast);
});
test("challenge 5 arrival happens after the round, not inside its compute batch",()=>{
  const initial=G.create("challenge5"), snapshot=G.clone(initial);
  assert.equal(G.execute(initial,"prefill",[{id:"C",tokens:4}]).ok,false);
  assert.deepEqual(initial,snapshot);
  let s=compute(initial,"prefill",{B:4}); assert.equal(s.time,1);
  assert.deepEqual(G.visible(s).map(r=>r.id),["A","B"]);
  assert.equal(G.execute(s,"prefill",[{id:"C",tokens:4}]).ok,false);
  s=compute(s,"decode",{A:1}); assert.equal(s.time,2);
  assert.deepEqual(G.visible(s).map(r=>r.id),["A","B","C"]);
  assert.equal(G.forecast(s)[0].status,"prefill");
  assert.equal(G.plan(s,"prefill",[{id:"C",tokens:4}]).ok,false);
  assert.equal(s.requests[2].cached,0);
});
test("challenge 6 serial SSD transfer advances through both arrival events exactly once",()=>{
  const s=memory(G.create("challenge6"),"B","ssd");
  assert.equal(s.time,2); assert.equal(s.transferTime,2); assert.equal(s.work,0);
  assert.deepEqual(G.visible(s).map(r=>r.id),["A","B","C","D","E"]);
  const arrivalLogs=s.log.filter(r=>r.message.startsWith("新请求"));
  assert.deepEqual(arrivalLogs.map(r=>r.time),[1,2]);
  assert.equal(s.requests[3].cached,0); assert.equal(s.requests[4].cached,0);
  assert.equal(G.usage(s),3); assert.equal(G.usage(s,"cpu"),1);
  assert.equal(G.reclaim(G.create("challenge6"),"B","cpu").ok,false);
});
test("challenge 6 fast release can admit an urgent prompt but not its first decode",()=>{
  let s=memory(G.create("challenge6"),"C","cpu");
  assert.equal(s.time,1); assert.equal(G.visible(s).some(r=>r.id==="E"),false);
  s=compute(s,"prefill",{D:4}); assert.equal(s.time,2); assert.equal(G.usage(s),5);
  const p=G.plan(s,"decode",[{id:"D",tokens:1}]); assert.equal(p.extraBlocks,1); assert.equal(p.ok,false);
  assert.equal(G.visible(s).some(r=>r.id==="E"),true);
});
test("challenge 7 new arrivals do not evict existing cache automatically",()=>{
  let s=compute(G.create("challenge7"),"decode",{A:1,B:1});
  assert.equal(s.time,1); assert.equal(G.usage(s),6);
  assert.equal(s.requests[0].cached,13); assert.equal(s.requests[1].cached,6);
  assert.equal(s.preemptions,0); assert.equal(G.plan(s,"prefill",[{id:"C",tokens:1}]).ok,false);
  assert.equal(G.reclaim(s,"A","cpu").ok,false); assert.equal(G.reclaim(s,"B","ssd").ok,false);
  assert.equal(G.plan(s,"decode",[{id:"A",tokens:1},{id:"B",tokens:1}]).ok,true);
});
test("challenge 8 completing long prefill can block first output and remove CPU eligibility",()=>{
  const initial=G.create("challenge8");
  let s=compute(initial,"prefill",{B:4});
  assert.equal(G.reclaim(s,"B","cpu").ok,true);
  const offloaded=memory(s,"B","cpu"); assert.equal(offloaded.time,3);
  assert.equal(G.visible(offloaded).some(r=>r.id==="D"),true);
  s=compute(s,"prefill",{B:4});
  assert.equal(s.time,2); assert.equal(G.usage(s),5); assert.equal(s.requests[1].cached,12);
  assert.equal(G.reclaim(s,"B","cpu").ok,false);
  assert.equal(G.plan(s,"decode",[{id:"A",tokens:1}]).ok,true);
  assert.equal(G.plan(s,"decode",[{id:"B",tokens:1}]).ok,false);
  assert.equal(G.plan(s,"prefill",[{id:"C",tokens:4}]).ok,false);
  s=compute(s,"decode",{A:1}); assert.equal(G.visible(s).some(r=>r.id==="D"),true);
  assert.equal(s.requests[0].done,false); assert.equal(G.plan(s,"decode",[{id:"A",tokens:1}]).ok,false);
});
test("undo-shaped snapshots and reload-shaped JSON retain dynamic arrival progress",()=>{
  const before=G.create("challenge6"), snapshot=G.clone(before);
  const after=memory(before,"B","ssd");
  assert.deepEqual(before,snapshot); assert.equal(G.visible(before).length,3);
  const restored=JSON.parse(JSON.stringify(after));
  assert.deepEqual(G.forecast(restored),G.forecast(after)); assert.equal(G.visible(restored).length,5);
  assert.equal(G.visible(snapshot).length,3);
});
test("each new dynamic scenario has a complete continuation without guessing output lengths",()=>{
  for(const id of ids) {
    let s=G.create(id);
    // Feasibility witness only, not a recommended strategy: clear all initial caches,
    // then finish one observed request at a time. Never inspect hidden `goal` to choose.
    for(const r of G.visible(s).filter(r=>r.cached>0)) s=memory(s,r.id,"recompute");
    let current=null;
    for(let turn=0;turn<250 && !G.finished(s);turn++) {
      let r=current && s.requests.find(r=>r.id===current && !r.done);
      if(!r) r=G.visible(s).find(r=>!r.done);
      if(!r) {s=G.idle(s).state;continue;}
      current=r.id;
      const phase=G.status(r), n=phase==="decode" ? 1 : Math.min(s.config.tokens,r.prompt+r.generated-r.cached);
      s=compute(s,phase,{[r.id]:n});
    }
    assert.equal(G.finished(s),true,id); assert.equal(G.usage(s),0); invariant(s);
    assert.equal(s.log.filter(r=>r.message.startsWith("新请求")).length,G.forecast(s).length);
  }
});
