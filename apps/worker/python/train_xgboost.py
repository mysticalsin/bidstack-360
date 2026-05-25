#!/usr/bin/env python3
"""
XGBoost binary-classifier trainer — sidecar for the BidStack predictive
scoring worker.

Invocation:
    cat training_data.json | python3 train_xgboost.py > result.json

Input (stdin, JSON):
    {
        "X": [[...], [...], ...],          # n_samples x n_features
        "y": [0, 1, 0, ...],                # n_samples binary labels
        "feature_names": ["f1", "f2", ...], # length = n_features
        "test_size": 0.2,                   # held-out split fraction
        "seed": 42                          # for reproducibility
    }

Output (stdout, JSON):
    {
        "model_json": "...",                # XGBoost booster save_raw('json')
        "metrics": {
            "precision": 0.83,
            "recall": 0.79,
            "f1": 0.81,
            "auc": 0.89
        },
        "feature_importance": {
            "f1": 0.42, "f2": 0.18, ...     # gain-based importance, normalized
        },
        "best_iteration": 47,
        "n_train_samples": 160,
        "n_test_samples": 40
    }

On any failure (xgboost not installed, malformed input, training error), exit
code 1 with a JSON error on stdout:
    {"error": "...message..."}

Why pure stdin/stdout and not a long-running service:
    - No new process supervision burden on the worker host
    - No port allocation / health-check pattern to maintain
    - Worker shells out for at most a few seconds per org per week
    - Trivial to swap (e.g. for AWS SageMaker) without changing the TS caller

Dependencies (declared in apps/worker/python/requirements.txt):
    xgboost>=2.0  scikit-learn>=1.3  numpy>=1.24

Tested against: Python 3.10, 3.11, 3.12.
"""

from __future__ import annotations
import json
import sys
from typing import Any


def fail(message: str) -> None:
    """Emit a single-line JSON error and exit 1."""
    print(json.dumps({"error": message}))
    sys.exit(1)


def load_payload() -> dict[str, Any]:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        fail(f"stdin is not valid JSON: {exc}")


def validate(payload: dict[str, Any]) -> None:
    for required in ("X", "y", "feature_names"):
        if required not in payload:
            fail(f"missing required key: {required}")

    X = payload["X"]
    y = payload["y"]
    feature_names = payload["feature_names"]

    if not isinstance(X, list) or len(X) == 0:
        fail("X must be a non-empty list of feature vectors")
    if not isinstance(y, list) or len(y) != len(X):
        fail("y must be a list of the same length as X")
    if not isinstance(feature_names, list) or len(feature_names) != len(X[0]):
        fail("feature_names must match the column count of X")
    for row in X:
        if len(row) != len(feature_names):
            fail("all rows in X must have the same length as feature_names")


def train(payload: dict[str, Any]) -> dict[str, Any]:
    # Local imports so the script can return a clean error if deps are missing.
    try:
        import numpy as np
        import xgboost as xgb
        from sklearn.metrics import (
            precision_score,
            recall_score,
            f1_score,
            roc_auc_score,
        )
        from sklearn.model_selection import train_test_split
    except ImportError as exc:
        fail(
            f"missing Python dependency ({exc.name}). "
            "Install with: pip install -r apps/worker/python/requirements.txt"
        )

    X = np.array(payload["X"], dtype=np.float64)
    y = np.array(payload["y"], dtype=np.int32)
    feature_names: list[str] = payload["feature_names"]
    test_size = float(payload.get("test_size", 0.2))
    seed = int(payload.get("seed", 42))

    # Single-class dataset → XGBoost cannot train. Fall through with a flagged
    # result so the TS caller can drop back to logistic regression.
    if len(np.unique(y)) < 2:
        fail("training set contains only one class — cannot train classifier")

    # Stratify when possible (≥2 of each class). Otherwise unstratified split.
    pos_count = int(np.sum(y == 1))
    neg_count = int(np.sum(y == 0))
    stratify = y if pos_count >= 2 and neg_count >= 2 else None

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=seed, stratify=stratify,
    )

    # WHY these hyperparameters:
    #   - max_depth=4: prevents overfitting on small org datasets (<500 samples)
    #   - n_estimators=200: enough to converge for CRM signal quality
    #   - learning_rate=0.05: slower learning → better generalization
    #   - early_stopping_rounds=20: cuts training short when val AUC plateaus
    #   - scale_pos_weight: handles class imbalance per-org
    pos_weight = (neg_count / pos_count) if pos_count > 0 else 1.0

    model = xgb.XGBClassifier(
        objective="binary:logistic",
        max_depth=4,
        n_estimators=200,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=pos_weight,
        early_stopping_rounds=20,
        eval_metric="auc",
        random_state=seed,
        verbosity=0,
        # WHY tree_method='hist': fastest training on CPU, good accuracy
        tree_method="hist",
    )

    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    # Predictions on held-out set
    y_pred_proba = model.predict_proba(X_test)[:, 1]
    y_pred = (y_pred_proba >= 0.5).astype(int)

    # Edge case: zero_division=0 makes metrics deterministic when a class is
    # completely missed in predictions.
    metrics = {
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
        "auc": float(roc_auc_score(y_test, y_pred_proba)) if len(np.unique(y_test)) > 1 else 0.0,
    }

    # Gain-based importance, normalized to sum=1.0 so it's directly comparable
    # across orgs/models.
    importance_raw = model.get_booster().get_score(importance_type="gain")
    # Booster keys are f0..fN — remap to the human-readable feature names.
    importance: dict[str, float] = {}
    for key, value in importance_raw.items():
        idx = int(key.lstrip("f"))
        if 0 <= idx < len(feature_names):
            importance[feature_names[idx]] = float(value)
    total = sum(importance.values()) or 1.0
    importance = {k: round(v / total, 4) for k, v in importance.items()}

    # Serialize booster to JSON so TS can persist it.
    model_json = model.get_booster().save_raw("json").decode("utf-8")

    return {
        "model_json": model_json,
        "metrics": {k: round(v, 4) for k, v in metrics.items()},
        "feature_importance": importance,
        "best_iteration": int(getattr(model, "best_iteration", model.n_estimators)),
        "n_train_samples": len(X_train),
        "n_test_samples": len(X_test),
    }


def main() -> None:
    payload = load_payload()
    validate(payload)
    try:
        result = train(payload)
    except Exception as exc:
        # XGBoost training errors (numerical instability, etc.) end up here.
        # Surface them as a JSON error so the TS caller can decide to retry
        # or fall back without parsing a stack trace.
        fail(f"xgboost training failed: {type(exc).__name__}: {exc}")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
