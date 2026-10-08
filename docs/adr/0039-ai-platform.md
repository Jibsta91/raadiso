# 0039 — AI platform: LiteLLM as the one gateway, an LLM mock by default, local models by profile

- Status: Accepted
- Date: 2026-10-08

## Context

Phase 4 adds four AI pillars (roadmap): scam and spam scoring, semantic search and similar listings,
message safety, governance (GDPR for AI data, guardrails, review queues). Every one of them needs language
models. Three needs pull against each other:

- **Tests must stay deterministic and offline:** smoke, e2e and CI can't download gigabytes of model weights
  or depend on what a model happens to say.
- **The laptop budget** (ADR-0011): the default stack measured 7.4 GiB before this ADR, above the table's
  ≈ 6.8 GB, and a 4B model needs 3–4 GB more.
- **Licences and supply chain** (ADR-0009): models and AI tools must be free and run offline. LiteLLM's
  PyPI packages 1.82.7 and 1.82.8 were compromised in March 2026.

## Decision

- **One gateway: the LiteLLM proxy** (MIT outside its `enterprise/` directory, which needs a key we don't
  use). Services call two aliases, `raadi-chat` and `raadi-embed`, never a model by name. Which model
  answers is configuration (`RAADI_CHAT_MODEL`, `RAADI_CHAT_API_BASE` and the same for embeddings), so
  swapping the mock for a local model, or one model for another, changes no code.
  - It runs from the official **non-root image pinned by digest**, never from PyPI.
  - It runs offline: the model price list comes from the image, and LiteLLM's telemetry is off.
  - **Traces go to our OpenTelemetry collector without prompts or answers** (`turn_off_message_logging`);
    those may hold personal data. Checked: the prompt text appears in no trace.
  - A master key (secrets-init, prefixed `sk-`) guards it; services get it like any other secret. Later
    slices give each AI service its own key.
- **An LLM mock in the default stack** (`services/llm-mock`, like the payments and push mocks):
  OpenAI-compatible chat (also streamed), embeddings and model list, all deterministic.
  - Embeddings are hashed bags of words in bge-m3's 1024 dimensions, so similar texts are close.
  - Tests pick failures with `x-mock-scenario` or a `[[mock:…]]` marker in the prompt: timeout, error,
    malformed JSON, refusal. Prompt-injection phrases get a refusal.
  - `GET /_mock/requests` shows what reached "the model", for tests that check personal data never does.
  - Smoke and e2e test AI features against it, with no download.
- **Local models under `--profile ai`:** Ollama serving **Qwen3 4B** (Apache-2.0) for chat and **bge-m3**
  (MIT, multilingual including Somali) for embeddings, both pinned. They're switched in behind the same
  aliases. This needs Docker with 12 GB or more.
- **Langfuse and MLflow under `--profile full`:** LLM traces and evaluations (Langfuse, MIT outside `ee/`)
  and experiment tracking and model registry (MLflow, Apache-2.0). They're heavy (ClickHouse alone is
  about 1 GB), so they're not in the default stack.
- **Rules for every AI slice that follows:**
  - No prompt or answer in logs, traces or events.
  - Every AI decision is stored with its model, version and reasons.
  - AI only flags or scores, and a person decides (GDPR Art. 22, DSA).
  - Each feature degrades to "unscored" when the model is down.
  - Evaluation sets come per language (Somali, English, Norwegian).

## Alternatives considered

- **Calling Ollama directly from services:** fewer moving parts, but every service would handle models,
  retries and tracing itself, and switching the mock or a model would mean code changes.
- **LiteLLM as a Python library inside each AI service:** no extra container, but the PyPI supply-chain
  risk lands in every service, and there's no single place for keys, limits and tracing.
- **vLLM instead of Ollama:** faster, but needs a GPU; the laptop and a small server are CPU-only.
- **Only real models in tests:** realistic, but slow, non-deterministic and a multi-GB download for every
  test run.
- **Smaller models (Qwen3 1.7B, nomic-embed-text):** lighter, but clearly weaker, especially in Somali, our
  first market's language (ADR-0033).

## Consequences

- **Memory:** the default stack grows by about 0.6 GB (LiteLLM ≈ 550 MB, the mock ≈ 70 MB). Measured with
  GlitchTip after an e2e run: 8.6 GiB across 43 containers (`docker stats`, file cache included).
  That's over the old budget, so ADR-0011's table gets a new row, and freeing about 1 GB (merging the mocks,
  a lighter ClamAV setup for laptops) becomes a Phase 4 task.
- LiteLLM's image is 2.8 GB on disk.
- `--profile ai` adds Ollama, about 3–4 GB with Qwen3 4B loaded. `--profile full` adds Langfuse with
  ClickHouse and MLflow, about 2–3 GB.
- The first `--profile ai` start downloads the models (about 3.6 GB), which needs the internet once.
- Somali quality of Qwen3 4B and bge-m3 is not proven: the first AI slice measures it with its evaluation
  sets before anything depends on it.
