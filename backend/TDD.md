# Backend TDD evidence

All production functions are introduced after a focused failing test. External DeepSeek calls are isolated; the actual LangChain adapter is also exercised against an HTTP mock transport. No paid calls run by default.

## Environment

- Python 3.11.8 (`D:/Python311/python.exe`); Windows `py -3.11` launcher is not registered, so use `python`.
- Read TDD skill and testing anti-patterns before implementation.
- Read current Context7 Pydantic, pydantic-settings and pytest documentation before using those APIs.
- Dependencies are resolved in `backend/.venv`, then frozen in `requirements.txt`.

## Cycle 1 — strict schemas, deterministic scoring, config/content/limiter

RED command: `.venv/Scripts/python -m pytest tests/test_models.py tests/test_scoring.py tests/test_core.py -q --tb=short`

Observed before production modules existed: **71 failed**, each within test execution with `ModuleNotFoundError: No module named 'app'` (missing feature, no collection errors). Tests specify input/raw-length bounds, strict types, option/answer relationships, report consistency, scoring authority and config/limiter behavior. Implementing those modules next.

GREEN same command: **71 passed in 0.95s**. No warnings.

## Cycle 2 — generation orchestration and services

RED: `.venv/Scripts/python -m pytest tests/test_generation.py -q --tb=line` → **20 failed in 0.32s**, missing quiz/report service modules. Cases specify exact distribution/count/difficulty, retries for malformed/schema-invalid output, total timeout, nonretryable auth failures, generated content screening and deterministic report stats. Implementing minimal orchestration and prompts next; actual provider transport follows its own RED cycle.

GREEN: `.venv/Scripts/python -m pytest -q --tb=short` → **91 passed in 2.78s**. No warnings.

## Cycle 3 — real LangChain provider transport and HTTP API

RED: `.venv/Scripts/python -m pytest tests/test_provider.py tests/test_api.py -q --tb=line` → **30 failed in 1.72s**. Missing DeepSeekProvider/create_app; no model requests were sent. Tests exercise actual ChatDeepSeek + HTTP mock transport for JSON mode, thinking disabled, truncation/parser failures, HTTP/network classification, missing keys, and complete HTTP envelope/CORS/limit behavior.

The session was interrupted after implementation and before GREEN. On resumption, the required full coverage run produced **1 failed, 120 passed in 20.26s** (96% coverage). The existing truncation regression failed because the installed OpenAI SDK raises `LengthFinishReasonError` before LangChain returns its `include_raw` envelope. The resumed worker read the TDD skill/testing anti-patterns, queried current Context7 `/langchain-ai/docs` for JSON mode and `include_raw=True`, and inspected the installed SDK exception definitions.

## Cycle 4 — recovered integration defects

Added focused regressions for SDK `content_filter`, a strict 45-second configuration ceiling, an actionable missing-Key response, chunked ASGI body handling/disconnect, and safe unexpected-error responses.

RED: `.venv/Scripts/python -m pytest tests/test_provider.py tests/test_core.py tests/test_api.py tests/test_middleware.py -q --tb=short` → **5 failed, 43 passed in 7.32s**:

1. Existing length-finish regression raised the SDK exception instead of the retryable parse error.
2. Content-filter finish had the same early-SDK-exception behavior.
3. Configuration incorrectly allowed a 45.1-second total budget.
4. Missing-Key API error did not identify `DEEPSEEK_API_KEY` or the `.env` remedy.
5. Middleware replay captured its reassigned `receive` variable, recursively calling itself after the buffered request body.

Minimal fixes normalize the two SDK finish exceptions, cap settings at 45 seconds, distinguish missing configuration, and retain the original ASGI receiver for following disconnect events.

GREEN, full coverage command: **129 passed in 9.76s**, 99% coverage, no warnings.

## Cycle 5 — optional live acceptance script

RED: `.venv/Scripts/python -m pytest tests/test_live_acceptance.py -q --tb=short` → **3 failed in 0.78s**, each explicitly identifying the missing script before implementation.

The script requires both `--run-live` and a nonblank user Key before constructing the live app or making a request. It runs 10 varied quiz/report pairs through the same FastAPI routes, validates quiz shape/distribution/difficulty and recomputed report statistics, and fails rather than inventing a success result.

GREEN with additional existing-branch verification: **135 passed in 9.56s**, **100%** application coverage (396 statements, 82 branches), no warnings. Running `python scripts/live_acceptance.py` without flags exits without a request and explains the required opt-in.

## Final integration verification

