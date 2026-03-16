# Technical Specification

**Equational Theories Playground — Independent Implementation**  
Version 1.0 · 2026-03-16

---

## 1. Problem Domain

The task is **equational implication over magmas**. A magma is an algebraic structure consisting of a set `M` and a single binary operation `* : M × M → M` with no additional axioms. An equational law is a universally quantified identity of the form `t1(x,y,...) = t2(x,y,...)` where `t1`, `t2` are terms built from variables and `*`.

> **Definition.** Law `E1` *implies* law `E2` (written `E1 → E2`) if and only if every magma satisfying `E1` also satisfies `E2`.

The 4,694 laws in this project each involve at most four applications of `*` and variables drawn from `{x, y, z, w, u, v}`. The full implication graph contains over **22 million** verified true/false judgments established by the Equational Theories Project using Lean 4 formalization and automated theorem provers.

---

## 2. Data Specification

**File:** `all_problems.csv`

| Statistic | Value |
|---|---|
| Total problems | 1,200 |
| Normal difficulty | 1,000 |
| Hard difficulty | 200 |
| Ground truth provided | None (unlabeled public set) |
| Variables used | x, y, z, w, u, v |
| Max operations | 4 applications of `*` |
| Encoding | UTF-8 CSV, comma-separated |

### Sample Problems

| # | Eq1 | Eq2 | Difficulty |
|---|---|---|---|
| 1 | `x = ((y * (x * y)) * z) * w` | `x = (y * (x * z)) * (y * w)` | normal |
| 2 | `x * y = z * (w * (u * u))` | `x * (y * y) = (z * w) * z` | normal |
| 3 | `x = x * (y * ((z * x) * x))` | `x = (y * ((z * z) * y)) * w` | normal |
| 4 | `x = y * (z * ((w * u) * u))` | `x = ((y * z) * x) * (x * w)` | normal |
| 5 | `x = y * ((x * z) * (w * u))` | `x = (((x * x) * x) * x) * x` | normal |

---

## 3. Prompt Specification

Each model receives a single user-turn prompt. **No system prompt is used.** The prompt format is fixed; the cheatsheet is prepended verbatim when provided.

### Prompt Template (with cheatsheet)

```
=== CHEATSHEET START ===
{cheatsheet_content}
=== CHEATSHEET END ===

You are solving equational implication problems
about magmas (sets with a binary operation *).

PROBLEM: Does Equation 1 imply Equation 2?
Equation 1: {eq1}
Equation 2: {eq2}

A law E1 implies law E2 if every magma satisfying
E1 also satisfies E2.

Reason step by step, then end your response with
exactly: ANSWER: TRUE or ANSWER: FALSE
```

**Answer extraction regex:** `ANSWER:\s*(TRUE|FALSE)` *(case-insensitive, last match wins)*

**Fallback:** If no match is found, the response is treated as incorrect for scoring purposes.

---

## 4. Model Specification

The following four models constitute the official evaluation suite for Stage 1. This playground routes to each model via the respective provider API.

| Provider | Model ID | Context | Cost Tier |
|---|---|---|---|
| xAI | `grok-4-fast` | 128k | Low |
| OpenAI | `gpt-oss-120b` | 128k | Medium |
| Meta | `meta-llama/Llama-3.3-70B-Instruct` | 128k | Low |
| Google | `gemini-3.1-flash-lite-preview` | 1M | Very low |

- **Recommended cost budget:** ≤ USD 0.01 per problem
- **Time limit:** ≤ 10 minutes per problem
- **Evaluation setting:** No-tools (no web search, no code execution, no external retrieval). All reasoning must occur within a single forward pass.

---

## 5. Scoring Specification

**Metric:** Simple accuracy — fraction of problems answered correctly.

**Baseline:** Random guessing yields ~50% (evaluation set is balanced 50/50).

**Target:** Stage 1 cheatsheets have been observed to push cheap models to 55–60%+. Top submissions are expected to do better.

| Score Range | Interpretation |
|---|---|
| < 50% | Worse than random — cheatsheet is actively harmful |
| 50–52% | Approximately random — cheatsheet has no effect |
| 53–58% | Modest improvement — cheatsheet is helping |
| 59–65% | Good — competitive submission range |
| > 65% | Excellent — strong cheatsheet content |

