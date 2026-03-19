# Technical Specification

**Equational Theories Playground**  
Version 1.1.3

---

## 1. Problem Domain

The task is **equational implication over magmas**. A magma is an algebraic structure consisting of a set `M` and a single binary operation `* : M × M → M` with no additional axioms. An equational law is a universally quantified identity of the form `t1(x,y,...) = t2(x,y,...)` where `t1`, `t2` are terms built from variables and `*`.

> **Definition.** Law `E1` *implies* law `E2` (written `E1 → E2`) if and only if every magma satisfying `E1` also satisfies `E2`.

The 4,694 laws in this project each involve at most four applications of `*` and variables drawn from `{x, y, z, w, u, v}`. The full implication graph contains over **22 million** verified true/false judgments established by the Equational Theories Project using Lean 4 formalization and automated theorem provers.

---

## 2. Data Specification

**Format:** `.jsonl` (JSON Lines)

Each line must represent a single JSON object.

### Schema Fields
| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `index` | number | Display index |
| `difficulty` | string | `"normal"`, `"hard"`, or custom |
| `equation1` | string | Hypothesis equation |
| `equation2` | string | Conclusion equation |
| `answer` | boolean | Ground truth (`true` or `false`) |

### Sample entry
```json
{"id": "normal_0001", "index": 1, "difficulty": "normal", "equation1": "x = ((y * (x * y)) * z) * w", "equation2": "x = (y * (x * z)) * (y * w)", "answer": true}
```

---

## 3. Prompt Specification

Below is the standard prompt configuration used to interact with LLMs.

```
You are a mathematician specializing in equational theories of magmas. Your task is to determine whether Equation 1 ({{ equation1 }}) implies Equation 2 ({{ equation2 }}) over all magmas.

[ CHEATSHEET TEXT PLACED HERE IF PROVIDED AND ENABLED ]

Output format (use exact headers without any additional text or formatting):
VERDICT: must be exactly TRUE or FALSE (in the same line).
REASONING: must be non-empty.
PROOF: required if VERDICT is TRUE, empty otherwise.
COUNTEREXAMPLE: required if VERDICT is FALSE, empty otherwise.
```

**Fallback:** If no exactly matching `VERDICT: TRUE` or `VERDICT: FALSE` string is detected in the response string, the response score evaluates to incomplete ("NO ANSWER"). 

---

## 4. Model Capabilities & Metadata

The playground talks directly to LLM provider APIs (Anthropic, Meta/Together, OpenAI, Google, xAI) right from the browser window using standard CORS endpoint fetching. There is no intermediate proxy or server.

The app supports metadata capture by grabbing output `usage` objects in responses to measure and display input tokens and runtime duration. Costs are continuously summed using approximations of known provider model billing parameters (USD).

All keys are securely contained inside the `eq-api-keys` context on your `localStorage`.

### Model Implementations Provided
- xAI: `grok-4-fast`, `grok-3`, `grok-3-mini`
- OpenAI: `gpt-4o`, `gpt-4o-mini`, `o3-mini`, `gpt-oss-120b`
- Meta: `meta-llama/Llama-3.3-70B-Instruct`, `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo`
- Google: `gemini-2.0-flash-lite`, `gemini-3.1-flash-lite-preview`, `gemini-2.0-flash`
- Anthropic: `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`

---

## 5. Scoring Specification

**Metric:** Accuracy (correct answers divided by total answerable answers).

---

## 6. Cheatsheet Specification

**Format:** Plain UTF-8 text.
**Size limit:** Max 10,240 bytes (truncated programmatically if exceeded when the API run initiates).

### Content Guidance *(useful starting concepts)*
- Fundamental implication facts (trivial law, singleton law, transitivity)
- Structural heuristics: variable count, symmetry, idempotency checks
- Known algebraic groupings: left-zero, right-zero, commutative, associative, group-like
- Methods to build up finite counterexamples over 2-4 variables
- Rewriting instructions

### Anti-Patterns to Avoid
- Submitting thousands of predefined laws inline (poor token density vs effectiveness)
- Including self-conflicting instructions
- Extremely obscure instructions that overshadow the standard equations

---

## 7. Mathematical Background

### Magma Laws

| Equation | Name / Significance |
|---|---|
| `x = x` | E1: trivial law, implied by everything |
| `x = y` | E2: singleton law, implies everything |
| `x = x * x` | E3: idempotent-like |
| `x = x * y` | E4: left-absorbing |
| `x * y = y * x` | Commutativity |
| `x * (y * z) = (x * y) * z` | Associativity (group axiom) |

### Proving Implication (`TRUE`)
Standard term rewriting and transitivity techniques apply in algebraic systems like magmas.

### Disproving Implication (`FALSE`)
Construct a finite magma (usually small, 2-to-3 element domains) satisfying `E1` but failing to satisfy `E2` for at least one case constraint.

---

*This specification applies to the independent playground application. Based on research from the Equational Theories Project.*