Added route-level tests using the actual `ChatDeepSeek` provider and mocked HTTP transport. They exercise 429, 500, malformed JSON and truncated-first-attempt recovery, then report generation, as well as nonretryable auth errors and exhausted retries. Additional API verification proves separate IP quotas and that forged `X-Forwarded-For` cannot bypass the directly connected IP quota.

Focused run: `.venv/Scripts/python -m pytest tests/test_provider_api.py tests/test_api.py -q --tb=short` → **20 passed in 7.47s**. These validate already implemented paths, so no production changes were needed.

Pre-review full coverage command: `.venv/Scripts/python.exe -m pytest --cov=app --cov-branch --cov-report=term-missing` → **142 passed in 27.31s**, no warnings or failures.

```text
TOTAL                        396      0     82      0   100%
============================ 142 passed in 27.31s =============================
```

All application modules have 100% statement/branch coverage, without exclusions or reduced coverage settings. A backend `.gitignore` excludes the virtual environment, Key file, Python caches and generated coverage artifacts.

`pip check` reports `No broken requirements found.` Dependencies are frozen in `requirements.txt`. No commit, push, deployment or paid API request was performed.

## Cycle 6 — strict original JSON after specification review

The reviewer identified that LangChain's Pydantic parser repairs incomplete and Markdown JSON. Reproduced this through the real `ChatDeepSeek` provider with `finish_reason="stop"`; inspecting installed `langchain_core/utils/json.py` confirmed the default `parse_partial_json` / `parse_json_markdown` behavior.

RED: `.venv/Scripts/python.exe -m pytest tests/test_provider.py tests/test_provider_api.py -q --tb=short` → **12 failed, 24 passed in 8.20s**. Missing closing brace, Markdown fences and trailing garbage were accepted at the transport layer and bypassed both successful-retry and retry-exhaustion API expectations. NaN/Infinity/-Infinity were accepted by a deliberately permissive float schema.

Extended RED before fixing for exponent overflow: `.venv/Scripts/python.exe -m pytest tests/test_provider.py -q -k 'nonfinite or finite_json' --tb=short` → **5 failed, 1 passed, 21 deselected in 5.61s**. This confirms that the old adapter also accepts `1e999` / `-1e999`, while preserving a valid finite float example.

Minimal fix retains `with_structured_output(method="json_mode", include_raw=True)`, but accepts only the complete original `raw.content` parsed by `json.loads` and then independently validated with `schema.model_validate`. It never accepts LangChain's repaired `parsed` result. Number hooks reject non-finite constants and float overflow. Parse failures remain `ValueError` and enter the existing total-budget retry policy, with no fallback result.

Focused GREEN: `.venv/Scripts/python.exe -m pytest tests/test_provider.py tests/test_provider_api.py -q --tb=short` → **39 passed in 7.14s**.

Full command after strict-JSON review: `.venv/Scripts/python.exe -m pytest --cov=app --cov-branch --cov-report=term-missing` → **157 passed in 14.81s**, no warnings or failures.

```text
TOTAL                        404      0     84      0   100%
============================ 157 passed in 14.81s =============================
```

All application modules retain full statement/branch coverage. Only backend files changed in this review fix; the user-created `.env` was not inspected or overwritten, and the running QA server was not operated.

## Cycle 7 — malformed completion envelopes, lifecycle ownership and conservative retries

Quality review identified two HTTP-200 completion-envelope shapes that fail inside the SDK before raw model content is exposed: `{}` raises `TypeError`, and `{"choices":[]}` raises `IndexError`. Real adapter→API regressions cover both recovery on the second attempt and safe 50302 responses after both attempts fail. The initial RED command `.venv/Scripts/python.exe -m pytest tests/test_provider_api.py tests/test_lifespan.py -q --tb=short` produced **8 failed, 14 passed in 11.66s**. Four failures reproduced one-call API500 behavior; the other four proved missing application-owned SDK cleanup / missing close method.

The lifecycle tests check normal and exceptional lifespan exit, that an injected provider remains caller-owned, that an injected provider needs no close contract, that a borrowed HTTP client remains open, and that missing-Key providers have no resources to close. Current Context7 FastAPI lifespan documentation was consulted before implementation.

Added safeguards that business schema validator `TypeError` / `IndexError` continue to propagate rather than being mislabeled as upstream errors, plus a RED case requiring retries to add conservative JSON/schema instructions without copying the malformed result back into messages.

Expanded RED command: `.venv/Scripts/python.exe -m pytest tests/test_provider.py tests/test_provider_api.py tests/test_lifespan.py tests/test_generation.py -q --tb=short` → **9 failed, 64 passed in 13.88s**.

Minimal fixes:

