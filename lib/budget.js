// One global sliding-window budget + serial queue for every Neuronpedia steer call.
// Priority: x (account posts) > lab (holder steers) > warm (cache fill).
function createBudget(perHour) {
  const stamps = []; const q = []; let busy = false;
  const used = () => { const cut = Date.now() - 3600e3; while (stamps.length && stamps[0] < cut) stamps.shift(); return stamps.length; };
  const PRI = { x: 0, lab: 1, warm: 2 };
  async function pump() {
    if (busy) return; busy = true;
    while (q.length) {
      if (used() >= perHour) { const j = q.shift(); j.reject(Object.assign(new Error('steer budget used up for this hour'), { status: 429 })); continue; }
      q.sort((a, b) => PRI[a.kind] - PRI[b.kind] || a.t - b.t);
      const j = q.shift(); stamps.push(Date.now());
      try { j.resolve(await j.fn()); } catch (e) { j.reject(e); }
    }
    busy = false;
  }
  return {
    run(kind, fn) { return new Promise((resolve, reject) => { if (q.length > 40) return reject(Object.assign(new Error('queue full, try again soon'), { status: 503 })); q.push({ kind, fn, resolve, reject, t: Date.now() }); pump(); }); },
    status: () => ({ usedLastHour: used(), perHour, queued: q.length }),
    left: () => perHour - used(),
  };
}
module.exports = { createBudget };
