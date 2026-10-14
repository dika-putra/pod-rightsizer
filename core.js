// Pure calculations without DOM, used by index.html and test.js. Errors are codes translated by the UI.
(function (root) {
  const NUM = /^\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([A-Za-z%]*)\s*$/i;
  const MEMU = { b: 1 / 1048576, kb: 1 / 1024, kib: 1 / 1024, mb: 1, mib: 1, gb: 1024, gib: 1024 };
  const CPUU = { m: 1, mc: 1, mcore: 1, milicore: 1, millicore: 1, core: 1000, cores: 1000 };

  function parseCSV(t) {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r[0] !== undefined && r[0] !== ''));
  }

  // Grafana mengisi sel kosong dengan teks "undefined" saat Formatted data dimatikan.
  function readCell(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (s === '' || /^(undefined|null|nan)$/i.test(s)) return null;
    const m = NUM.exec(s);
    return m ? { v: parseFloat(m[1]), u: m[2].toLowerCase() } : null;
  }

  // Persentil linear, sama dengan PERCENTILE di Excel dan Sheets.
  function pct(a, p) {
    if (!a.length) return NaN;
    const k = (a.length - 1) * p, f = Math.floor(k), c = Math.min(f + 1, a.length - 1);
    return a[f] + (a[c] - a[f]) * (k - f);
  }
  const asc = a => a.slice().sort((x, y) => x - y);

  function parseTime(s) {
    s = String(s).trim();
    if (/^\d+$/.test(s)) { const n = Number(s); return n > 1e11 ? n : n * 1000; }
    const d = Date.parse(s.replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }

  // Nama pod: <deployment>-<hash revisi>-<id>. Dipakai untuk menyaring per revisi.
  function revOf(name) {
    const m = /^(.*)-([a-z0-9]{6,10})-([a-z0-9]{5})$/.exec(name);
    return m ? m[2] : 'lainnya';
  }

  // Nama service dari header kolom pod (<service>-<hash>-<id>), yang paling banyak muncul. Kosong kalau tidak dikenali.
  function serviceName(rows) {
    if (!rows || !rows.length) return '';
    const counts = new Map();
    for (const raw of rows[0]) {
      const name = String(raw).trim();
      if (/^(time|requests?|limits?)$/i.test(name)) continue;
      const m = /^(.*)-([a-z0-9]{6,10})-([a-z0-9]{5})$/.exec(name);
      if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
    let best = '', n = 0;
    for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    return best;
  }

  // Biaya per bulan: pod x jam x request x harga. CPU per core-jam (m / 1000), memory per GiB-jam (MiB / 1024).
  function costFor(kind, req, pods, hours, priceCore, priceGiB) {
    return pods * hours * (kind === 'cpu' ? req / 1000 * priceCore : req / 1024 * priceGiB);
  }

  function detectKind(rows, podIdx, filename, forced) {
    if (forced && forced !== 'auto') return forced;
    let mem = 0, cpu = 0;
    const raw = [];
    for (let r = 1; r < rows.length && raw.length < 4000; r++) {
      for (const j of podIdx) {
        const c = readCell(rows[r][j]);
        if (!c) continue;
        if (c.u in MEMU) mem++; else if (c.u in CPUU) cpu++; else raw.push(c.v);
      }
    }
    if (mem > cpu) return 'memory';
    if (cpu > mem) return 'cpu';
    const fn = (filename || '').toLowerCase();
    if (fn.includes('memory')) return 'memory';
    if (fn.includes('cpu')) return 'cpu';
    return (raw.length ? pct(asc(raw), .5) : 0) > 1e5 ? 'memory' : 'cpu';
  }

  function convert(c, kind, bytesMode) {
    if (!c) return null;
    if (kind === 'memory') return c.u in MEMU ? c.v * MEMU[c.u] : (bytesMode ? c.v / 1048576 : c.v);
    return c.u in CPUU ? c.v * CPUU[c.u] : c.v;
  }

  // Satu CSV berisi satu resource (CPU atau Memory), satu kolom per pod.
  function analyze(rows, opt) {
    opt = opt || {};
    if (!rows || rows.length < 2) return { error: 'err_empty' };
    const h = rows[0].map(x => String(x).trim());
    let ti = h.findIndex(x => /^time$/i.test(x));
    if (ti < 0) ti = 0;
    const ri = h.findIndex(x => /^requests?$/i.test(x)), li = h.findIndex(x => /^limits?$/i.test(x));
    const podIdx = [];
    for (let j = 0; j < h.length; j++) if (j !== ti && j !== ri && j !== li) podIdx.push(j);
    const kind = detectKind(rows, podIdx, opt.filename, opt.kind);

    // Memory tanpa satuan: angka besar berarti bytes, angka kecil berarti sudah MiB.
    let bytesMode = false;
    if (kind === 'memory') {
      const raw = [];
      for (let r = 1; r < rows.length && raw.length < 2000; r++)
        for (const j of podIdx) { const c = readCell(rows[r][j]); if (c && !(c.u in MEMU)) raw.push(c.v); }
      bytesMode = raw.length > 0 && pct(asc(raw), .5) > 1e5;
    }

    const cols = [];
    for (const j of podIdx) {
      const vals = new Array(rows.length - 1);
      let n = 0;
      for (let r = 1; r < rows.length; r++) {
        const v = convert(readCell(rows[r][j]), kind, bytesMode);
        vals[r - 1] = v;
        if (v != null) n++;
      }
      if (n > 0) cols.push({ name: h[j], rev: revOf(h[j]), vals, n });
    }
    if (!cols.length) return { error: 'err_nopods' };

    const times = [];
    for (let r = 1; r < rows.length; r++) times.push(parseTime(rows[r][ti]));
    const revMap = new Map();
    for (const c of cols) {
      if (!revMap.has(c.rev)) revMap.set(c.rev, { rev: c.rev, pods: 0, first: Infinity });
      const e = revMap.get(c.rev);
      e.pods++;
      for (let r = 0; r < c.vals.length; r++)
        if (c.vals[r] != null) { if (times[r] != null && times[r] < e.first) e.first = times[r]; break; }
    }
    const revs = [...revMap.values()].sort((a, b) => a.first - b.first);

    const ex = opt.excluded || new Set();
    const use = cols.filter(c => !ex.has(c.rev));
    const series = [], pooled = [];
    for (let r = 0; r < rows.length - 1; r++) {
      let s = 0, mx = -Infinity, n = 0;
      for (const c of use) {
        const v = c.vals[r];
        if (v != null) { s += v; n++; if (v > mx) mx = v; pooled.push(v); }
      }
      if (n > 0) series.push({ t: times[r], avg: s / n, max: mx, n });
    }
    const refMed = idx => {
      if (idx < 0) return null;
      const a = [];
      for (let r = 1; r < rows.length; r++) { const v = convert(readCell(rows[r][idx]), kind, bytesMode); if (v != null && v > 0) a.push(v); }
      return a.length ? pct(asc(a), .5) : null;
    };
    return {
      kind, unit: kind === 'memory' ? 'MiB' : 'm',
      request: refMed(ri), limit: refMed(li),
      revs, podsTotal: cols.length, podsUsed: use.length, series, pooled
    };
  }

  // Rata-rata antar pod di tiap waktu (cara HPA) dan statistik pod tunggal.
  function summarize(res, o) {
    const avg = asc(res.series.map(x => x.avg)), pooled = asc(res.pooled), npods = asc(res.series.map(x => x.n));
    const r = {
      avg: { p50: pct(avg, .5), p95: pct(avg, .95), p99: pct(avg, .99), max: avg[avg.length - 1] },
      pooled: { p50: pct(pooled, .5), p90: pct(pooled, .9), p95: pct(pooled, .95), p99: pct(pooled, .99), p999: pct(pooled, .999), max: pooled[pooled.length - 1] },
      pods: { median: pct(npods, .5), max: npods[npods.length - 1], mean: res.series.reduce((s, x) => s + x.n, 0) / res.series.length },
      maxPod: pooled[pooled.length - 1], points: res.series.length
    };
    if (o.req > 0) {
      const u = res.series.map(x => x.avg / o.req * 100);
      r.util = { p50: pct(asc(u), .5), p95: pct(asc(u), .95), max: Math.max(...u) };
      r.over = u.filter(v => v > o.target).length;
      r.overPct = r.over / u.length * 100;
      r.status = r.util.max <= o.target - o.margin ? 'ok' : r.util.max <= o.target ? 'warn' : 'bad';
    }
    if (o.lim > 0) r.limPct = r.maxPod / o.lim * 100;
    return r;
  }

  // Utilisasi HPA kalau request diganti ke tiap kandidat.
  function simulate(res, target, margin, cands) {
    const s = res.series.map(x => x.avg);
    return cands.map(c => {
      const u = s.map(v => v / c * 100), mx = Math.max(...u), over = u.filter(v => v > target).length;
      return { req: c, p50: pct(asc(u), .5), p95: pct(asc(u), .95), max: mx, overPct: over / u.length * 100, st: mx <= target - margin ? 'ok' : mx <= target ? 'warn' : 'bad' };
    });
  }

  // Ambang alert per pod sebagai persen dari request, plus perkiraan seberapa sering data
  // yang ada akan melewatinya (per sampel pod, dan per titik waktu kalau ada pod yang melewati).
  function alertPlan(res, req, warnPct, critPct) {
    const warn = req * warnPct / 100, crit = req * critPct / 100;
    const n = res.pooled.length, m = res.series.length;
    const above = t => res.pooled.filter(v => v > t).length / n * 100;
    const times = t => res.series.filter(x => x.max > t).length / m * 100;
    return { warn, crit, warnPct, critPct, warnSamples: above(warn), critSamples: above(crit), warnTimes: times(warn), critTimes: times(crit) };
  }

  // Dari request hitungan (raw) dan request sekarang: arah, request akhir, dan limit.
  // Selisih di bawah 5% dianggap tetap.
  function adjust(raw, req, mult) {
    const change = req > 0 ? (raw / req - 1) * 100 : 0;
    const dir = Math.abs(change) < 5 ? 'tetap' : change < 0 ? 'turun' : 'naik';
    const recReq = dir === 'tetap' && req > 0 ? req : raw;
    return { change, dir, recReq, recLim: Math.ceil(recReq * mult) };
  }

  // Rekomendasi request, limit, dan biaya.
  // Request = yang terbesar dari: (1) rata-rata antar pod pada persentil pilihan dibagi (target - ruang aman),
  // agar HPA tidak scale-up; (2) p99 pod tunggal + buffer; (3) minimum.
  // Limit = request x pengali. Biaya = pod x jam x request x harga, sama seperti panel Monthly Cost.
  function plan(res, c) {
    const sm = summarize(res, { req: c.req, lim: c.lim, target: c.target, margin: c.margin });
    const avgBasis = sm.avg[c.basis];
    const reqHpa = Math.ceil(avgBasis / ((c.target - c.margin) / 100));
    const reqPod = Math.ceil(sm.pooled.p99 * (1 + c.buffer / 100));
    const raw = Math.max(c.min, reqHpa, reqPod);
    const binds = raw === reqHpa ? 'hpa' : raw === reqPod ? 'pod' : 'min';
    const { change, dir, recReq, recLim } = adjust(raw, c.req, c.mult);
    const limitRisk = recLim < sm.maxPod * 1.1;
    const unitCost = r => costFor(c.kind, r, c.pods, c.hours, c.priceCore, c.priceGiB);
    const costNow = unitCost(c.req), costNew = unitCost(recReq);
    const after = simulate(res, c.target, c.margin, [recReq])[0];
    const alert = alertPlan(res, recReq, c.warnPct || 80, c.critPct || 90);
    return { sm, avgBasis, reqHpa, reqPod, raw, binds, change, dir, recReq, recLim, limitRisk, costNow, costNew, saving: costNow - costNew, after, alert };
  }

  // CSV jumlah pod dari panel Grafana (Pod Available, Pod Desired, Min Pods, Max Pods, dst.).
  // Bedanya dengan CSV CPU/Memory: tidak ada kolom bernama pod.
  const PODCOL = /-[a-z0-9]{6,10}-[a-z0-9]{5}$/;
  function isReplicas(rows, filename) {
    const fn = (filename || '').toLowerCase();
    if (/(cpu|memory)[ _-]*usage/.test(fn)) return false;
    if (/pod[ _-]*(available|desired)|min[ _-]*pods|max[ _-]*pods|replica|hpa/.test(fn)) return true;
    if (!rows || rows.length < 2) return false;
    const h = rows[0].map(x => String(x).trim()).filter(x => !/^time$/i.test(x));
    return h.length <= 6 && !h.some(x => PODCOL.test(x)) && !/cpu|memory/.test(fn);
  }
  function labelFromFile(filename) {
    return String(filename || 'pod').replace(/^.*[\\/]/, '').replace(/\.csv$/i, '').replace(/-data-as-.*$/i, '').replace(/[-_]data$/i, '').trim() || 'pod';
  }
  function analyzeSeries(rows, filename) {
    if (!rows || rows.length < 2) return { error: 'err_empty' };
    const h = rows[0].map(x => String(x).trim());
    let ti = h.findIndex(x => /^time$/i.test(x));
    if (ti < 0) ti = 0;
    const idx = h.map((_, j) => j).filter(j => j !== ti);
    const out = [];
    for (const j of idx) {
      const pts = [];
      for (let r = 1; r < rows.length; r++) {
        const c = readCell(rows[r][j]), t = parseTime(rows[r][ti]);
        if (c && t != null) pts.push({ t, v: c.v });
      }
      if (pts.length) out.push({ label: idx.length === 1 ? labelFromFile(filename) : h[j], pts });
    }
    return out.length ? { series: out } : { error: 'err_nonum' };
  }
  // Jumlah pod yang punya data di tiap waktu, dari CSV CPU atau Memory.
  function podCounts(res) {
    return res.series.filter(x => x.t != null).map(x => ({ t: x.t, v: x.n }));
  }
  function seriesStats(pts) {
    const v = asc(pts.map(p => p.v));
    return { last: pts[pts.length - 1].v, min: v[0], median: pct(v, .5), max: v[v.length - 1], n: pts.length };
  }

  // CSV panel Monthly Cost: satu angka. Ambil angka terakhir di baris terakhir yang berisi angka (selain kolom Time).
  function parseCost(rows) {
    if (!rows || rows.length < 2) return null;
    const h = rows[0].map(x => String(x).trim());
    let ti = h.findIndex(x => /^time$/i.test(x));
    if (ti < 0) ti = 0;
    for (let r = rows.length - 1; r >= 1; r--) {
      for (let j = rows[r].length - 1; j >= 0; j--) {
        if (j === ti) continue;
        const c = readCell(String(rows[r][j]).replace(/^\s*\$/, ''));
        if (c && c.v >= 0) return c.v;
      }
    }
    return null;
  }

  // Harga per core-jam dan per GiB-jam dari biaya service sekarang.
  // Satu biaya tidak cukup untuk dua harga, jadi rasio harga memory terhadap CPU dipakai sebagai asumsi.
  // biaya = pod x jam x (core x hargaCore + GiB x hargaCore x rasio)
  function detectPrices(o) {
    if (!(o.cost > 0)) return { error: 'err_cost' };
    if (!(o.pods > 0)) return { error: 'err_pods' };
    if (!(o.reqCpu > 0) || !(o.reqMem > 0)) return { error: 'err_req' };
    if (!(o.ratio > 0)) return { error: 'err_ratio' };
    const base = o.pods * o.hours * (o.reqCpu / 1000 + o.reqMem / 1024 * o.ratio);
    const priceCore = o.cost / base;
    return { priceCore, priceGiB: priceCore * o.ratio };
  }

  const Core = { parseCSV, analyze, summarize, simulate, plan, adjust, alertPlan, pct, asc, isReplicas, analyzeSeries, podCounts, seriesStats, detectPrices, parseCost, serviceName, costFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : globalThis);
