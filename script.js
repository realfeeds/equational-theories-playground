/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EQUATIONAL THEORIES PLAYGROUND — script.js
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS FILE DOES (big picture)
 * ──────────────────────────────────
 *  1.  Provider / Model catalogue        — knows which URL and auth header
 *                                          each provider (OpenAI, Anthropic,
 *                                          xAI, Google, Meta) needs.
 *  2.  UI wiring                         — connects every button, slider, and
 *                                          textarea to a handler function.
 *  3.  CSV parsing                       — reads the problems file and builds
 *                                          an in-memory array of problem objects.
 *  4.  Prompt builder                    — prepends the cheatsheet (if enabled)
 *                                          and appends the fixed instruction
 *                                          block for every problem.
 *  5.  API caller                        — sends the prompt via fetch() and
 *                                          handles streaming / non-streaming
 *                                          responses.
 *  6.  Answer extractor                  — finds the last ANSWER: TRUE/FALSE
 *                                          in the model's response using regex.
 *  7.  Batch runner with parallelism     — a pool that keeps N requests in
 *                                          flight at once (configurable 1–5).
 *  8.  Live metrics updater              — recomputes and renders accuracy
 *                                          after each result arrives.
 *  9.  Results table renderer            — adds/updates one DOM row per problem.
 * 10.  CSV exporter                      — serialises in-memory results to a
 *                                          downloadable .csv file.
 *
 * HOW TO READ THIS FILE (for beginners)
 * ─────────────────────────────────────
 *  • Each major section is marked with a large header comment (═══).
 *  • Every function has a "WHAT / WHY / HOW" header comment.
 *  • Key design decisions are explained inline with //── comments.
 *
 * DEPENDENCIES
 * ─────────────
 *  None. Vanilla JS only. No npm, no bundler, no libraries.
 *  The file runs in any modern browser (Chrome 90+, Firefox 88+, Edge 90+).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';   // strict mode: catches common bugs like undeclared variables


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1: CONSTANTS & CONFIGURATION
   ═══════════════════════════════════════════════════════════════════════════

   These values never change at runtime. Grouping them here makes them easy
   to find and update.
*/

/** Maximum cheatsheet size in bytes (enforced by spec). */
const MAX_CHEATSHEET_BYTES = 10_240;

/**
 * PROVIDER_CATALOGUE
 * ──────────────────
 * Describes every supported LLM provider:
 *   id       — the <option value> used in the HTML select
 *   name     — human-readable label
 *   baseUrl  — the API endpoint (messages/completions-style)
 *   authHeader(key) — function that returns the correct Authorization header
 *   models   — array of { id, label } objects for the model select
 *   buildBody(model, messages, maxTokens)
 *            — function that returns the JSON request body
 *   extractText(json)
 *            — function that plucks the text content from the response JSON
 *
 * WHY A CATALOGUE?  Different providers use different field names
 * (choices[0].message.content vs candidates[0].content.parts[0].text, etc.).
 * This table isolates all of that per-provider knowledge in one place.
 */
