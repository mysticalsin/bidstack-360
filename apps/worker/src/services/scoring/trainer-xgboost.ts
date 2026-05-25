/**
 * XGBoost sidecar wrapper — invokes apps/worker/python/train_xgboost.py
 *
 * Returns a structured result on success, or null when XGBoost is disabled
 * or unavailable. The caller (trainer.ts) treats null as "use the LR
 * fallback" without surfacing it as an error to the user.
 *
 * WHY a wrapper module rather than inline in trainer.ts:
 *   - Keeps Python-specific concerns (spawn, encoding, timeout) isolated.
 *   - Lets us unit-test the sidecar contract without touching the LR pipeline.
 *   - Makes it trivial to swap the sidecar for SageMaker/Vertex without
 *     touching the main trainer's control flow.
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import pino from 'pino';

const log = pino({ name: 'scorer:xgboost', level: process.env.LOG_LEVEL ?? 'info' });

const PYTHON_BIN = process.env.PREDICTIVE_PYTHON_BIN ?? 'python3';
const SCRIPT_PATH_ENV = process.env.PREDICTIVE_XGBOOST_SCRIPT;
const TIMEOUT_MS = Number(process.env.PREDICTIVE_XGBOOST_TIMEOUT_MS ?? 120_000);
const USE_XGBOOST = (process.env.PREDICTIVE_USE_XGBOOST ?? 'false').toLowerCase() === 'true';

// Resolved at module load — apps/worker/python/train_xgboost.py from the worker
// process's cwd, or the override env var if set (useful when running from dist).
const DEFAULT_SCRIPT_REL_PATH = 'apps/worker/python/train_xgboost.py';
function resolveScriptPath(): string {
  return SCRIPT_PATH_ENV ?? DEFAULT_SCRIPT_REL_PATH;
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface XgboostTrainInput {
  X: number[][];
  y: number[];
  featureNames: string[];
  testSize?: number;
  seed?: number;
}

export interface XgboostMetrics {
  precision: number;
  recall: number;
  f1: number;
  auc: number;
}

export interface XgboostTrainResult {
  modelJson: string;
  metrics: XgboostMetrics;
  featureImportance: Record<string, number>;
  bestIteration: number;
  nTrainSamples: number;
  nTestSamples: number;
  /** Milliseconds spent inside the Python sidecar. */
  trainDurationMs: number;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Train an XGBoost model via the Python sidecar.
 *
 * @returns the trained model + metrics, or null if XGBoost is disabled,
 *          Python is missing, or the sidecar exits non-zero. Errors are
 *          logged at warn level so ops can distinguish "XGBoost off" from
 *          "XGBoost broke."
 */
export async function trainWithXgboost(
  input: XgboostTrainInput,
): Promise<XgboostTrainResult | null> {
  if (!USE_XGBOOST) {
    log.debug('XGBoost disabled (PREDICTIVE_USE_XGBOOST != true) — skipping sidecar');
    return null;
  }

  if (input.X.length < 10) {
    // XGBoost behaves poorly with single-digit sample counts; fall through.
    log.warn(
      { sampleCount: input.X.length },
      'XGBoost skipped — too few samples (need ≥10)',
    );
    return null;
  }

  const scriptPath = resolveScriptPath();
  const payload = {
    X: input.X,
    y: input.y,
    feature_names: input.featureNames,
    test_size: input.testSize ?? 0.2,
    seed: input.seed ?? 42,
  };

  const start = performance.now();
  try {
    const result = await runSidecar(scriptPath, payload);
    const elapsed = performance.now() - start;
    log.info(
      {
        scriptPath,
        sampleCount: input.X.length,
        metrics: result.metrics,
        trainDurationMs: Math.round(elapsed),
      },
      'XGBoost training complete',
    );
    return { ...result, trainDurationMs: Math.round(elapsed) };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), scriptPath },
      'XGBoost training failed — caller will fall back to logistic regression',
    );
    return null;
  }
}

// ─── Sidecar invocation ───────────────────────────────────────────────────

interface SidecarRawResult {
  model_json: string;
  metrics: XgboostMetrics;
  feature_importance: Record<string, number>;
  best_iteration: number;
  n_train_samples: number;
  n_test_samples: number;
}

interface SidecarError {
  error: string;
}

function runSidecar(scriptPath: string, payload: unknown): Promise<{
  modelJson: string;
  metrics: XgboostMetrics;
  featureImportance: Record<string, number>;
  bestIteration: number;
  nTrainSamples: number;
  nTestSamples: number;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    const timeoutId = setTimeout(() => {
      killedByTimeout = true;
      // SIGKILL — sidecar might be in a tight numpy loop ignoring SIGTERM
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      // ENOENT == python3 binary not found
      reject(new Error(`sidecar spawn failed: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (killedByTimeout) {
        reject(new Error(`sidecar timed out after ${TIMEOUT_MS}ms`));
        return;
      }
      if (stderr.trim()) {
        // Python warnings (e.g. xgboost convergence) go here; not fatal but useful
        log.debug({ stderr: stderr.trim() }, 'sidecar stderr');
      }
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`sidecar exited ${code} with no stdout`));
        return;
      }

      // The script always writes a single-line JSON: either result or {"error": "..."}
      let parsed: SidecarRawResult | SidecarError;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (err) {
        reject(
          new Error(
            `sidecar stdout not parseable JSON (exit=${code}): ${
              err instanceof Error ? err.message : err
            }`,
          ),
        );
        return;
      }

      if ('error' in parsed) {
        reject(new Error(`sidecar reported: ${parsed.error}`));
        return;
      }

      resolve({
        modelJson: parsed.model_json,
        metrics: parsed.metrics,
        featureImportance: parsed.feature_importance,
        bestIteration: parsed.best_iteration,
        nTrainSamples: parsed.n_train_samples,
        nTestSamples: parsed.n_test_samples,
      });
    });

    // Pipe payload via stdin (avoids argv length limits for large datasets)
    try {
      child.stdin.end(JSON.stringify(payload));
    } catch (err) {
      reject(new Error(`failed to write payload to stdin: ${(err as Error).message}`));
    }
  });
}