- Normalize only these two observed SDK shape exception types at the adapter invocation boundary to the existing retryable `ValueError`; independent business schema validation stays outside that handler. Authentication errors keep their nonretryable classification and the total budget remains 45 seconds.
- Add provider `aclose()` and an application lifespan `finally` that closes only a provider the app created. The provider closes its internally created sync SDK client and its own async client; a borrowed async HTTP client is preserved.
- Append one brief strict JSON/schema correction message on retries, retaining the original prompt and never including malformed output or secrets.

Focused GREEN, same expanded command: **73 passed in 10.66s**.

Full command after envelope/lifecycle review: `.venv/Scripts/python.exe -m pytest --cov=app --cov-branch --cov-report=term-missing` → **170 passed in 20.49s**, no warnings or failures.

```text
TOTAL                        422      0     90      0   100%
============================ 170 passed in 20.49s =============================
```

All application modules retain 100% statement/branch coverage. No `.env` inspection/overwrite, QA-server operation or paid request was performed.

## Cycle 8 — live-script lifespan and launch documentation alignment

The in-process live script used `httpx.ASGITransport`, which does not drive FastAPI lifespan itself. Added script-entry regressions using real app-owned SDK clients and a substituted acceptance callback that performs no network requests. Both successful and exceptional acceptance exits must close the SDK clients.

RED: `.venv/Scripts/python.exe -m pytest tests/test_live_acceptance.py -q --tb=short` → **2 failed, 3 passed in 5.95s**. Both new cases returned from the entrypoint with internally owned clients still open.

Minimal fix wraps the script's HTTP client and acceptance operation in `app.router.lifespan_context(app)`. The existing application `finally` now closes clients before the script returns on either path. No generation logic or paid-call defaults changed.

Focused GREEN: `.venv/Scripts/python.exe -m pytest tests/test_live_acceptance.py tests/test_lifespan.py -q --tb=short` → **11 passed in 5.65s**.

Aligned backend README startup with the actual stack: Uvicorn on `127.0.0.1:8000`; Taro Webpack5 H5 on `localhost:10086` calls that backend directly with `Taro.request`.

Full command after script-lifespan review: `.venv/Scripts/python.exe -m pytest --cov=app --cov-branch --cov-report=term-missing` → **172 passed in 13.33s**, no warnings or failures.

```text
TOTAL                        422      0     90      0   100%
============================ 172 passed in 13.33s =============================
```

The script entrypoint tests use an explicit dummy Key and substitute only the acceptance operation, so they exercise actual app lifecycle cleanup without making a paid model request. This worker did not inspect `.env` or run the live CLI against the user's Key; real ten-group acceptance is reserved for the root agent's authorized run.

## Cycle 9 — observed live difficulty mismatch and successful real acceptance

Read the prior `backend/.qa/live-observed.log`: the first quiz/report passed, and the second quiz returned two callback `ValueError`s. The earlier default-sandbox diagnostic only returned a normalized `ProviderFailure`; it did not rule out restricted local network access and was not evidence of a model response.

An explicitly authorized, one-call diagnostic was then run with `sandbox_permissions="require_escalated"`, using Settings to load the user Key without inspecting the Key file or printing secrets. Safe metadata was persisted in `.qa/quiz-diagnostic.json`:

```json
{"public_topic":"Python 字典","requested_count":4,"requested_difficulty":"medium","schema_valid":true,"actual_count":4,"actual_types":["single","single","multiple","judge"],"actual_difficulties":["easy","medium","medium","hard"],"rejection_reasons":["question_difficulty_mismatch"]}
```

The schema, count and distribution were valid; the model interpreted the prompt's target difficulty as an average over mixed questions. The product contract requires every question to match a non-mixed request. The strict validator was correct and remains unchanged.

RED: `.venv/Scripts/python.exe -m pytest tests/test_generation.py tests/test_live_acceptance.py -q --tb=short` → **6 failed, 25 passed in 8.83s**. New cases require explicit per-question instructions for easy/medium/hard, preserve rejection of the observed mixed output with safe diagnostics, and require persistent stage progress for acceptance success/failure.

Additional diagnostic RED: `.venv/Scripts/python.exe -m pytest tests/test_generation.py -q -k 'schema_rejection_logs' --tb=short` → **1 failed, 26 deselected in 9.57s**, proving schema failures lacked safe field locations.

Minimal changes clarify that non-mixed difficulty applies to each question and its `difficulty` field, never the quiz average. No output coercion or validation relaxation was added. Rejections now log count/type/difficulty metadata or Pydantic loc/type/msg without input/context. The live CLI writes each stage to JSONL, stops at failure and records the failed group/stage/code. `.qa/` files are ignored by Git.

Focused GREEN: `.venv/Scripts/python.exe -m pytest tests/test_generation.py tests/test_live_acceptance.py -q --tb=short` → **32 passed in 9.04s**.

