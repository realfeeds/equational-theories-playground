# Equational Theories Playground

**README** · Mathematics Distillation Challenge · Stage 1 · Generated 2026-03-16

---

## Overview

This playground is an independent re-implementation of the official SAIR Foundation evaluation environment for the **Mathematics Distillation Challenge — Equational Theories, Stage 1**. It lets you test cheatsheets against the 1,200 public training problems using the same four evaluation models as the official leaderboard, with no token budget constraints.

---

## Why an Independent Playground?

The official playground at `playground.sair.foundation` is limited in the number of API calls participants can make during testing. This independent version:

- Removes per-session token limits so you can run full batch evaluations
- Supports all four official evaluation models in a single interface
- Stores results locally for comparison across cheatsheet versions
- Includes the full 1,200-problem public training set (`all_problems.csv`)
- Shows live accuracy metrics as problems are evaluated in parallel

---

## Dataset

The included `all_problems.csv` contains the 1,200 public training problems released by the competition organizers:

| Field | Type | Description |
|---|---|---|
| `eq1` | string | Hypothesis equation (LHS of implication) |
| `eq2` | string | Conclusion equation to test |
| `difficulty` | `normal` \| `hard` | 1,000 normal + 200 hard problems |
| `ground_truth` | `TRUE` \| `FALSE` \| *(blank)* | Not provided in public set |

---

## Evaluation Models

These are the four models used in the official Stage 1 leaderboard evaluation. This playground supports all of them:

| Provider | Model | Notes |
|---|---|---|
| xAI | Grok 4.1 Fast | Fast inference, strong reasoning |
| OpenAI | gpt-oss-120b | Open-weight 120B parameter model |
| Meta | Llama 3.3 70B Instruct | Open-source, widely benchmarked |
| Google | Gemini 3.1 Flash Lite Preview | Low-cost, fast throughput |

---

## How It Works

**Prompt construction.** For each problem, a prompt is built as:

```
[CHEATSHEET — if provided]

You are solving equational implication problems about magmas.

PROBLEM: Does Equation 1 imply Equation 2?
Equation 1: {eq1}
Equation 2: {eq2}

Reason step by step, then end with exactly:
ANSWER: TRUE or ANSWER: FALSE
```

**Answer extraction.** The model response is parsed for the final `ANSWER: TRUE` or `ANSWER: FALSE` token. Responses without a parseable answer are counted as incorrect.

**Scoring.** The evaluation set is balanced (50% TRUE, 50% FALSE). A random baseline achieves ~50% accuracy. The goal is to push cheap models above 60%, ideally higher.

---

## Cheatsheet Rules

- Maximum size: **10,240 bytes (10 KB)**
- Plain text only — no code execution, no external lookups
- One cheatsheet per submission; one submission per team
- Evaluated in a no-tools setting (no web search, no calculators)
- Stage 1 cheatsheets may be made public after the April 20 deadline

---

## Key Dates

| Event | Date |
|---|---|
| Stage 1 opens | March 14, 2026 |
| Submission deadline | April 20, 2026 (AoE) |
| Leaderboard release | On or before April 30, 2026 |
| Stage 2 begins | May 1, 2026 |
| Evaluation model list final | On or before April 10, 2026 |

---

## Links

- **Competition:** [competition.sair.foundation/competitions/mathematics-distillation-challenge-equational-theories-stage1](https://competition.sair.foundation/competitions/mathematics-distillation-challenge-equational-theories-stage1)
- **Official playground:** [playground.sair.foundation](https://playground.sair.foundation)
- **Equational Theories Project:** [github.com/teorth/equational_theories](https://github.com/teorth/equational_theories)
- **Zulip community:** [zulip.sair.foundation](https://zulip.sair.foundation)
- **Terence Tao's blog post:** [terrytao.wordpress.com](https://terrytao.wordpress.com)
