// A single-round teaching model: FIFO prefill, sufficient KV capacity,
// no CP alignment, lookahead, multimodal constraints, or decode scheduling.
(function (root) {
  function calculatePrefillDemo(budget, chunked, run = true) {
    const requests = [{ id: "A", total: 780 }, { id: "B", total: 24 }, { id: "C", total: 210 }]
      .map(request => ({ ...request, assigned: 0, status: "等待安排" }));
    const invalid = run && !chunked && requests.some(request => request.total > budget);
    let remaining = budget;
    if (run && !invalid) {
      for (const request of requests) {
        request.assigned = Math.min(request.total, remaining);
        remaining -= request.assigned;
        request.status = request.assigned === 0 ? "本轮等待" : request.assigned < request.total ? "部分读入，未完成Prefill" : "输入读完，待Decode";
      }
    }
    if (invalid) requests.forEach(request => { request.status = "配置需调整，未运行"; });
    return { requests, remaining, used: budget - remaining, invalid };
  }
  if (typeof module === "object" && module.exports) module.exports = { calculatePrefillDemo };
  else root.calculatePrefillDemo = calculatePrefillDemo;
})(typeof globalThis === "object" ? globalThis : this);