Real acceptance, authorized elevated network execution:

```text
python -u scripts/live_acceptance.py --run-live --progress-log .qa/live-verified-progress.jsonl
exit code: 0
run_id: 2026-10-25T13:11:45.855461+00:00
completed_at: 2026-10-25T13:12:44.465489+00:00
10 quizzes passed, 10 reports passed, 0 failed events
```

| Group | Questions | Difficulty | Quiz seconds | Report seconds |
| --- | --- | --- | --- | --- |
| 1 | 3 | easy | 2.828 | 2.735 |
| 2 | 4 | medium | 3.531 | 2.500 |
| 3 | 5 | hard | 4.859 | 2.641 |
| 4 | 3 | mixed | 2.687 | 2.016 |
| 5 | 4 | easy | 2.781 | 2.078 |
| 6 | 5 | medium | 3.500 | 2.203 |
| 7 | 3 | hard | 3.500 | 2.453 |
| 8 | 4 | mixed | 3.375 | 2.828 |
| 9 | 5 | easy | 3.719 | 2.781 |
| 10 | 3 | medium | 3.047 | 2.516 |

The previously failing second case now returned four medium questions with the exact required distribution. Every group passed strict schema/count/difficulty checks and deterministic report-statistic comparison. No generation rejection/retry was logged during the successful batch. Progress and result records are preserved in `.qa/live-verified-progress.jsonl`, `.qa/live-verified.log` and `.qa/live-summary.json`; only safe metadata is stored, with no raw model responses or Key material.

Full command after real-difficulty acceptance: `.venv/Scripts/python.exe -m pytest --cov=app --cov-branch --cov-report=term-missing` → **177 passed in 17.16s**, no warnings or failures.

```text
TOTAL                        429      0     92      0   100%
============================ 177 passed in 17.16s =============================
```

`.venv/Scripts/python.exe -m pip check` → `No broken requirements found.` No frontend/root-document changes, account changes, recharge, commit, push or deployment were performed.

## Cycle 10 — diagnostic privacy and every-stage terminal progress

Independent review reproduced a privacy gap: Pydantic `extra_forbidden` error locations contain the unknown JSON key itself, so printing loc/type/msg could copy learning material into logs. It also reproduced missing terminal progress when a successful HTTP/code response contained schema-invalid data or failed later checks.

RED: `.venv/Scripts/python.exe -m pytest tests/test_generation.py tests/test_live_acceptance.py -q --tb=short` → **17 failed, 31 passed in 18.47s**. Regressions cover unknown keys at root/nested paths, custom error types/messages, and quiz/report JSON, schema, envelope, transport timeout and latency failures, plus quiz count/difficulty and report-statistic mismatch. The latter 13 cases all ended with only a `started` event.

Minimal privacy fix logs only an allowlist of fixed schema error types. Unknown types become the fixed `validation_error` category. No loc, message, input or context is logged; tests prove private unknown-key text and custom error text never appear.

The script now shares a small stage context manager that writes a safe `failed` event with run/group/stage, fixed reason and elapsed time before rethrowing the original exception. It covers HTTP/business-code errors and every later validation/check path. Numeric response codes may be recorded; untrusted nonnumeric codes are omitted. Success and failure metadata contain no exception message or raw response.

Focused GREEN: same focused command → **48 passed in 7.41s**. The non-HTTP failure cases also assert the specific original exception type is propagated and that the script stops immediately at the failing stage.

Final full command: `.venv/Scripts/python.exe -m pytest --cov=app --cov-branch --cov-report=term-missing` → **193 passed in 19.11s**, no warnings or failures.

```text
TOTAL                        430      0     92      0   100%
============================ 193 passed in 19.11s =============================
```

`.venv/Scripts/python.exe -m pip check` → `No broken requirements found.` The successful real ten-group evidence from Cycle 9 is preserved; this diagnostic-only increment used no paid requests and did not touch `.env`, frontend or root files.

## Practical limits

- Real DeepSeek access, structure, workflow, report statistics and live latency passed the ten-group acceptance above. The generated questions have not received an independent teaching-fact audit; account pricing and usage costs were not examined.
- Statistical authority is relative to the complete questions submitted by the client. Without a database or signed quiz storage this MVP cannot establish that a client has not edited those questions; it is not a tamper-proof grading service.
- The limiter is bounded and process-local. Run one worker for this MVP; multiple workers/instances do not share counters.
- Content checks use configurable exact terms plus model instructions, not comprehensive semantic moderation.
- `--cov=app` covers application modules; optional script behavior is tested separately by `test_live_acceptance.py`.
