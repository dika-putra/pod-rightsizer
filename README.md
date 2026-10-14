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

Formatted exports (`470 MiB`, `23.6 milicore`) are also read. The CSV needs one column per pod. Columns named `requests` and `limits` are used as the current values.

## How the recommendation works

For each resource, the recommended request is the largest of three numbers:

| Rule | Formula |
| --- | --- |
| HPA | average across pods at the chosen percentile / (HPA target - safety margin) |
| Single pod | p99 of any single pod x (1 + buffer) |
| Minimum | the configured minimum request |

The average across pods is computed at each timestamp over the pods that exist at that time, which is how an HPA utilization target is evaluated. If the result is within 5% of the current request, the request stays as it is.

The recommended limit is `request x multiplier`. The page warns when that limit is lower than 1.1x the highest pod in the data, because a CPU limit that low can throttle and a memory limit that low can cause OOM kills.

Cost follows the request: `pods x 730 hours x request x unit price`, with CPU priced per core-hour and memory per GiB-hour. The summary adds up the resources you loaded.

### Alerts

The summary also suggests per-pod alert thresholds as a percentage of the recommended request: warning at 80% and critical at 90% by default. For each threshold it shows how often the loaded data would have crossed it, so you can see whether an alert would be noisy before you create it. The example `alerts` block (message, target, type) is a starting point for Helm values and needs to be adapted to your chart.

### Service table

Each analysis can be added as one row to a table with one column set per service: pods, current and new request and limit for CPU and memory, p99 peaks, current cost, and saving. The table is saved in this browser (localStorage) and can be copied as tab-separated rows to paste into Excel or Google Sheets, or downloaded as CSV. Copy rows gives rows without a header, so you can append them under an existing header.

To add many services at once, choose several CSV files in one go. Pod names in the CSV (`<service>-<hash>-<id>`) identify the service, so CPU and memory files of the same service are paired and one row is added per service. A service's real monthly cost can be typed into the Current cost cell of its row, which recalculates its saving. Without it the row uses the standard price estimate. A row with the same service and week is replaced.

### Config snippets

The summary has copy-ready `resources` and `alerts` blocks in Helm values format. The numbers in the tool are totals for the whole pod. If the pod has sidecar containers, enter their request and limit in Settings and the `resources` snippet will show the main container only (pod total minus sidecar).

### Prices

Prices are detected from the service's current monthly cost by default. Enter the cost next to the upload box, or upload the CSV of a Monthly Cost panel (any file named like `Monthly Cost`, with one number). To type the two unit prices yourself, tick **Isi harga sendiri** in Settings. The manual price fields only appear then. The cost is optional. Without it, the cost is estimated with standard example prices and the summary says so. A single cost cannot give two prices, so the memory price per GiB-hour is derived from a ratio to the CPU price per core-hour (default 0.14, an example value). The detected prices reproduce the cost you entered. This needs the current CPU and memory requests, taken from the loaded CSVs or typed in.

## Pod counts

The Jumlah pod section shows min, median, max and last value of each series, plus a step chart. The first series, pods running, is the number of pods that have data in the CPU or memory CSV at each timestamp. Other series come from the pod count CSVs you upload.

## Settings

| Setting | Default |
| --- | --- |
| HPA target | 80% |
| Safety margin | 5 points |
| Average percentile | p99 |
| Single pod buffer | 15% |
| Limit multiplier | 2 |
| Alert warning / critical | 80% / 90% of request |
| Sidecar request and limit | 0 (none) |
| Minimum request | 25 |
| Average pod count | taken from the data |
| CPU price | $0.035 per core-hour (example value) |
| Memory price | $0.005 per GiB-hour (example value) |
| Price ratio (detect mode) | 0.14 memory per GiB / CPU per core (example value) |

The prices and the ratio are examples. Replace them with your cluster's real values.

## Limits of the estimate

- A real HPA uses metrics-server and has its own handling for pods that are starting or not ready, so its numbers can differ slightly.
- Grafana exports points at the panel's step, so short spikes can be smoothed out.
- Values without a unit are read as bytes for memory when they are large, and as millicores for CPU.
- The tool only reads usage. Check the limit recommendation against your latency and OOM history before applying it.

## Test

```bash
node test.js
```
