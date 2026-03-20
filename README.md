# Equational Theories Playground

**README**

---

## Overview

This playground is an interactive evaluation environment for testing heuristics and Language Models on **Equational Theories** implication problems. It allows you to test models against `.jsonl` datasets containing equational implication problems, providing live accuracy tracking, an interactive visual interface, a full history log, and token/cost estimations.

---

## Features

- **Batch Evaluation:** Test multiple problems in parallel with configurable concurrency.
- **Live User Interface:** Track processing progress, accuracy, and see individual problem evaluation results.
- **Advanced Metrics:** View True Positives (TP), True Negatives (TN), False Positives (FP), and False Negatives (FN) for deep performance insights.
- **Custom Problems:** Inject your own custom equations and expected truth values directly from the UI.
- **Dynamic Prompt System:** Fully customize the System Prompt directly from the sidebar. You can map `{equation1}`, `{equation2}`, and `{cheatsheet}` parameters exactly where you need them for custom prompting strategies.
- **Dynamic Filtering:** Filter the problem set by difficulty or by ground truth (`TRUE` or `FALSE`).
- **Savable Cheatsheets & API Keys:** Manage multiple iterations of prompts and securely store your API keys across multiple providers via Local Storage securely inside your browser. Built-in expandable window for easier cheatsheet editing.
- **Token & Cost Estimator:** Real-time visibility into your test run's cost dynamically estimated via usage reporting.

---

## Dataset Format

This playground expects datasets in **JSONL** format.
Each line must be a JSON object containing:

- `id`: Problem ID string (e.g. `"normal_0001"`)
- `index`: Numeric problem index
- `difficulty`: string (e.g. `"normal"` or `"hard"`)
- `equation1`: Hypothesis equation (LHS of implication)
- `equation2`: Conclusion equation to test
- `answer`: Boolean ground truth (`true` or `false`)

**Example line:**
```json
{"id": "normal_0001", "index": 1, "difficulty": "normal", "equation1": "x = ((y * (x * y)) * z) * w", "equation2": "x = (y * (x * z)) * (y * w)", "answer": true}
```

---

## Prompt Construction

For each problem, the base template is built around the internal `official1` structure. You can edit this directly in your sidebar to inject equations anywhere or instruct your chosen model to behave completely differently.

**Usage Tags:**
* `{equation1}` - injects the hypothesis equation
* `{equation2}` - injects the conclusion equation test case
* `{cheatsheet}` - injects the full string contents of the Cheatsheet text field

---

## Evaluation Models

Supported API providers (Direct via Browser):
- **xAI**: Grok 3, Grok 3 Mini, Grok 4 Fast
- **OpenAI**: GPT-4o, GPT-4o-mini, o3-mini, gpt-oss-120b
- **Meta** (via Together AI): Llama 3.3 70B Instruct, Llama 3.1 8B Instruct Turbo
- **Google**: Gemini 2.5 Pro, Gemini 2.0 Pro Exp 0205, Gemini 2.0 Flash Thinking Exp, Gemini 2.0 Flash Lite, Gemini 2.0 Flash, Gemini 3.1 Flash Lite Preview
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Haiku, Claude Opus 4.5, Claude Sonnet 4.5

*All API keys and Cheatsheets are stored securely only inside your browser's Local Storage.*

---

## How it works

1. **Import Problems:** Select a dataset formatted as a `.jsonl` file.
2. **Add Context:** Paste heuristics or rules into the Cheatsheet text area to enrich the prompt context.
3. **Configure Settings:** Input your API Key, select the target Model, and set maximum parallel executions.
 4. **Evaluate:** Press **Run** and watch the results dynamically populate. The evaluator extracts the `VERDICT` output to match against expected true/false answers.
