# apps/worker/python — Python sidecar scripts

The TS worker shells out to Python for tasks where the Python ML ecosystem
(XGBoost, scikit-learn) is materially better than what's available in JS.

## Current sidecars

| Script | Purpose | Called from |
|--------|---------|-------------|
| `train_xgboost.py` | Trains an XGBoost binary classifier per org for predictive scoring | `apps/worker/src/services/scoring/trainer-xgboost.ts` |

## Setup

### Local development

```bash
cd apps/worker
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r python/requirements.txt
```

Verify:

```bash
echo '{"X": [[1,2],[2,3],[3,1],[1,1]], "y": [0,1,1,0], "feature_names": ["a","b"]}' \
  | python3 python/train_xgboost.py
```

You should see a JSON line with `model_json`, `metrics`, and `feature_importance`.

### Production / Docker

Add to your Dockerfile (after the Node setup):

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv && \
    python3 -m venv /opt/python-venv && \
    /opt/python-venv/bin/pip install --no-cache-dir \
      -r /app/apps/worker/python/requirements.txt && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/python-venv/bin:$PATH"
ENV PREDICTIVE_PYTHON_BIN=/opt/python-venv/bin/python3
```

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PREDICTIVE_PYTHON_BIN` | `python3` | Path to the Python interpreter to invoke |
| `PREDICTIVE_USE_XGBOOST` | `false` | Master flag — set `true` to enable XGBoost training |
| `PREDICTIVE_XGBOOST_TIMEOUT_MS` | `120000` | Kill the sidecar if it runs past this |

## Fallback behavior

If `PREDICTIVE_USE_XGBOOST=false` (the default) or if the Python sidecar fails
for any reason (missing dep, training error, timeout), the trainer falls back
to pure-JS logistic regression. This means the worker keeps shipping models
without an operational dependency on Python being correctly set up — XGBoost
is a strict upgrade, not a hard requirement.

A log line at warn level surfaces every fallback so you can tell the difference
between "Python not enabled" and "Python is enabled but broke."

## Why a sidecar rather than a long-running process

- No port allocation, no health check, no supervisor needed
- Runs at most a few seconds per org per week (retrain cadence)
- Trivial to swap to AWS SageMaker, GCP Vertex AI, or a different runtime
  without changing the TS caller
- Stdout/stdin protocol is debuggable from the shell

## Why not pure-JS XGBoost?

There are JS XGBoost wrappers (`xgboost-node`, ONNX runtime) but:

1. They all require building/loading a native binary; OS / arch matrices get painful in Docker.
2. The training code paths in those wrappers lag behind upstream Python features.
3. We already need Python around for our data scripts (`packages/db/scripts/`),
   so adding `xgboost` to the same Python env is a marginal cost.
