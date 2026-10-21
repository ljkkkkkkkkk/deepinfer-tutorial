const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../game-engine.js");

function run(state, phase, entries) {
  const result = G.execute(state,phase,Object.entries(entries).map(([id,tokens])=>({id,tokens})));
  assert.equal(result.ok,true,result.errors?.join(" "));
  invariant(result.state);
  return result.state;
}
function invariant(s) {
  for (const [tier,capacity] of [["gpu",s.config.blocks],["cpu",s.config.cpu],["ssd",s.config.ssd]]) {
    assert.ok(G.usage(s,tier)>=0 && G.usage(s,tier)<=capacity,`${tier} capacity`);
  }
  for (const r of s.requests) {
    assert.ok(r.cached>=0 && r.cached<=r.prompt+r.generated);
    assert.ok(r.generated>=0 && r.generated<=r.goal);
    if (r.done) assert.equal(r.cached,0);
  }
  assert.ok(s.work<=s.capacity);
}

test("initial stages, visible arrivals, and per-tier capacity",()=>{
  const s=G.create("pressure");
  assert.equal(G.usage(s),5);
  assert.deepEqual(G.visible(G.create()).map(r=>r.id),["A","B"]);
  assert.deepEqual(s.requests.map(G.status),["decode","decode","prefill"]);
  assert.throws(()=>G.create("pressure",{blocks:4}));
  invariant(s);
});
test("partial prefill persists across rounds; idle resets no cache",()=>{
  let s=run(G.create(),"prefill",{A:4});
  assert.equal(s.requests[0].cached,4);
  assert.equal(G.status(s.requests[0]),"prefill");
  s=G.idle(s).state;
  assert.equal(G.usage(s),1);
  s=run(s,"prefill",{A:4});
  assert.equal(G.status(s.requests[0]),"decode");
  assert.equal(s.requests[0].generated,0);
});
test("decode reuses a partially filled block but checks its boundary",()=>{
  let s=run(G.create(),"prefill",{A:8});
  assert.equal(G.plan(s,"decode",[{id:"A",tokens:1}]).extraBlocks,1);
  s=run(s,"decode",{A:1});
  assert.equal(G.plan(s,"decode",[{id:"A",tokens:1}]).extraBlocks,0);
});
test("reject token overflow, wrong phase, future requests, duplicate requests atomically",()=>{
  const s=G.create(); const snapshot=G.clone(s);
  for (const [phase,list] of [["prefill",[{id:"A",tokens:8},{id:"B",tokens:4}]],["decode",[{id:"A",tokens:1}]],["prefill",[{id:"C",tokens:1}]],["prefill",[{id:"A",tokens:1},{id:"A",tokens:1}]]]) {
    assert.equal(G.execute(s,phase,list).ok,false);
    assert.deepEqual(s,snapshot);
  }
});
test("new blocks are aggregated across the batch before completion frees memory",()=>{
  let s=run(G.create("start",{blocks:4,tokens:12}),"prefill",{A:8,B:4});
  assert.equal(G.usage(s),3);
  const check=G.plan(s,"decode",[{id:"A",tokens:1},{id:"B",tokens:1}]);
  assert.equal(check.extraBlocks,2);
  assert.equal(check.ok,false);
});
test("decode completion frees all blocks only after output has a slot",()=>{
  let s=run(G.create(),"prefill",{B:4});
  s=run(s,"decode",{B:1});
  assert.equal(G.usage(s),2);
  s=run(s,"decode",{B:1});
  assert.equal(s.requests[1].done,true);
  assert.equal(G.usage(s),0);
});
test("preemption preserves known output and accounts repeated prefill",()=>{
  let s=run(G.create(),"prefill",{A:8});
  s=run(s,"decode",{A:1});
  s=G.reclaim(s,"A","recompute").state;
  assert.equal(s.requests[0].generated,1);
  assert.equal(s.requests[0].cached,0);
  assert.equal(s.requests[0].prompt+s.requests[0].generated,9);
  s=run(s,"prefill",{A:8}); s=run(s,"prefill",{A:1});
  assert.equal(s.recomputed,9);
  assert.equal(s.requests[0].generated,1);
  assert.equal(G.status(s.requests[0]),"decode");
});
test("CPU offload and restore preserve cache and charge round-trip transfers",()=>{
  let s=run(G.create(),"prefill",{A:8});
  s=run(s,"decode",{A:1});
  const lastService=s.requests[0].lastService;
  s=G.reclaim(s,"A","cpu").state;
  assert.equal(G.usage(s),0); assert.equal(G.usage(s,"cpu"),3);
  assert.equal(s.requests[0].cached,9);
  assert.equal(G.plan(s,"decode",[{id:"A",tokens:1}]).ok,false);
  s=G.reclaim(s,"A","restore").state;
  assert.equal(G.usage(s),3); assert.equal(G.usage(s,"cpu"),0);
  assert.equal(s.transferred,6); assert.equal(s.transferTime,2);
  assert.equal(s.recomputed,0); assert.equal(s.requests[0].lastService,lastService);
  invariant(s);
});
test("offload/restore validate both source and destination capacities",()=>{
  let s=G.create("pressure");
  assert.equal(G.reclaim(s,"A","cpu").ok,true);
  s=G.reclaim(s,"A","cpu").state;
  s=run(s,"prefill",{C:8});
  const snapshot=G.clone(s);
  assert.equal(G.reclaim(s,"A","restore").ok,false);
  assert.deepEqual(s,snapshot);
  let zero=run(G.create("start",{cpu:0}),"prefill",{A:8});
  assert.equal(G.reclaim(zero,"A","cpu").ok,false);
});
test("SSD latency advances arrivals without computing unseen requests",()=>{
  let s=run(G.create(),"prefill",{A:8});
  s=G.reclaim(s,"A","ssd").state;
  assert.equal(s.time,3); assert.equal(s.transferTime,2);
  assert.equal(G.visible(s).length,3);
  assert.equal(s.requests[2].cached,0);
  assert.ok(s.log.some(item=>item.message.startsWith("新请求C")));
});
test("all three levels can finish without hidden-length knowledge or preemption",()=>{
  for (const id of Object.keys(G.LEVELS).filter(id=>!G.LEVELS[id].challenge)) {
    let s=G.create(id);
    for (let attempt=0;attempt<150 && !G.finished(s);attempt++) {
      const ready=G.visible(s).filter(r=>!r.done && G.status(r)==="decode");
      const candidate=ready.find(r=>G.plan(s,"decode",[{id:r.id,tokens:1}]).ok);
      if (candidate) { s=run(s,"decode",{[candidate.id]:1}); continue; }
      const pending=G.visible(s).find(r=>!r.done && G.status(r)==="prefill");
      if (pending) {
        const n=Math.min(s.config.tokens,pending.prompt+pending.generated-pending.cached);
        if (G.plan(s,"prefill",[{id:pending.id,tokens:n}]).ok) { s=run(s,"prefill",{[pending.id]:n}); continue; }
      }
      s=G.idle(s).state;
    }
    assert.equal(G.finished(s),true,`${id} solvable`);
    assert.equal(G.usage(s),0);
    assert.equal(G.execute(s,"decode",[{id:"A",tokens:1}]).ok,false);
    assert.equal(G.idle(s).ok,false);
    invariant(s);
  }
});