const PROVIDER_CATALOGUE = {

  // ── OpenAI / OpenAI-compatible ────────────────────────────────────────
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    models: [
      { id: 'gpt-4o',              label: 'GPT-4o' },
      { id: 'gpt-4o-mini',         label: 'GPT-4o Mini' },
      { id: 'gpt-oss-120b',        label: 'gpt-oss-120b (Stage 1)' },
      { id: 'o3-mini',             label: 'o3-mini' },
      { id: 'gpt-4-turbo',         label: 'GPT-4 Turbo' },
    ],
    buildBody: (model, messages, maxTokens) => ({
      model,
      messages,
      max_completion_tokens: maxTokens,
    }),
    extractText: (json) => json?.choices?.[0]?.message?.content ?? '',
  },

  // ── Anthropic (Claude) ────────────────────────────────────────────────
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    authHeader: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    models: [
      { id: 'claude-opus-4-5',         label: 'Claude Opus 4.5' },
      { id: 'claude-sonnet-4-5',       label: 'Claude Sonnet 4.5' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
    ],
    buildBody: (model, messages, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages,
    }),
    extractText: (json) => {
      // Anthropic returns an array of content blocks
      const block = json?.content?.find?.(b => b.type === 'text');
      return block?.text ?? '';
    },
  },

  // ── xAI (Grok) ────────────────────────────────────────────────────────
  xai: {
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    models: [
      { id: 'grok-4-fast',  label: 'Grok 4 Fast (Stage 1)' },
      { id: 'grok-3',       label: 'Grok 3' },
      { id: 'grok-3-mini',  label: 'Grok 3 Mini' },
    ],
    buildBody: (model, messages, maxTokens) => ({
      model,
      messages,
      max_tokens: maxTokens,
    }),
    extractText: (json) => json?.choices?.[0]?.message?.content ?? '',
  },

  // ── Google (Gemini) ───────────────────────────────────────────────────
  google: {
    name: 'Google (Gemini)',
    // NOTE: API key is passed as a query parameter for Google
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    authHeader: (_key) => ({}),  // auth via ?key= param, not a header
    models: [
      { id: 'gemini-2.0-flash-lite',               label: 'Gemini 2.0 Flash Lite' },
      { id: 'gemini-3.1-flash-lite-preview',       label: 'Gemini 3.1 Flash Lite Preview (Stage 1)' },
      { id: 'gemini-2.0-flash',                    label: 'Gemini 2.0 Flash' },
    ],
    buildBody: (model, messages, maxTokens) => ({
      // Google uses a different message format
      contents: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    extractText: (json) =>
      json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
  },

  // ── Meta Llama (via Together AI) ─────────────────────────────────────
  meta: {
    name: 'Meta (via Together AI)',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B Instruct (Stage 1)' },
      { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', label: 'Llama 3.1 8B Instruct Turbo' },
    ],
    buildBody: (model, messages, maxTokens) => ({
      model,
      messages,
      max_tokens: maxTokens,
    }),
    extractText: (json) => json?.choices?.[0]?.message?.content ?? '',
  },
};

/**
 * SCORE_THRESHOLDS
 * ────────────────
 * Used to show an interpretation banner below the metrics.
 * Sorted descending so we can find the first threshold we beat.
 */
const SCORE_THRESHOLDS = [
  { min: 0.65, label: '> 65% — Excellent — strong cheatsheet content ✨',          cls: 'level-excel'  },
  { min: 0.59, label: '59–65% — Good — competitive submission range 📈',            cls: 'level-good'   },
  { min: 0.53, label: '53–58% — Modest improvement — cheatsheet is helping 📊',    cls: 'level-modest' },
  { min: 0.50, label: '50–52% — Random — cheatsheet has no measurable effect ─',   cls: 'level-random' },
  { min: 0,    label: '< 50% — Worse than random — cheatsheet may be harmful ⚠',  cls: 'level-below'  },
];

/**
 * ANSWER_REGEX
 * ────────────
 * Matches "ANSWER: TRUE" or "ANSWER: FALSE" (case-insensitive).
 * The `g` flag lets us call repeatedly to find the LAST match.
 * The `i` flag makes it case-insensitive.
 */
const ANSWER_REGEX = /ANSWER:\s*(TRUE|FALSE)/gi;


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2: APPLICATION STATE
   ═══════════════════════════════════════════════════════════════════════════

   All mutable data lives here. Keeping state in one place makes it easy to
   reason about what the app "knows" at any given moment.
*/

const state = {
  /** Array of problem objects: { eq1, eq2, difficulty, groundTruth } */
  problems: [],

  /**
   * Array of result objects, one per evaluated problem:
   * {
   *   problemIdx: number,     // index into state.problems
   *   eq1: string,
   *   eq2: string,
   *   difficulty: string,     // 'normal' or 'hard'
   *   groundTruth: string,    // 'TRUE', 'FALSE', or ''
   *   prediction: string,     // 'TRUE', 'FALSE', or 'NO_ANSWER'
   *   correct: boolean|null,  // null if no ground truth
   *   status: string,         // 'pending' | 'running' | 'done' | 'error' | 'skipped'
   *   rawResponse: string,    // full model text
   *   errorMsg: string,       // set when status === 'error'
   * }
   */
  results: [],

  /** Whether an evaluation run is currently in progress. */
  running: false,

  /**
   * AbortController lets us cancel all in-flight fetch() calls
   * when the user presses "Stop".
   */
  abortController: null,
};


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3: DOM REFERENCES
   ═══════════════════════════════════════════════════════════════════════════

   We grab every element we need once at startup and store it here.
   This is faster than calling document.getElementById('...') repeatedly,
   and keeps all element lookups in one place.
*/

const DOM = {};

/** Called once: populates the DOM object. */
function cacheDom() {
  const ids = [
    // API config
    'provider-select', 'model-select', 'api-key-input', 'toggle-key-btn',
    // Cheatsheet
    'cheatsheet-textarea', 'byte-count', 'byte-progress-fill', 'byte-warning',
    // Problems
    'drop-zone', 'csv-file-input', 'csv-textarea',
    'load-csv-btn', 'clear-problems-btn', 'problems-status',
    // Settings
    'range-from', 'range-to',
    'parallelism-slider', 'parallelism-value',
    'use-cheatsheet-toggle', 'max-tokens-input',
    'run-btn', 'stop-btn',
    'eval-progress-fill', 'eval-progress-label',
    // Status badge
    'status-badge', 'status-text',
    // Metrics
    'metric-overall-pct', 'metric-overall-frac', 'ring-overall',
    'metric-normal-pct',  'metric-normal-frac',  'ring-normal',
    'metric-hard-pct',    'metric-hard-frac',    'ring-hard',
    'score-banner', 'score-interpretation',
    // Results
    'results-tbody', 'results-empty', 'export-csv-btn',
  ];

  ids.forEach(id => {
    // Convert 'some-id' to camelCase key 'someId' for convenience
    const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    DOM[key] = document.getElementById(id);
  });
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4: UI WIRING — event listeners
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * wireUi()
 * ────────
 * Attaches all event listeners. Called once after the DOM is ready.
 * Separated from cacheDom() because "find elements" and "attach listeners"
 * are logically distinct steps.
 */
function wireUi() {

  // ── Provider select: repopulate model list on change ──
  DOM.providerSelect.addEventListener('change', () => {
    populateModelSelect(DOM.providerSelect.value);
  });

  // ── API key eye toggle ──
  DOM.toggleKeyBtn.addEventListener('click', () => {
    const inp = DOM.apiKeyInput;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // ── Cheatsheet: update byte counter on every keystroke ──
  DOM.cheatsheetTextarea.addEventListener('input', updateByteCounter);

  // ── Parallelism slider: update the displayed value ──
  DOM.parallelismSlider.addEventListener('input', () => {
    DOM.parallelismValue.textContent = DOM.parallelismSlider.value;
  });

  // ── CSV drop zone: keyboard activation (Enter / Space) ──
  DOM.dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      DOM.csvFileInput.click();
    }
  });

  // ── CSV drop zone: click to open file browser ──
  DOM.dropZone.addEventListener('click', (e) => {
    // Only if the click was on the zone itself, not on the hidden input
    if (e.target !== DOM.csvFileInput) {
      DOM.csvFileInput.click();
    }
  });

  // ── CSV file input: process selected file ──
  DOM.csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) readCsvFile(file);
  });

  // ── Drag-and-drop: visual highlight on dragover ──
  DOM.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.add('drag-over');
  });
  DOM.dropZone.addEventListener('dragleave', () => {
    DOM.dropZone.classList.remove('drag-over');
  });
  DOM.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files?.[0];
    if (file) readCsvFile(file);
  });

  // ── Parse CSV button (from pasted text) ──
  DOM.loadCsvBtn.addEventListener('click', () => {
    const text = DOM.csvTextarea.value.trim();
    if (!text) {
      showProblemsStatus('⚠ Paste CSV text first.', 'warn');
      return;
    }
    parseAndLoadCsv(text);
  });

  // ── Clear problems ──
  DOM.clearProblemsBtn.addEventListener('click', clearProblems);

  // ── Run button ──
  DOM.runBtn.addEventListener('click', startEvaluation);

  // ── Stop button ──
  DOM.stopBtn.addEventListener('click', stopEvaluation);

  // ── Export CSV ──
  DOM.exportCsvBtn.addEventListener('click', exportResultsCsv);
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5: INITIALISATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * init()
 * ──────
 * Entry point, called when the DOM is ready (via DOMContentLoaded).
 * Runs all one-time setup steps.
 */
