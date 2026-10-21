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
  for (const id of Object.keys(G.LEVELS)) {
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
