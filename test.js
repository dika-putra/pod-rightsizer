// Jalankan: node test.js
const assert = require('assert');
const Core = require('./core.js');

// Dua pod, memory 500 dan 600 MiB konstan, satu sel kosong ("undefined" seperti ekspor Grafana).
const rows = ['Time,app-aaaaaaaaa-11111,app-aaaaaaaaa-22222,requests,limits']
  .concat(Array.from({ length: 10 }, (_, i) => `${1790000000000 + i * 120000},500 MiB,${i === 0 ? 'undefined' : '600 MiB'},1 GiB,2 GiB`)).join('\n');
const res = Core.analyze(Core.parseCSV(rows), { filename: 'x.csv' });
assert.strictEqual(res.kind, 'memory');
assert.strictEqual(res.request, 1024);          // 1 GiB dibaca sebagai MiB
assert.strictEqual(res.series[0].avg, 500);     // titik pertama hanya satu pod
assert.strictEqual(res.series[1].avg, 550);     // rata-rata antar pod

// Request 1000, target 80%, ruang 5 poin, buffer 15%, limit x2, 2 pod, harga 0.005 per GiB-jam.
const p = Core.plan(res, { kind: 'memory', req: 1000, lim: 2000, target: 80, margin: 5, basis: 'max', buffer: 15, mult: 2, min: 25, pods: 2, hours: 730, priceCore: 0.035, priceGiB: 0.005 });
assert.strictEqual(p.reqHpa, 734);              // ceil(550 / 0.75)
assert.strictEqual(p.reqPod, 690);              // ceil(600 * 1.15)
assert.strictEqual(p.recReq, 734);
assert.strictEqual(p.binds, 'hpa');
assert.strictEqual(p.dir, 'turun');
assert.strictEqual(p.recLim, 1468);
assert.ok(Math.abs(p.costNow - 7.1289) < 1e-3 && Math.abs(p.costNew - 5.2334) < 1e-3);

// CPU tanpa satuan dibaca sebagai milicore, request di bawah minimum tidak boleh turun lagi.
const cpu = Core.analyze(Core.parseCSV('Time,p-aaaaaaaa-11111,requests,limits\n1790000000000,10,25,100\n1790000120000,12,25,100'), { filename: 'CPU.csv' });
assert.strictEqual(cpu.kind, 'cpu');
const pc = Core.plan(cpu, { kind: 'cpu', req: 25, lim: 100, target: 80, margin: 5, basis: 'p99', buffer: 15, mult: 2, min: 25, pods: 1, hours: 730, priceCore: 0.035, priceGiB: 0.005 });
assert.strictEqual(pc.recReq, 25);
assert.strictEqual(pc.dir, 'tetap');
// Harga dari biaya: 2 pod x 730 jam x (1 core + 1 GiB x 0.2) x harga = 1752 x harga.
const dp = Core.detectPrices({ cost: 175.2, pods: 2, hours: 730, reqCpu: 1000, reqMem: 1024, ratio: 0.2 });
assert.ok(Math.abs(dp.priceCore - 0.1) < 1e-9 && Math.abs(dp.priceGiB - 0.02) < 1e-9);
assert.ok(Core.detectPrices({ cost: 10, pods: 2, hours: 730, reqCpu: 0, reqMem: 1024, ratio: 0.2 }).error);