test("four challenges match the published initial budgets and states",()=>{
  const expected={challenge1:{gpu:6,cpu:0,blocks:8,cached:[12,7,4,0]},challenge2:{gpu:6,cpu:1,blocks:6,cached:[12,8,4]},challenge3:{gpu:6,cpu:0,blocks:10,cached:[13,4,4]},challenge4:{gpu:6,cpu:0,blocks:6,cached:[8,8,5]}};
  for (const [id,e] of Object.entries(expected)) {
    const s=G.create(id);
    assert.equal(s.config.tokens,6); assert.equal(s.config.blocks,e.blocks);
    assert.equal(G.usage(s),e.gpu); assert.equal(G.usage(s,"cpu"),e.cpu);
    assert.deepEqual(s.requests.map(r=>r.cached),e.cached);
    assert.throws(()=>G.create(id,{tokens:8}),/固定/);
    invariant(s);
  }
});
test("challenge 1 compares legal plans and exposes the conditional block-boundary trap",()=>{
  const initial=G.create("challenge1");
  const a=G.plan(initial,"decode",[{id:"A",tokens:1},{id:"B",tokens:1},{id:"C",tokens:1}]);
  const b=G.plan(initial,"prefill",[{id:"D",tokens:6}]);
  assert.equal(a.ok,true); assert.equal(a.tokens,3); assert.equal(a.extraBlocks,2);
  assert.equal(b.ok,true); assert.equal(b.tokens,6); assert.equal(b.extraBlocks,2);
  let s=run(initial,"prefill",{D:6});
  s=run(s,"decode",{B:1}); s=run(s,"prefill",{D:2});
  assert.equal(G.usage(s),8); assert.equal(s.requests.some(r=>r.done),false);
  for(const r of s.requests) assert.equal(G.plan(s,G.status(r),[{id:r.id,tokens:1}]).ok,false);
  assert.equal(G.reclaim(s,"A","cpu").ok,false);
  assert.equal(G.reclaim(s,"A","ssd").ok,false);
});
test("challenge 2 accounts for another task's reserved CPU block",()=>{
  const s=G.create("challenge2"), snapshot=G.clone(s);
  for (const r of s.requests) assert.equal(G.plan(s,G.status(r),[{id:r.id,tokens:1}]).ok,false);
  assert.equal(G.reclaim(s,"A","cpu").ok,false);
  assert.equal(G.reclaim(s,"B","cpu").ok,false);
  const offloaded=G.reclaim(s,"C","cpu"); assert.equal(offloaded.ok,true);
  assert.equal(G.usage(offloaded.state,"cpu"),2); assert.equal(offloaded.state.time,1);
  const restored=G.reclaim(offloaded.state,"C","restore"); assert.equal(restored.ok,true);
  assert.equal(G.usage(restored.state,"cpu"),1); assert.equal(restored.state.time,2);
  assert.equal(G.reclaim(s,"B","ssd").state.time,2);
  assert.deepEqual(s,snapshot);
});
test("challenge 3 preserves inherited wait times and supports both legitimate two-round routes",()=>{
  const s=G.create("challenge3");
  assert.deepEqual(s.requests.map(r=>s.time-Math.max(r.arrival,r.lastService)),[0,2,7]);
  const d=G.plan(s,"decode",[{id:"A",tokens:1},{id:"B",tokens:1}]);
  const p=G.plan(s,"prefill",[{id:"C",tokens:6}]);
  assert.equal(d.tokens,2); assert.equal(d.extraBlocks,1); assert.equal(d.ok,true);
  assert.equal(p.tokens,6); assert.equal(p.extraBlocks,2); assert.equal(p.ok,true);
  const route1=run(run(s,"decode",{A:1,B:1}),"prefill",{C:6});
  const route2=run(run(s,"prefill",{C:6}),"decode",{A:1,B:1,C:1});
  assert.equal(route1.decisions[0].phase,"decode"); assert.equal(route2.decisions[0].phase,"prefill");
  assert.equal(route1.requests[2].generated,0); assert.equal(route2.requests[2].generated,1);
});
test("challenge 4 rejects borrowing an inevitable completion's future release",()=>{
  const s=G.create("challenge4"), snapshot=G.clone(s);
  assert.equal(s.requests[0].knownLimit,4);
  const check=G.plan(s,"decode",[{id:"A",tokens:1}]);
  assert.equal(check.extraBlocks,1); assert.equal(check.ok,false);
  assert.equal(G.execute(s,"decode",[{id:"A",tokens:1}]).ok,false); assert.deepEqual(s,snapshot);
  assert.equal(G.plan(s,"decode",[{id:"C",tokens:1}]).ok,true);
  for(const [id,n,rounds] of [["B",8,2],["C",5,1]]) {
    let t=G.reclaim(s,id,"recompute").state;
    t=run(t,"decode",{A:1}); assert.equal(t.requests[0].done,true); assert.equal(G.usage(t),2);
    for(let left=n;left>0;left-=6) t=run(t,"prefill",{[id]:Math.min(6,left)});
    assert.equal(t.recomputed,n);
    assert.equal(t.decisions.filter(d=>d.type==="compute" && d.phase==="prefill").length,rounds);
  }
});
test("decision history is atomic and old saves without it still run",()=>{
  const s=G.create("challenge4"); delete s.decisions;
  assert.equal(G.execute(s,"decode",[{id:"A",tokens:1}]).ok,false);
  assert.equal(s.decisions,undefined);
  let t=G.reclaim(s,"C","recompute").state;
  t=run(t,"decode",{A:1}); t=G.idle(t).state;
  assert.deepEqual(t.decisions.map(d=>d.type),["memory","compute","idle"]);
  assert.equal(t.decisions[0].cached,5); assert.equal(t.decisions[1].extraBlocks,1);
});
test("every challenge has a complete feasible continuation",()=>{
  function swap(s,id,destination) { const r=G.reclaim(s,id,destination); assert.equal(r.ok,true,r.errors?.join(" ")); invariant(r.state); return r.state; }
  function finish(s) {
    for(let attempt=0;attempt<250 && !G.finished(s);attempt++) {
      let moved=false;
      for(const phase of ["decode","prefill"]) {
        const r=G.visible(s).find(r=>G.status(r)===phase && !r.done && G.plan(s,phase,[{id:r.id,tokens:1}]).ok);
        if(r) { s=run(s,phase,{[r.id]:1}); moved=true; break; }
      }
      if(!moved) {
        const stored=s.requests.find(r=>!r.done && r.location!=="gpu" && G.reclaim(s,r.id,"restore").ok);
        if(stored) { s=swap(s,stored.id,"restore"); continue; }
        const victim=s.requests.find(r=>!r.done && r.location==="gpu" && r.cached>0);
        assert.ok(victim,"a cache can be reclaimed"); s=swap(s,victim.id,"recompute");
      }
    }
    assert.equal(G.finished(s),true,`${s.levelId} solvable`); assert.equal(G.usage(s),0); invariant(s);
  }
  finish(G.create("challenge1"));
  let s=swap(G.create("challenge2"),"C","cpu");
  s=run(s,"decode",{A:1}); s=run(s,"decode",{A:1}); s=run(s,"decode",{A:1});
  s=swap(s,"C","restore"); finish(s);
  finish(run(run(G.create("challenge3"),"decode",{A:1,B:1}),"prefill",{C:6}));
  finish(run(swap(G.create("challenge4"),"C","recompute"),"decode",{A:1}));
});