function init() {
  cacheDom();
  wireUi();
  populateModelSelect(DOM.providerSelect.value);
  updateByteCounter();   // initialise byte counter to 0
}

// DOMContentLoaded fires when HTML is parsed and ready,
// but before images/fonts have loaded — perfect for our needs.
document.addEventListener('DOMContentLoaded', init);


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6: PROVIDER / MODEL SELECT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * populateModelSelect(providerId)
 * ────────────────────────────────
 * Clears the model <select> and refills it with the models for the
 * chosen provider.
 *
 * @param {string} providerId — key in PROVIDER_CATALOGUE
 */
function populateModelSelect(providerId) {
  const provider = PROVIDER_CATALOGUE[providerId];
  if (!provider) return;

  // Remove all existing <option> elements
  DOM.modelSelect.innerHTML = '';

  // Add one <option> per model
  provider.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    DOM.modelSelect.appendChild(opt);
  });
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 7: CHEATSHEET — BYTE COUNTER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * updateByteCounter()
 * ────────────────────
 * Computes the UTF-8 byte length of the cheatsheet textarea content,
 * updates the counter display and progress bar, and shows a warning
 * if the limit is exceeded.
 *
 * WHY TextEncoder?
 * ────────────────
 * cheatsheet.length gives the number of UTF-16 code units, NOT bytes.
 * For ASCII text they are the same, but mathematical symbols (like ∀, →, ∗)
 * are multi-byte in UTF-8.  TextEncoder gives the true byte count.
 */
function updateByteCounter() {
  const text = DOM.cheatsheetTextarea.value;
  const bytes = new TextEncoder().encode(text).length;
  const pct   = bytes / MAX_CHEATSHEET_BYTES;

  // ── Update the numeric counter ──
  DOM.byteCount.textContent = bytes.toLocaleString();

  // ── Colour the counter based on how full it is ──
  DOM.byteCount.classList.remove('warn', 'over');
  DOM.byteProgressFill.classList.remove('warn', 'over');

  if (bytes > MAX_CHEATSHEET_BYTES) {
    DOM.byteCount.classList.add('over');
    DOM.byteProgressFill.classList.add('over');
  } else if (pct > 0.85) {
    DOM.byteCount.classList.add('warn');
    DOM.byteProgressFill.classList.add('warn');
  }

  // ── Update the progress bar width (capped at 100%) ──
  DOM.byteProgressFill.style.width = `${Math.min(pct * 100, 100)}%`;

  // ── Show / hide the over-limit warning message ──
  DOM.byteWarning.classList.toggle('hidden', bytes <= MAX_CHEATSHEET_BYTES);
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 8: CSV PARSING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * readCsvFile(file)
 * ──────────────────
 * Reads a File object (from the drop zone or file picker) as text,
 * then passes it to parseAndLoadCsv().
 *
 * FileReader is the standard API for reading local files in the browser.
 *
 * @param {File} file
 */
function readCsvFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => parseAndLoadCsv(e.target.result);
  reader.onerror = () => showProblemsStatus('❌ Failed to read file.', 'error');
  reader.readAsText(file, 'UTF-8');
}

/**
 * parseAndLoadCsv(csvText)
 * ─────────────────────────
 * Parses raw CSV text into an array of problem objects.
 * Handles:
 *   • CRLF and LF line endings
 *   • Quoted fields (fields wrapped in double-quotes)
 *   • Missing optional columns (ground_truth)
 *   • Case-insensitive column headers
 *
 * @param {string} csvText
 */
