/**
 * The live operations dashboard served by the master at /metrics
 * (FightWars, Section 8: tick time, player count, bandwidth, desyncs).
 *
 * Deliberately dependency-free inline HTML: it is an operator page, not
 * product UI, and it must work on a bare master with no CDN or bundle.
 * It polls /metrics/worker/<i> for every worker every two seconds.
 */
export function metricsDashboardHtml(numWorkers: number): string {
  const budgetMs = 8;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FightWars metrics</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; background: #0a1628; color: #e5eaf0; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  table { border-collapse: collapse; margin-bottom: 20px; }
  th, td { padding: 4px 10px; text-align: right; border-bottom: 1px solid #22304a; }
  th { color: #9fb0c8; font-weight: 600; }
  td:first-child, th:first-child { text-align: left; }
  .bad { color: #f97316; font-weight: 700; }
  small { color: #9fb0c8; }
</style>
</head>
<body>
<h1>FightWars — live metrics <small id="at"></small></h1>
<table id="workers">
  <thead><tr>
    <th>worker</th><th>games</th><th>clients</th><th>turn mean ms</th><th>turn p99 ms</th>
    <th>turn max ms</th><th>over budget</th><th>KB/s out</th><th>desynced clients</th>
    <th>desync events</th><th>refused</th><th>RSS MB</th>
  </tr></thead>
  <tbody></tbody>
</table>
<table id="games">
  <thead><tr>
    <th>game</th><th>worker</th><th>phase</th><th>clients</th><th>turns</th><th>mean ms</th>
    <th>p50 ms</th><th>p99 ms</th><th>max ms</th><th>over</th><th>KB/s</th><th>desynced</th><th>refused</th>
  </tr></thead>
  <tbody></tbody>
</table>
<script>
  const N = ${numWorkers};
  const BUDGET = ${budgetMs};
  const f = (x, d = 1) => Number(x).toFixed(d);
  const td = (v, bad = false) => "<td" + (bad ? " class=\\"bad\\"" : "") + ">" + v + "</td>";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  async function tick() {
    const rows = [];
    const games = [];
    for (let i = 0; i < N; i++) {
      try {
        const r = await fetch("/metrics/worker/" + i, { cache: "no-store" });
        const m = await r.json();
        if (m.error) throw new Error(m.error);
        rows.push(m);
        for (const g of m.games) games.push({ ...g, worker: i });
      } catch (e) {
        rows.push({ workerId: i, error: String(e) });
      }
    }
    document.getElementById("at").textContent = new Date().toLocaleTimeString();
    document.querySelector("#workers tbody").innerHTML = rows.map((m) => m.error
      ? "<tr>" + td("w" + m.workerId) + "<td colspan=\\"10\\" class=\\"bad\\">" + esc(m.error) + "</td></tr>"
      : "<tr>" + td("w" + m.workerId) + td(m.activeGames) + td(m.activeClients)
        + td(f(m.turnMs.mean, 2), m.turnMs.mean > BUDGET) + td(f(m.turnMs.p99, 2)) + td(f(m.turnMs.max, 1))
        + td(m.turnMs.overBudget, m.turnMs.overBudget > 0) + td(f(m.bytesOutPerSec / 1024))
        + td(m.desyncedClients, m.desyncedClients > 0) + td(m.desyncEvents, m.desyncEvents > 0)
        + td(m.shadowRefusals, m.shadowRefusals > 0)
        + td(f(m.memoryRssBytes / 1048576, 0)) + "</tr>").join("");
    document.querySelector("#games tbody").innerHTML = games.map((g) =>
      "<tr>" + td(esc(g.gameID)) + td("w" + g.worker) + td(esc(g.phase)) + td(g.clients) + td(g.turns)
        + td(f(g.meanMs, 2), g.meanMs > BUDGET) + td(f(g.p50Ms, 2)) + td(f(g.p99Ms, 2)) + td(f(g.maxMs, 1))
        + td(g.overBudget, g.overBudget > 0) + td(f(g.bytesOutPerSec / 1024)) + td(g.desyncedClients, g.desyncedClients > 0)
        + td(g.shadowRefusals, g.shadowRefusals > 0)
        + "</tr>").join("");
  }
  tick();
  setInterval(tick, 2000);
</script>
</body>
</html>
`;
}