// CSV jumlah pod: satu kolom nilai, labelnya diambil dari nama file.
const pr = Core.parseCSV('Time,Value\n1790000000000,2\n1790000120000,3');
assert.ok(Core.isReplicas(pr, 'Pod Available-data-as-joinbyfield-2026-10-13 09_56_45.csv'));
assert.ok(!Core.isReplicas(Core.parseCSV(rows), 'Memory Usage-data.csv'));
const rs = Core.analyzeSeries(pr, 'Pod Available-data-as-joinbyfield-2026-10-13 09_56_45.csv');
assert.strictEqual(rs.series[0].label, 'Pod Available');
assert.deepStrictEqual(Core.seriesStats(rs.series[0].pts), { last: 3, min: 2, median: 2.5, max: 3, n: 2 });
assert.deepStrictEqual(Core.podCounts(res).slice(0, 2).map(x => x.v), [1, 2]);
// Alert 80% dan 90% dari request 734 (hasil plan di atas): 587.2 dan 660.6 MiB. Pod tunggal maksimal 600, jadi tidak ada yang melewati.
assert.ok(Math.abs(p.alert.warn - 587.2) < 1e-6 && Math.abs(p.alert.crit - 660.6) < 1e-6);
assert.ok(p.alert.warnSamples > 0 && p.alert.warnSamples < 100 && p.alert.critSamples === 0);
// CSV Monthly Cost: satu angka, dengan atau tanpa tanda dolar.
assert.strictEqual(Core.parseCost(Core.parseCSV('Time,Value\n1790000000000,89.4')), 89.4);
assert.strictEqual(Core.parseCost(Core.parseCSV('Time,Value\n1790000000000,$12.30')), 12.3);
// Nama service dari nama pod, dan fungsi biaya yang dipakai plan.
assert.strictEqual(Core.serviceName(Core.parseCSV('Time,evermos-be-687486564-ggkh6,evermos-be-69bb8f8fbd-dpbrr,requests,limits\n1,2,3,4,5')), 'evermos-be');
assert.strictEqual(Core.serviceName(Core.parseCSV('Time,Value\n1,2')), '');
assert.ok(Math.abs(Core.costFor('memory', 1024, 2, 730, 0.035, 0.005) - 7.3) < 1e-9);
// adjust: tanpa ambang, selisih sekecil apa pun tetap turun atau naik; limit = request x pengali.
assert.deepStrictEqual(Core.adjust(100, 102, 2), { change: (100 / 102 - 1) * 100, dir: 'turun', recReq: 100, recLim: 200 });
assert.strictEqual(Core.adjust(100, 100, 2).dir, 'tetap');
assert.strictEqual(Core.adjust(100, 0, 2).dir, 'tetap');   // request sekarang tidak diketahui
assert.strictEqual(Core.adjust(100, 200, 1.5).dir, 'turun');
assert.strictEqual(Core.adjust(300, 200, 1.5).recLim, 450);
// limits bernilai 0 di Grafana diabaikan, nilai positif dipakai.
const z = Core.analyze(Core.parseCSV('Time,p-aaaaaaaa-11111,requests,limits\n1790000000000,10,25,0\n1790000120000,12,25,128\n1790000240000,12,25,0'), { filename: 'CPU.csv' });
assert.strictEqual(z.limit, 128);
const z0 = Core.analyze(Core.parseCSV('Time,p-aaaaaaaa-11111,requests,limits\n1790000000000,10,25,0\n1790000120000,12,25,0'), { filename: 'CPU.csv' });
assert.strictEqual(z0.limit, null);
// Pembulatan ke atas: bebas, kelipatan, pangkat 2.
assert.strictEqual(Core.roundUp(305.2, { mode: 'free' }), 306);
assert.strictEqual(Core.roundUp(300, { mode: 'step', step: 25 }), 300);
assert.strictEqual(Core.roundUp(301, { mode: 'step', step: 25 }), 325);
assert.strictEqual(Core.roundUp(100, { mode: 'pow2' }), 128);
assert.strictEqual(Core.roundUp(128, { mode: 'pow2' }), 128);
assert.strictEqual(Core.roundUp(3, { mode: 'pow2' }), 4);
// plan memakai pembulatan untuk request dan limit; limit mengikuti aturan yang sama.
const rp = Core.plan(res, { kind: 'memory', req: 1000, lim: 2000, target: 80, margin: 5, basis: 'max', buffer: 15, mult: 2, min: 25, pods: 2, hours: 730, priceCore: 0.035, priceGiB: 0.005, round: { mode: 'step', step: 25 } });
assert.strictEqual(rp.pre, 734);
assert.strictEqual(rp.raw, 750);
assert.strictEqual(rp.recReq, 750);
assert.strictEqual(rp.recLim, 1500);
const rq = Core.plan(res, { kind: 'memory', req: 1000, lim: 2000, target: 80, margin: 5, basis: 'max', buffer: 15, mult: 2, min: 25, pods: 2, hours: 730, priceCore: 0.035, priceGiB: 0.005, round: { mode: 'pow2' } });
assert.strictEqual(rq.raw, 1024);
assert.strictEqual(rq.dir, 'naik');       // tidak ada ambang 5%, 1024 dibanding 1000 tetap naik
assert.strictEqual(rq.recReq, 1024);
assert.strictEqual(rq.recLim, 2048);
// Limit di bawah request (misal limit CPU 0.1 terbaca di panel memory) dianggap kosong.
const bad = Core.analyze(Core.parseCSV('Time,p-aaaaaaaa-11111,requests,limits\n1790000000000,300000000,52428800,0.1\n1790000120000,310000000,52428800,0.1'), { filename: 'Memory Usage.csv' });
assert.strictEqual(bad.kind, 'memory');
assert.strictEqual(bad.request, 50);
assert.strictEqual(bad.limit, null);
// Persentil pod tunggal: p95 atau p99 (default p99). 100 sampel, 95 bernilai 100 dan 5 bernilai 200.
const pv = ['Time,p-aaaaaaaa-11111,requests,limits'];
for (let i = 0; i < 100; i++) pv.push(`${1790000000000 + i * 120000},${i < 95 ? 100 : 200},500,1000`);
const pres = Core.analyze(Core.parseCSV(pv.join('\n')), { filename: 'CPU.csv' });
const pbase = { kind: 'cpu', req: 500, lim: 1000, target: 80, margin: 5, basis: 'p95', buffer: 15, mult: 2, min: 25, pods: 1, hours: 730, priceCore: 0.035, priceGiB: 0.005 };
const p99 = Core.plan(pres, pbase), p95 = Core.plan(pres, { ...pbase, podPct: 'p95' });
assert.strictEqual(p99.reqPod, 230);   // ceil(200 * 1.15)
assert.strictEqual(p95.reqPod, 121);   // ceil(105 * 1.15)
assert.strictEqual(p99.recReq < 500, true);
assert.ok(p95.recReq <= p99.recReq);
// Backtest: 1 pod, 100 sampel (95 bernilai 100, 5 bernilai 200). p99 = 200.
const bt = (req, lim) => Core.backtest(pres, req, lim);
assert.strictEqual(bt(250, 500).level, 'yellow');     // 200 / 250 = 80%
assert.strictEqual(bt(300, 500).level, 'green');      // 66.7%
assert.strictEqual(bt(200, 500).level, 'red');        // 100%
assert.strictEqual(bt(400, 200).nAboveLim, 5);        // sampel bernilai 200 >= limit 200
assert.strictEqual(bt(400, 200).podsAboveLim, 1);
assert.strictEqual(Math.round(bt(150, 500).pctAboveReq), 5);
assert.strictEqual(pres.podMax[0], 200);

