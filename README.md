# Pod Rightsizer

Upload CPU and memory CSV exports from Grafana and get a recommended request and limit for each pod, the current monthly cost, and the estimated saving.

Everything runs in the browser. Files are read locally and never uploaded. There are no dependencies and no build step. The page UI is in Indonesian.

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

## Settings

| Setting | Default |
| --- | --- |
| HPA target | 80% |
| Safety margin | 5 points |
| Average percentile | p99 |
| Single pod buffer | 15% |
| Limit multiplier | 2 |
| Minimum request | 25 |
| Average pod count | taken from the data |
| CPU price | $0.035 per core-hour (example value) |
| Memory price | $0.005 per GiB-hour (example value) |

The prices are examples. Replace them with your cluster's real prices.

## Limits of the estimate

- A real HPA uses metrics-server and has its own handling for pods that are starting or not ready, so its numbers can differ slightly.
- Grafana exports points at the panel's step, so short spikes can be smoothed out.
- Values without a unit are read as bytes for memory when they are large, and as millicores for CPU.
- The tool only reads usage. Check the limit recommendation against your latency and OOM history before applying it.

## Test

```bash
node test.js
```
