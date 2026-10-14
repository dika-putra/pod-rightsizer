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
console.log('ok');
