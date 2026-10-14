# Pod Rightsizer

Upload CPU and memory CSV exports from Grafana and get a recommended request and limit for each pod, the current monthly cost, and the estimated saving.

Everything runs in the browser. Files are read locally and never uploaded. There are no dependencies and no build step. The UI is available in Indonesian and English (ID/EN toggle, top right), and longer explanations are in info tooltips.

## Run

Open `index.html` in a browser. If the browser blocks local scripts, serve the folder instead:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. The page starts with sample data so you can see the output before loading your own.

## Get the data from Grafana

1. Set the time range you want to analyze (for example 24 hours or 14 days).
2. On the CPU Usage or Memory Usage panel, open the panel menu, then Inspect, then Data.
3. In Data options, set Show data frame to **Series joined by time**.
4. Turn **Formatted data** off, so values are plain numbers without `MiB` or `milicore`.
5. Click Download CSV. Repeat for the other panel to analyze CPU and memory together.

You can also upload pod count CSVs, for example from the Pod Available and Pod Desired panels. Any CSV with a Time column and numeric columns works. With one value column, the series is named after the file name.

The current request and limit are shown at the top and can be edited. Grafana sometimes reports them as 0 or empty (often fixed by restarting the service): zero values are ignored when reading the CSV, and the page warns when a value is missing so you can fill it in. The service table follows those edits.

A limit that is lower than the request is treated as missing, because Kubernetes does not allow it. It usually means the dashboard's limit query reads the wrong resource, for example a memory panel whose limits query uses `resource="cpu"` and returns `0.1`.

Formatted exports (`470 MiB`, `23.6 milicore`) are also read. The CSV needs one column per pod. Columns named `requests` and `limits` are used as the current values.

## How the recommendation works

For each resource, the recommended request is the largest of three numbers:

| Rule | Formula |
| --- | --- |
| HPA | average across pods at the chosen percentile / (HPA target - safety margin) |
| Single pod | p99 of any single pod x (1 + buffer) |
| Minimum | the configured minimum request |

The average across pods is computed at each timestamp over the pods that exist at that time, which is how an HPA utilization target is evaluated.

Request and limit are rounded up by the rounding setting for each resource: free (whole numbers), a step of N (for example 25 gives 25, 50, 75), or a power of 2 (4, 8, 16, ... 128, 256, 512).

### Checks

- **Safety check (backtest).** For each resource the page compares the single pod p99 with the new request on the same data: green below 80% of the request, yellow from 80% up to 100%, red at 100% or more. It also shows the share of samples at or above the new request, and how many samples (and pods) were at or above the new limit.
- **HPA scale-up estimate (CPU or memory).** HPA uses the higher of the two utilizations. With both CSVs loaded, the page takes the higher of CPU and memory at each timestamp, over the time the two files share, and shows how often it passes the target for the new request and for the current one. It warns when the shared time is under 90% of the shorter range.
- **Data range.** The tool expects 14 days of data and warns when a file spans fewer than 13 or more than 15 days. The numbers are still calculated.

The recommended limit is `request x multiplier`. The page warns when that limit is lower than 1.1x the highest pod in the data, because a CPU limit that low can throttle and a memory limit that low can cause OOM kills.

Cost follows the request: `pods x 730 hours x request x unit price`, with CPU priced per core-hour and memory per GiB-hour. The summary adds up the resources you loaded. The pod count is the median number of concurrent pods in the data: the average is pushed up by short deploy and scale-up bursts, and on evermos-be the median reproduced the current monthly cost within about 1% where the average was 16% too high.

### Alerts

The summary also suggests per-pod alert thresholds as a percentage of the recommended request: warning at 80% and critical at 90% by default. The `alerts` snippet has one target per alert, so it uses a separate level per resource: CPU 90% and memory 80% by default, which matches the alerts running today. For each threshold it shows how often the loaded data would have crossed it, so you can see whether an alert would be noisy before you create it. The example `alerts` block (message, target, type) is a starting point for Helm values and needs to be adapted to your chart.

### Service table

Each analysis can be added as one row to a table with one column set per service: pods, current and new request and limit for CPU and memory, p99 peaks, current cost, and saving. The table is saved in this browser (localStorage) and can be copied as tab-separated rows to paste into Excel or Google Sheets, or downloaded as CSV. Columns follow the monitoring sheet: Week, Pods (median / max), CPU request and limit, memory request and limit, Peak CPU and Peak memory (p99), Total Cost, CPU Status, Mem Status, four columns with the new values (new CPU request, new CPU limit, new memory request, new memory limit), and Cost change. Status compares the p99 peak with the current request and limit (for example Over-provisioned, Burst safe, Near OOM). Cost change is the new monthly cost minus the current one: positive when the cost goes up, negative when it goes down. The summary at the top still says "saving" in words.