---

## 6. Cheatsheet Specification

**Format:** Plain UTF-8 text. No binary formats, no markup.

**Size limit:** 10,240 bytes (10 KB) as measured by `len(cheatsheet.encode('utf-8'))`.

### Content Guidance *(not enforced, but effective cheatsheets typically include)*

- Fundamental implication facts (trivial law, singleton law, transitivity)
- Structural heuristics: variable count, symmetry, idempotency checks
- Known families: left-zero, right-zero, commutative, associative, group-like
- Small counterexample construction strategies (2–4 element magmas)
- Rewriting strategies for proving implications step by step
- Duality: `E(x,y)` implies `E'(x,y)` iff `E^op(x,y)` implies `E'^op(x,y)`

### Anti-Patterns to Avoid

- Lists of specific law IDs (E1...E4694) without explanation — models cannot memorize 4,694 entries
- Content that increases verbosity without adding reasoning guidance
- Instructions that contradict each other or confuse the model

---

## 7. Playground Architecture

The independent playground is a multi-file web application. The architecture is:

| Component | Implementation |
|---|---|
| UI | Separated `index.html`, `styles.css`, `script.js` |
| API routing | Direct `fetch()` to provider APIs from the browser |
| Parallelism | Configurable (1–5 concurrent requests) |
| Result storage | In-memory JS state; export to CSV |
| Problem source | `all_problems.csv` (1,200 problems, local) |
| Cheatsheet | Plain textarea, byte-counted in real time |

---

## 8. Mathematical Background

### Magma Laws in This Dataset

Each law is an equation of the form `t1 = t2` where both sides are terms built from variables and at most 4 applications of `*`. Notable special cases:

| Equation | Name / Significance |
|---|---|
| `x = x` | E1: trivial law, implied by everything |
| `x = y` | E2: singleton law, implies everything |
| `x = x * x` | E3: idempotent-like |
| `x = x * y` | E4: left-absorbing |
| `x * y = y * x` | Commutativity |
| `x * (y * z) = (x * y) * z` | Associativity (group axiom) |
| `x * (y * z) = (z * w) * w` | ETP example — hard instance |

### Proving Implication (TRUE)

The standard approach is **term rewriting**: use `E1` as a rewrite rule (in both directions) and apply it repeatedly to the LHS or RHS of `E2` until both sides match. This is decidable for ground terms but undecidable in general for equational logic *(Tarski 1953)*.

### Disproving Implication (FALSE)

Construct a finite magma `M` satisfying `E1` and find elements `a, b, ... ∈ M` such that `E2(a,b,...)` fails. Two- and three-element magmas suffice for the majority of FALSE instances in this dataset.

### Hardness

The 200 hard problems are specifically selected to resist simple heuristics: they are not resolvable by variable-count arguments, constant magma counterexamples, or single-step rewriting.

---

## 9. Evaluation Prompt

Below is a reference Jinja2 evaluation prompt. The final evaluation prompt may include minor adjustments. Jinja2 is a template engine that fills variables (such as equations and cheatsheet text) into a reusable prompt template; official documentation: https://jinja.palletsprojects.com/.

```
You are a mathematician specializing in equational theories of magmas. 
Your task is to determine whether Equation 1 ({{ equation1 }}) implies Equation 2 ({{ equation2 }}) over all magmas.
{% if cheatsheet is defined and cheatsheet %}
{{ cheatsheet }}
{% endif %}
Output format (use exact headers without any additional text or formatting):
VERDICT: must be exactly TRUE or FALSE (in the same line).
REASONING: must be non-empty.
PROOF: required if VERDICT is TRUE, empty otherwise.
COUNTEREXAMPLE: required if VERDICT is FALSE, empty otherwise.
```
 

*This specification describes the independent playground implementation. The official competition rules at [competition.sair.foundation](https://competition.sair.foundation) take precedence for submission and scoring purposes. Organized by Damek Davis and Terence Tao, hosted by the SAIR Foundation.*