function parseAndLoadCsv(csvText) {
  // Split into lines, ignoring blank lines
  const lines = csvText
    .replace(/\r\n/g, '\n')   // normalise Windows CRLF to Unix LF
    .replace(/\r/g,   '\n')   // normalise old Mac CR to LF
    .split('\n')
    .filter(l => l.trim() !== '');

  if (lines.length < 2) {
    showProblemsStatus('⚠ CSV must have a header row and at least one data row.', 'warn');
    return;
  }

  // ── Parse the header row ──
  const headers = parseCsvRow(lines[0]).map(h => h.trim().toLowerCase());

  // Check required columns exist
  const required = ['eq1', 'eq2', 'difficulty'];
  const missing = required.filter(r => !headers.includes(r));
  if (missing.length > 0) {
    showProblemsStatus(`⚠ Missing required column(s): ${missing.join(', ')}`, 'warn');
    return;
  }

  // Column index lookup
  const col = (name) => headers.indexOf(name);

  // ── Parse data rows ──
  const problems = [];
  const errors   = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    if (cells.length < 3) {
      errors.push(i + 1);  // 1-based line number for human-friendly messages
      continue;
    }

    const difficulty = (cells[col('difficulty')] ?? 'normal').toLowerCase().trim();

    problems.push({
      eq1:         (cells[col('eq1')]         ?? '').trim(),
      eq2:         (cells[col('eq2')]         ?? '').trim(),
      difficulty:  difficulty === 'hard' ? 'hard' : 'normal',
      groundTruth: (cells[col('ground_truth')] ?? '').trim().toUpperCase(),
    });
  }

  if (problems.length === 0) {
    showProblemsStatus('⚠ No valid problem rows found.', 'warn');
    return;
  }

  // ── Store and update UI ──
  state.problems = problems;

  // Adjust the "To" range input to the total number of problems
  DOM.rangeFrom.value = 1;
  DOM.rangeTo.value   = Math.min(50, problems.length);
  DOM.rangeTo.max     = problems.length;

  const normalCount = problems.filter(p => p.difficulty === 'normal').length;
  const hardCount   = problems.filter(p => p.difficulty === 'hard').length;
  const withTruth   = problems.filter(p => p.groundTruth !== '').length;

  let msg = `✅ Loaded ${problems.length} problems`;
  msg += ` (${normalCount} normal, ${hardCount} hard)`;
  if (withTruth > 0) msg += ` · ${withTruth} with ground truth`;
  if (errors.length > 0) msg += ` · ⚠ skipped ${errors.length} malformed rows`;

  showProblemsStatus(msg, 'ok');

  // Put the raw text in the textarea so the user can see it
  DOM.csvTextarea.value = lines.slice(0, 6).join('\n')
    + (lines.length > 6 ? `\n… (${lines.length - 1} data rows total)` : '');
}

/**
 * parseCsvRow(line)
 * ──────────────────
 * Parses a single CSV line into an array of field strings.
 * Handles quoted fields (fields may contain commas if wrapped in double-quotes).
 *
 * Algorithm: walk character by character, tracking whether we're inside
 * a quoted field.
 *
 * @param  {string}   line
 * @returns {string[]}
 */
function parseCsvRow(line) {
  const fields  = [];
  let   current = '';
  let   inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuote) {
      if (ch === '"') {
        // Peek ahead: is the next character also a quote?
        // If so, this is an escaped quote ("") — output one " and stay quoted.
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;          // skip the second "
        } else {
          inQuote = false;   // end of quoted field
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }

  fields.push(current);   // last field (no trailing comma)
  return fields;
}

/**
 * clearProblems()
 * ───────────────
 * Resets the problems state and UI.
 */
function clearProblems() {
  state.problems = [];
  DOM.csvTextarea.value = '';
  DOM.csvFileInput.value = '';
  showProblemsStatus('No problems loaded.', '');
}

/**
 * showProblemsStatus(msg, type)
 * ─────────────────────────────
 * Displays a status message below the CSV section.
 *
 * @param {string} msg  — the message to show
 * @param {string} type — 'ok' | 'warn' | 'error' | ''
 */