The new-value columns hold the recommended number itself, for example a request of 50 that should become 25 is written as `25`. They show `-` when nothing changes (same as the current value) or when that resource is not loaded.

Copy rows gives rows without a header and starting from the Week column (no service name or link), in table order (use the up and down buttons on each row to reorder), so you can paste them next to services already listed in your sheet. Download CSV has the same columns with a header, starting from the service.

To add many services at once, choose several CSV files in one go. Pod names in the CSV (`<service>-<hash>-<id>`) identify the service, so CPU and memory files of the same service are paired and one row is added per service. A service's real monthly cost can be typed into the Current cost cell of its row, which recalculates its saving. Without it the row uses the standard price estimate. A row with the same service and week is replaced.

### Config snippets

The summary has copy-ready `resources` and `alerts` blocks in Helm values format. The numbers in the tool are totals for the whole pod. If the pod has sidecar containers, enter their request and limit in Settings and the `resources` snippet will show the main container only (pod total minus sidecar).

### Prices

Prices are detected from the service's current monthly cost by default. Enter the cost next to the upload box, or upload the CSV of a Monthly Cost panel (any file named like `Monthly Cost`, with one number). To type the two unit prices yourself, tick **Isi harga sendiri** in Settings. The manual price fields only appear then. The cost is optional. Without it, the cost is estimated with standard example prices and the summary says so. A single cost cannot give two prices, so the memory price per GiB-hour is derived from a ratio to the CPU price per core-hour (default 0.14, an example value). The detected prices reproduce the cost you entered. This needs the current CPU and memory requests, taken from the loaded CSVs or typed in.

## Pod counts

The Jumlah pod section shows min, median, max and last value of each series, plus a step chart. The first series, pods running, is the number of pods that have data in the CPU or memory CSV at each timestamp. Other series come from the pod count CSVs you upload.

## Team rules

These come from the manager and DevOps, not from the tool:

| Rule | Value |
| --- | --- |
| Limit multiplier | 2, the same for CPU and memory (configurable per resource) |
| Minimum request | 25, for CPU (m) and memory (MiB) |
| Rounding | up to a multiple of 25, for CPU and memory |

These are the tool's own choices and have not been reviewed by the manager or DevOps yet: single pod percentile p99, single pod buffer 25%, HPA average at p99, safety margin 5 points, and the 80% and 90% alert levels.

Changes are approved by the manager and applied one service at a time. For one service, the CPU, memory and alert changes go out together. Monitoring is done in Grafana.

## Settings

| Setting | Default |
| --- | --- |
| HPA target | 80% |
| Safety margin | 5 points |
| Average percentile | p99 |
| Single pod buffer | 25% |
| Single pod percentile | p99 (CPU can be set to p95, memory is always p99) |
| Limit multiplier | 2 (CPU and memory can be set separately) |
| Rounding (CPU and memory, separate) | step of 25, rounded up (free, step of N, or power of 2) |
| Alert warning / critical (table) | 80% / 90% of request |
| Alert level in the snippet | CPU 90%, memory 80% of request |
| Sidecar request and limit | 0 (none) |
| Container names | main: the detected service name, sidecar: `nginx` |
| Minimum request | 25 |
| Pod count | median of concurrent pods, taken from the data |
| CPU price | $0.035 per core-hour (example value) |
| Memory price | $0.005 per GiB-hour (example value) |
| Price ratio (detect mode) | 0.14 memory per GiB / CPU per core (example value) |

The prices and the ratio are examples. Replace them with your cluster's real values.

## Limits of the estimate

- A real HPA scales on the average utilization across all pods, not on one high pod, and by default skips scaling while the ratio to the target is within a 10% tolerance (an 80% target reacts at about 88%). For CPU it also sets aside some metrics of pods that just started. The page counts every pod and every timestamp, so its estimate of scale-up frequency tends to be higher than reality. Simultaneous bursts such as deploys or traffic surges can still trigger scale-ups when the request is lowered.
- Behavior described above is from the Kubernetes HPA documentation.
- Grafana exports points at the panel's step, so short spikes can be smoothed out.
- Values without a unit are read as bytes for memory when they are large, and as millicores for CPU.
- The tool only reads usage. Check the limit recommendation against your latency and OOM history before applying it.

## Test

```bash
node test.js
```

The same test runs on every push and pull request through GitHub Actions (`.github/workflows/test.yml`).