// HPA gabungan: ambil metrik yang lebih tinggi di tiap titik waktu, di irisan waktu kedua CSV.
const csvOf = vals => 'Time,p-aaaaaaaa-11111,requests,limits\n' + vals.map((v, i) => `${1790000000000 + i * 600000},${v},100,200`).join('\n');
const cA = Core.analyze(Core.parseCSV(csvOf([10, 10, 90, 10])), { filename: 'CPU.csv', kind: 'cpu' });
const mA = Core.analyze(Core.parseCSV(csvOf([95, 20, 20, 20]).replace(/,100,200/g, ',104857600,209715200').replace(/,(\d+),104857600/g, (m, v) => ',' + v * 1048576 + ',104857600')), { filename: 'Memory.csv', kind: 'memory' });
const hc = Core.hpaCombined(cA, mA, 100, 100, 80);
assert.strictEqual(hc.points, 4);
assert.strictEqual(hc.above, 2);                       // titik 1 (memory 95%) dan titik 3 (CPU 90%)
assert.strictEqual(hc.byMem, 1);
assert.strictEqual(hc.byCpu, 1);
assert.strictEqual(Math.round(hc.overlap), 100);
// Irisan sebagian: memory hanya separuh rentang CPU.
const mHalf = Core.analyze(Core.parseCSV(csvOf([95, 20]).replace(/,100,200/g, ',104857600,209715200').replace(/,(\d+),104857600/g, (m, v) => ',' + v * 1048576 + ',104857600')), { filename: 'Memory.csv', kind: 'memory' });
assert.strictEqual(Math.round(Core.hpaCombined(cA, mHalf, 100, 100, 80).overlap), 100);   // dihitung terhadap rentang yang lebih pendek
assert.strictEqual(Core.hpaCombined(cA, mA, 0, 100, 80), null);

// Rentang data: 4 titik per 10 menit = 30 menit.
assert.ok(Math.abs(Core.spanDays(cA) - 30 / 1440) < 1e-9);
console.log('ok');