function showProblemsStatus(msg, type) {
  DOM.problemsStatus.textContent = msg;
  DOM.problemsStatus.style.color = {
    ok:    'var(--clr-green)',
    warn:  'var(--clr-amber)',
    error: 'var(--clr-red)',
    '':    'var(--clr-text-secondary)',
  }[type] ?? 'var(--clr-text-secondary)';
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 9: PROMPT BUILDER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * buildPrompt(problem, cheatsheetText, useCheatsheet)
 * ─────────────────────────────────────────────────────
 * Constructs the full prompt string for one problem.
 *
 * Prompt structure (when cheatsheet is enabled):
 * ──────────────────────────────────────────────
 *   === CHEATSHEET START ===
 *   {cheatsheet_content}
 *   === CHEATSHEET END ===
 *
 *   You are solving equational implication problems about magmas...
 *   PROBLEM: Does Equation 1 imply Equation 2?
 *   Equation 1: {eq1}
 *   Equation 2: {eq2}
 *   ...
 *   ANSWER: TRUE or ANSWER: FALSE
 *
 * @param {{ eq1: string, eq2: string }} problem
 * @param {string} cheatsheetText   — raw cheatsheet content
 * @param {boolean} useCheatsheet   — whether to prepend the cheatsheet
 * @returns {string}
 */
function buildPrompt(problem, cheatsheetText, useCheatsheet) {
  let prompt = '';

  // ── Optionally prepend cheatsheet ──
  if (useCheatsheet && cheatsheetText.trim().length > 0) {
    // Truncate to MAX_CHEATSHEET_BYTES in UTF-8
    const enc       = new TextEncoder();
    const bytes     = enc.encode(cheatsheetText);
    const truncated = bytes.length > MAX_CHEATSHEET_BYTES
      ? new TextDecoder().decode(bytes.slice(0, MAX_CHEATSHEET_BYTES))
      : cheatsheetText;

    prompt += `=== CHEATSHEET START ===\n${truncated}\n=== CHEATSHEET END ===\n\n`;
  }

  // ── Fixed instruction block (from spec section 3) ──
  prompt += `You are solving equational implication problems about magmas (sets with a binary operation *).

PROBLEM: Does Equation 1 imply Equation 2?
Equation 1: ${problem.eq1}
Equation 2: ${problem.eq2}

A law E1 implies law E2 if every magma satisfying E1 also satisfies E2.

Reason step by step, then end your response with exactly: ANSWER: TRUE or ANSWER: FALSE`;

  return prompt;
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 10: API CALLER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * callApi(providerId, modelId, apiKey, prompt, maxTokens, signal)
 * ────────────────────────────────────────────────────────────────
 * Sends a single prompt to the chosen provider and returns the model's
 * text response.
 *
 * @param {string} providerId
 * @param {string} modelId
 * @param {string} apiKey
 * @param {string} prompt
 * @param {number} maxTokens
 * @param {AbortSignal} signal — lets us cancel the fetch via AbortController
 * @returns {Promise<string>} — raw model text
 * @throws  Error on network failure, non-200 HTTP status, or abort
 */
async function callApi(providerId, modelId, apiKey, prompt, maxTokens, signal) {
  const provider = PROVIDER_CATALOGUE[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  // ── Build the messages array (no system prompt per spec) ──
  const messages = [
    { role: 'user', content: prompt },
  ];

  // ── Build the request body (provider-specific) ──
  const body = provider.buildBody(modelId, messages, maxTokens);

  // ── Build the URL (Google embeds model in the URL path) ──
  let url = provider.baseUrl.replace('{model}', modelId);
  if (providerId === 'google') {
    url += `?key=${encodeURIComponent(apiKey)}`;
  }

  // ── Build the headers ──
  const headers = {
    'Content-Type': 'application/json',
    ...provider.authHeader(apiKey),
  };

  // ── Send the request ──
  const response = await fetch(url, {
    method:  'POST',
    headers: headers,
    body:    JSON.stringify(body),
    signal:  signal,     // allows cancellation via AbortController.abort()
  });

  // ── Check for HTTP errors ──
  if (!response.ok) {
    let errText = '';
    try { errText = await response.text(); } catch (_) { /* ignore */ }
    throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }

  // ── Parse the JSON response ──
  const json = await response.json();

  // ── Extract the text content (provider-specific) ──
  const text = provider.extractText(json);
  if (text === undefined || text === null) {
    throw new Error('Could not extract text from response: ' + JSON.stringify(json).slice(0, 200));
  }

  return text;
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 11: ANSWER EXTRACTOR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * extractAnswer(responseText)
 * ────────────────────────────
 * Searches the model's response text for the last occurrence of
 * "ANSWER: TRUE" or "ANSWER: FALSE" (case-insensitive).
 *
 * WHY the LAST match?
 * ───────────────────
 * Models often reason step by step and may produce intermediate
 * "ANSWER: FALSE" statements before correcting themselves.
 * Taking the LAST match gives the model's final verdict.
 *
 * @param  {string}          responseText
 * @returns {'TRUE'|'FALSE'|'NO_ANSWER'}
 */
function extractAnswer(responseText) {
  if (!responseText) return 'NO_ANSWER';

  // Reset lastIndex before using the global regex
  ANSWER_REGEX.lastIndex = 0;

  let lastMatch = null;
  let match;

  // Iterate through all matches, keeping only the last one
  while ((match = ANSWER_REGEX.exec(responseText)) !== null) {
    lastMatch = match;
  }

  if (!lastMatch) return 'NO_ANSWER';

  return lastMatch[1].toUpperCase();  // 'TRUE' or 'FALSE'
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 12: EVALUATION RUN (batch + parallelism)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * startEvaluation()
 * ──────────────────
 * Validates inputs, initialises the results state, then launches
 * the parallel batch runner.
 *
 * Validation checks (in order):
 *   1. Problems are loaded
 *   2. API key is provided
 *   3. Problem range is valid
 */
async function startEvaluation() {
  // ── Validation ──
  if (state.problems.length === 0) {
    alert('Please load a CSV file of problems first.');
    return;
  }

  const apiKey = DOM.apiKeyInput.value.trim();
  if (!apiKey) {
    alert('Please enter an API key.');
    DOM.apiKeyInput.focus();
    return;
  }

  const fromIdx  = Math.max(1, parseInt(DOM.rangeFrom.value, 10) || 1) - 1;   // 0-based
  const toIdx    = Math.min(
    state.problems.length,
    parseInt(DOM.rangeTo.value, 10) || state.problems.length
  ) - 1;   // inclusive 0-based

  if (fromIdx > toIdx) {
    alert(`Invalid range: "From" (${fromIdx + 1}) must be ≤ "To" (${toIdx + 1}).`);
    return;
  }

  const problemsToRun = state.problems.slice(fromIdx, toIdx + 1);
  const parallelism   = parseInt(DOM.parallelismSlider.value, 10);
  const maxTokens     = parseInt(DOM.maxTokensInput.value, 10) || 1024;
  const providerId    = DOM.providerSelect.value;
  const modelId       = DOM.modelSelect.value;
  const useCheatsheet = DOM.useCheatsheetToggle.checked;
  const cheatsheet    = DOM.cheatsheetTextarea.value;

  // ── Initialise results array ──
  state.results = problemsToRun.map((p, i) => ({
    problemIdx:  fromIdx + i,
    eq1:         p.eq1,
    eq2:         p.eq2,
    difficulty:  p.difficulty,
    groundTruth: p.groundTruth,
    prediction:  '',
    correct:     null,
    status:      'pending',
    rawResponse: '',
    errorMsg:    '',
  }));

  state.running = true;
  state.abortController = new AbortController();

  // ── Reset the UI for a fresh run ──
  resetResultsTable();
  renderAllRows();          // show all rows in "pending" state
  setRunningState(true);
  resetMetrics();
  updateProgress(0, state.results.length);

  // ── Run the batch ──
  await runBatch(state.results, providerId, modelId, apiKey,
                 cheatsheet, useCheatsheet, maxTokens, parallelism);

  // ── Evaluation finished (or stopped) ──
  state.running = false;
  setRunningState(false);

  const aborted = state.abortController.signal.aborted;
  setStatusBadge(aborted ? 'idle' : 'done', aborted ? 'STOPPED' : 'DONE');
}

/**
 * stopEvaluation()
 * ─────────────────
 * Cancels all in-flight requests by triggering the AbortController.
 */
function stopEvaluation() {
  if (state.abortController) {
    state.abortController.abort();
  }
  state.running = false;
  setRunningState(false);
  setStatusBadge('idle', 'STOPPED');
}

/**
 * runBatch(results, providerId, modelId, apiKey,
 *          cheatsheet, useCheatsheet, maxTokens, parallelism)
 * ──────────────────────────────────────────────────────────────
 * Runs all problems in the results array using a concurrency pool.
 *
 * HOW THE POOL WORKS
 * ──────────────────
 * We maintain a Set of in-flight Promises.  Whenever the Set has fewer
 * than `parallelism` items, we start a new one.  Whenever a Promise
 * resolves, we remove it from the Set and potentially start another.
 *
 * This is the standard "promise pool" pattern in JS.
 *
 * @param {Array}   results         — the full results array (mutated in place)
 * @param {string}  providerId
 * @param {string}  modelId
 * @param {string}  apiKey
 * @param {string}  cheatsheet
 * @param {boolean} useCheatsheet
 * @param {number}  maxTokens
 * @param {number}  parallelism     — max concurrent requests (1–5)
 */
async function runBatch(results, providerId, modelId, apiKey,
                        cheatsheet, useCheatsheet, maxTokens, parallelism) {
  const signal    = state.abortController.signal;
  const pool      = new Set();    // Set of currently running Promises
  let   nextIndex = 0;            // index into results[] for next problem

  /**
   * runOne(i)
   * ─────────
   * Evaluates results[i], updating its state and the UI as it goes.
   */
  const runOne = async (i) => {
    const result = results[i];

    // ── Mark as running ──
    result.status = 'running';
    updateRow(i);

    // ── Build the prompt ──
    const prompt = buildPrompt(
      { eq1: result.eq1, eq2: result.eq2 },
      cheatsheet,
      useCheatsheet
    );

    try {
      // ── Call the API ──
      const responseText = await callApi(
        providerId, modelId, apiKey, prompt, maxTokens, signal
      );

      // ── Extract the answer ──
      result.rawResponse = responseText;
      result.prediction  = extractAnswer(responseText);

      // ── Score if ground truth is available ──
      if (result.groundTruth && result.groundTruth !== '') {
        result.correct = result.prediction === result.groundTruth;
      } else {
        result.correct = null;   // can't score without ground truth
      }

      result.status = 'done';

    } catch (err) {
      if (err.name === 'AbortError') {
        // User pressed Stop — mark as skipped
        result.status   = 'skipped';
        result.errorMsg = 'Cancelled';
      } else {
        result.status   = 'error';
        result.errorMsg = err.message || String(err);
        console.error(`Problem ${i + 1} failed:`, err);
      }
    }

    // ── Update the table row and metrics ──
    updateRow(i);
    updateMetrics();
    updateProgress(
      results.filter(r => r.status !== 'pending' && r.status !== 'running').length,
      results.length
    );
  };

  // ── Pool loop ──
  while (nextIndex < results.length || pool.size > 0) {
    // If aborted, stop starting new requests
    if (signal.aborted && pool.size === 0) break;

    // Start new tasks until the pool is full
    while (!signal.aborted && nextIndex < results.length && pool.size < parallelism) {
      const i   = nextIndex++;
      const job = runOne(i).finally(() => pool.delete(job));
      pool.add(job);
    }

    // Wait for at least one task to finish before checking again
    if (pool.size > 0) {
      await Promise.race(pool);
    }
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 13: METRICS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * resetMetrics()
 * ──────────────
 * Sets all metric displays back to their initial "—" / "0 / 0" state.
 */
function resetMetrics() {
  ['overall', 'normal', 'hard'].forEach(key => {
    const capKey = key.charAt(0).toUpperCase() + key.slice(1);
    DOM[`metric${capKey}Pct`].textContent  = '—';
    DOM[`metric${capKey}Frac`].textContent = '0 / 0';
    setRingProgress(`ring${capKey}`, 0);
  });
  DOM.scoreBanner.classList.add('hidden');
}

/**
 * updateMetrics()
 * ────────────────
 * Recomputes accuracy from state.results and reflects it in:
 *   • The three percentage displays
 *   • The fraction labels
 *   • The SVG ring progress indicators
 *   • The score interpretation banner
 *
 * Only evaluated problems with a known ground truth contribute to accuracy.
 */
function updateMetrics() {
  const scorable = state.results.filter(r => r.correct !== null);
  const byDiff   = (d) => scorable.filter(r => r.difficulty === d);

  const compute = (subset) => ({
    correct: subset.filter(r => r.correct === true).length,
    total:   subset.length,
    pct:     subset.length > 0
      ? subset.filter(r => r.correct === true).length / subset.length
      : null,
  });

  const overall = compute(scorable);
  const normal  = compute(byDiff('normal'));
  const hard    = compute(byDiff('hard'));

  renderMetricCard('Overall', overall);
  renderMetricCard('Normal',  normal);
  renderMetricCard('Hard',    hard);

  // ── Score interpretation banner ──
  if (overall.total >= 5 && overall.pct !== null) {
    const level = SCORE_THRESHOLDS.find(t => overall.pct >= t.min);
    DOM.scoreInterpretation.textContent = level?.label ?? '';
    DOM.scoreBanner.className = `score-banner ${level?.cls ?? ''}`;
    DOM.scoreBanner.classList.remove('hidden');
  }
}

/**
 * renderMetricCard(capKey, { correct, total, pct })
 * ───────────────────────────────────────────────────
 * Updates one metric card's display.
 *
 * @param {string} capKey  — 'Overall', 'Normal', or 'Hard'
 * @param {{ correct: number, total: number, pct: number|null }} data
 */
function renderMetricCard(capKey, data) {
  const pctEl  = DOM[`metric${capKey}Pct`];
  const fracEl = DOM[`metric${capKey}Frac`];

  if (data.total === 0) {
    pctEl.textContent  = '—';
    fracEl.textContent = '0 / 0';
    setRingProgress(`ring${capKey}`, 0);
    return;
  }

  const pct = data.pct ?? 0;

  pctEl.textContent  = `${(pct * 100).toFixed(1)}%`;
  fracEl.textContent = `${data.correct} / ${data.total}`;

  // Colour the percentage based on performance level
  pctEl.style.color = pct >= 0.65 ? 'var(--clr-green)'
                    : pct >= 0.59 ? 'var(--clr-cyan)'
                    : pct >= 0.50 ? 'var(--clr-amber)'
                    : 'var(--clr-red)';

  setRingProgress(`ring${capKey}`, pct);
}

/**
 * setRingProgress(ringId, fraction)
 * ────────────────────────────────────
 * Updates the stroke-dasharray on an SVG circle to show `fraction`
 * of the ring filled in.
 *
 * MATHS:
 *   circumference = 2π × r = 2π × 24 ≈ 150.796
 *   filled = circumference × fraction
 *   gap    = circumference - filled
 *   stroke-dasharray = "filled gap"
 *
 * @param {string} ringId    — DOM element id
 * @param {number} fraction  — 0.0 to 1.0
 */
function setRingProgress(ringId, fraction) {
  const el = DOM[ringId];
  if (!el) return;
  const circ   = 2 * Math.PI * 24;   // ≈ 150.796
  const filled = circ * Math.max(0, Math.min(1, fraction));
  const gap    = circ - filled;
  el.setAttribute('stroke-dasharray', `${filled.toFixed(2)} ${gap.toFixed(2)}`);
}

/**
 * updateProgress(done, total)
 * ────────────────────────────
 * Updates the linear progress bar and the "X / Y problems complete" label.
 */
function updateProgress(done, total) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  DOM.evalProgressFill.style.width = `${pct.toFixed(1)}%`;
  DOM.evalProgressLabel.textContent = `${done} / ${total} problems complete`;
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 14: RESULTS TABLE RENDERER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * resetResultsTable()
 * ────────────────────
 * Clears the table body and shows the empty-state message.
 */
function resetResultsTable() {
  DOM.resultsTbody.innerHTML = '';
  DOM.resultsEmpty.classList.add('hidden');
  DOM.exportCsvBtn.disabled = true;
}

/**
 * renderAllRows()
 * ────────────────
 * Renders one <tr> per result in state.results (initial paint).
 */
function renderAllRows() {
  state.results.forEach((_, i) => createRow(i));
}

/**
 * createRow(i)
 * ─────────────
 * Creates and appends a new <tr> for results[i].
 * After creation, the row is updated by updateRow(i).
 *
 * @param {number} i — index into state.results
 */
function createRow(i) {
  const tr = document.createElement('tr');
  tr.id    = `row-${i}`;
  tr.classList.add('row-new');
  DOM.resultsTbody.appendChild(tr);
  updateRow(i);   // fill in the cells immediately
}

/**
 * updateRow(i)
 * ─────────────
 * Updates the content of the <tr> for results[i] based on its current state.
 * Called every time a result changes (running → done, etc.).
 *
 * @param {number} i — index into state.results
 */
function updateRow(i) {
  const r  = state.results[i];
  const tr = document.getElementById(`row-${i}`);
  if (!tr) return;

  // ── 1-based row number ──
  const rowNum = r.problemIdx + 1;

  // ── Difficulty badge ──
  const diffHtml = `<span class="diff-badge ${r.difficulty}">${r.difficulty}</span>`;

  // ── Prediction cell ──
  const predClass = r.prediction === 'TRUE'     ? 'pred-true'
                  : r.prediction === 'FALSE'    ? 'pred-false'
                  : 'pred-na';
  const predText  = r.prediction || '—';

  // ── Ground truth cell ──
  const truthClass = r.groundTruth === 'TRUE'  ? 'pred-true'
                   : r.groundTruth === 'FALSE' ? 'pred-false'
                   : 'pred-na';
  const truthText  = r.groundTruth || '—';

  // ── Correct cell ──
  const corrClass = r.correct === true  ? 'correct-yes'
                  : r.correct === false ? 'correct-no'
                  : 'correct-na';
  const corrText  = r.correct === true  ? '✓'
                  : r.correct === false ? '✗'
                  : '—';

  // ── Status cell ──
  const statClass = `status-${r.status}`;
  const statText  = r.status === 'error'   ? `ERR: ${r.errorMsg.slice(0, 40)}`
                  : r.status === 'running' ? '⟳ …'
                  : r.status === 'done'    ? 'done'
                  : r.status === 'skipped' ? 'stopped'
                  : r.status;

  // ── Truncate equations for display (full text in title attribute) ──
  const truncate = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
  const eq1Disp  = truncate(r.eq1, 28);
  const eq2Disp  = truncate(r.eq2, 28);

  tr.innerHTML = `
    <td>${rowNum}</td>
    <td title="${escHtml(r.eq1)}">${escHtml(eq1Disp)}</td>
    <td title="${escHtml(r.eq2)}">${escHtml(eq2Disp)}</td>
    <td>${diffHtml}</td>
    <td class="${predClass}">${predText}</td>
    <td class="${truthClass}">${truthText}</td>
    <td class="${corrClass}">${corrText}</td>
    <td class="${statClass}">${escHtml(statText)}</td>
  `;

  // Enable export once we have at least one done row
  if (r.status === 'done' || r.status === 'error') {
    DOM.exportCsvBtn.disabled = false;
  }
}

/**
 * escHtml(str)
 * ─────────────
 * Escapes HTML special characters to prevent XSS and display glitches.
 * Always use this when inserting user-supplied strings into innerHTML.
 *
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 15: STATUS BADGE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * setStatusBadge(state, label)
 * ─────────────────────────────
 * Changes the colour and text of the status badge in the header.
 *
 * @param {'idle'|'running'|'done'|'error'} state
 * @param {string} label  — text to display
 */
function setStatusBadge(badgeState, label) {
  DOM.statusBadge.className = `badge badge-${badgeState}`;
  DOM.statusText.textContent = label;
}

/**
 * setRunningState(running)
 * ─────────────────────────
 * Enables/disables the Run and Stop buttons and updates the status badge.
 *
 * @param {boolean} running
 */
function setRunningState(running) {
  DOM.runBtn.disabled  = running;
  DOM.stopBtn.disabled = !running;

  if (running) {
    setStatusBadge('running', 'RUNNING');
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 16: CSV EXPORT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * exportResultsCsv()
 * ───────────────────
 * Serialises state.results into a CSV string and triggers a browser download.
 *
 * The exported CSV contains all columns needed to analyse the results
 * afterwards, including the raw model response (escaped).
 *
 * HOW BROWSER DOWNLOAD WORKS (the Blob + <a> trick):
 * ────────────────────────────────────────────────────
 *  1. Create a Blob (binary large object) containing the CSV text.
 *  2. Create a temporary object URL pointing to that Blob.
 *  3. Create a hidden <a> element with that href and a download attribute.
 *  4. Programmatically click the link → browser saves the file.
 *  5. Clean up the object URL immediately after.
 */
function exportResultsCsv() {
  if (state.results.length === 0) return;

  const COLUMNS = [
    'problem_num', 'eq1', 'eq2', 'difficulty',
    'ground_truth', 'prediction', 'correct', 'status', 'raw_response',
  ];

  // ── Build CSV rows ──
  const rows = state.results.map(r => [
    r.problemIdx + 1,
    r.eq1,
    r.eq2,
    r.difficulty,
    r.groundTruth,
    r.prediction,
    r.correct === null ? '' : r.correct ? 'TRUE' : 'FALSE',
    r.status,
    // Escape the raw response: wrap in quotes, escape internal quotes
    r.rawResponse.replace(/"/g, '""'),
  ]);

  // ── Serialise to CSV ──
  const csvContent = [COLUMNS, ...rows]
    .map(row =>
      row.map(cell => {
        const s = String(cell ?? '');
        // Quote any field containing comma, newline, or double-quote
        return (s.includes(',') || s.includes('\n') || s.includes('"'))
          ? `"${s}"`
          : s;
      }).join(',')
    )
    .join('\n');

  // ── Create download ──
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);

  link.href     = url;
  link.download = `eqthry-results-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Free the object URL (browser would garbage-collect it eventually,
  // but releasing it immediately is good practice)
  URL.revokeObjectURL(url);
}

/* ─── End of script.js ─── */
