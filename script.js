'use strict';

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * EQUATIONAL THEORIES PLAYGROUND — script.js (SAIR redesign)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sections:
 *  1.  Constants & configuration
 *  2.  Application state
 *  3.  Provider catalogue
 *  4.  DOM cache & wiring
 *  5.  Init
 *  6.  Provider / model select
 *  7.  Cheatsheet byte counter
 *  8.  CSV parsing & problem list
 *  9.  Problem selection
 * 10.  Prompt builder
 * 11.  API caller
 * 12.  Answer extractor
 * 13.  Evaluation run
 * 14.  Result cards renderer
 * 15.  Stats updater
 * 16.  Modals (prompt preview / raw log)
 * 17.  CSV export
 * 18.  Utilities
 */

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const MAX_CHEATSHEET_BYTES = 10_240;

const SCORE_THRESHOLDS = [
  { min: 0.65, label: '> 65% — Excellent — strong cheatsheet content ✨',       cls: 'level-excel'  },
  { min: 0.59, label: '59–65% — Good — competitive submission range 📈',         cls: 'level-good'   },
  { min: 0.53, label: '53–58% — Modest improvement — cheatsheet is helping 📊', cls: 'level-modest' },
  { min: 0.50, label: '50–52% — Random — cheatsheet has no measurable effect ─', cls: 'level-random' },
  { min: 0,    label: '< 50% — Worse than random — cheatsheet may be harmful ⚠', cls: 'level-below'  },
];

/** Matches VERDICT: TRUE or VERDICT: FALSE (case-insensitive, last match wins) */
const ANSWER_REGEX = /VERDICT:\s*(TRUE|FALSE)/gi;

/* ═══════════════════════════════════════════════════════════════════════════
   2. APPLICATION STATE
   ═══════════════════════════════════════════════════════════════════════════ */

const state = {
  /** All loaded problems: { eq1, eq2, difficulty, groundTruth } */
  problems: [],

  /** Set of selected problem indices (0-based) */
  selectedIndices: new Set(),

  /** Current search/filter */
  searchQuery: '',
  difficultyFilter: 'all',

  /**
   * Results: one per selected problem run
   * { problemIdx, eq1, eq2, difficulty, groundTruth,
   *   prediction, correct, status, rawResponse, errorMsg, prompt }
   */
  results: [],

  running: false,
  abortController: null,

};

/* ═══════════════════════════════════════════════════════════════════════════
   3. PROVIDER CATALOGUE
   ═══════════════════════════════════════════════════════════════════════════ */

const PROVIDER_CATALOGUE = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    models: [
      { id: 'gpt-4o',          label: 'GPT-4o' },
      { id: 'gpt-4o-mini',     label: 'GPT-4o Mini' },
      { id: 'gpt-oss-120b',    label: 'gpt-oss-120b (Stage 1)' },
      { id: 'o3-mini',         label: 'o3-mini' },
      { id: 'gpt-4-turbo',     label: 'GPT-4 Turbo' },
    ],
    buildBody: (model, messages, maxTokens) => ({ model, messages, max_completion_tokens: maxTokens }),
    extractText: (json) => json?.choices?.[0]?.message?.content ?? '',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    models: [
      { id: 'claude-opus-4-5',            label: 'Claude Opus 4.5' },
      { id: 'claude-sonnet-4-5',          label: 'Claude Sonnet 4.5' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-haiku-20240307',    label: 'Claude 3 Haiku' },
    ],
    buildBody: (model, messages, maxTokens) => ({ model, max_tokens: maxTokens, messages }),
    extractText: (json) => {
      const block = json?.content?.find?.(b => b.type === 'text');
      return block?.text ?? '';
    },
    extractTokens: (json) => json?.usage?.input_tokens + json?.usage?.output_tokens,
  },
  xai: {
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    models: [
      { id: 'grok-4-fast', label: 'Grok 4 Fast (Stage 1)' },
      { id: 'grok-3',      label: 'Grok 3' },
      { id: 'grok-3-mini', label: 'Grok 3 Mini' },
    ],
    buildBody: (model, messages, maxTokens) => ({ model, messages, max_tokens: maxTokens }),
    extractText: (json) => json?.choices?.[0]?.message?.content ?? '',
  },
  google: {
    name: 'Google (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    authHeader: (_key) => ({}),
    models: [
      { id: 'gemini-2.0-flash-lite',             label: 'Gemini 2.0 Flash Lite' },
      { id: 'gemini-3.1-flash-lite-preview',     label: 'Gemini 3.1 Flash Lite Preview (Stage 1)' },
      { id: 'gemini-2.0-flash',                  label: 'Gemini 2.0 Flash' },
    ],
    buildBody: (model, messages, maxTokens) => ({
      contents: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    extractText: (json) => json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    extractTokens: (json) => json?.usageMetadata?.totalTokenCount,
  },
  meta: {
    name: 'Meta (via Together AI)',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct',          label: 'Llama 3.3 70B Instruct (Stage 1)' },
      { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', label: 'Llama 3.1 8B Instruct Turbo' },
    ],
    buildBody: (model, messages, maxTokens) => ({ model, messages, max_tokens: maxTokens }),
    extractText: (json) => json?.choices?.[0]?.message?.content ?? '',
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   4. DOM CACHE
   ═══════════════════════════════════════════════════════════════════════════ */

const DOM = {};

function cacheDom() {
  const ids = [
    'provider-select', 'model-select', 'api-key-input', 'toggle-key-btn',
    'cheatsheet-textarea', 'byte-count', 'byte-progress-fill', 'byte-warning',
    'use-cheatsheet-toggle',
    'parallelism-slider', 'parallelism-value',
    'max-tokens-input',
    'import-csv-btn', 'csv-file-input', 'clear-problems-btn',
    'problems-status',
    'problem-search', 'filter-pills',
    'problem-list',
    'selected-panel', 'selected-count', 'selected-preview',
    'clear-sel-btn', 'select-all-btn',
    'run-btn', 'stop-btn', 'run-count',
    'status-badge', 'status-text',
    'stats-bar',
    'stat-remaining', 'stat-done-today', 'stat-total', 'stat-correct', 'stat-accuracy',
    'eval-progress-wrap', 'eval-progress-fill', 'eval-progress-label',
    'score-banner', 'score-interpretation',
    'results-area', 'results-empty', 'results-cards',
    'export-csv-btn',
    // Layout roots (for tab switching)
    'sidebar', 'main-area',
    // Saved API keys
    'saved-keys-select', 'load-key-btn', 'delete-key-btn', 'key-name-input', 'save-key-btn',
    // Modals
    'prompt-modal-overlay', 'prompt-modal-close', 'prompt-modal-content',
    'log-modal-overlay', 'log-modal-close', 'log-modal-title', 'log-modal-meta', 'log-modal-content',
  ];
  ids.forEach(id => {
    const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    DOM[key] = document.getElementById(id);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   UI WIRING
   ═══════════════════════════════════════════════════════════════════════════ */

function wireUi() {
  DOM.providerSelect.addEventListener('change', () => populateModelSelect(DOM.providerSelect.value));
  DOM.toggleKeyBtn.addEventListener('click', () => {
    const inp = DOM.apiKeyInput;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  DOM.cheatsheetTextarea.addEventListener('input', updateByteCounter);
  DOM.parallelismSlider.addEventListener('input', () => {
    DOM.parallelismValue.textContent = DOM.parallelismSlider.value;
  });

  // CSV import
  DOM.importCsvBtn.addEventListener('click', () => DOM.csvFileInput.click());
  DOM.csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) readCsvFile(file);
  });
  DOM.clearProblemsBtn.addEventListener('click', clearProblems);

  // Search / filter
  DOM.problemSearch.addEventListener('input', () => {
    state.searchQuery = DOM.problemSearch.value.trim();
    renderProblemList();
  });
  DOM.filterPills.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.difficultyFilter = pill.dataset.filter;
    renderProblemList();
  });

  // Selection controls
  DOM.clearSelBtn.addEventListener('click', () => {
    state.selectedIndices.clear();
    renderProblemList();
    updateSelectionUI();
  });
  DOM.selectAllBtn.addEventListener('click', () => {
    getFilteredProblems().forEach(({ idx }) => state.selectedIndices.add(idx));
    renderProblemList();
    updateSelectionUI();
  });

  // Run / stop
  DOM.runBtn.addEventListener('click', startEvaluation);
  DOM.stopBtn.addEventListener('click', stopEvaluation);

  // Export
  DOM.exportCsvBtn.addEventListener('click', exportResultsCsv);

  // Modals
  DOM.promptModalClose.addEventListener('click', () => closeModal('promptModalOverlay'));
  DOM.logModalClose.addEventListener('click', () => closeModal('logModalOverlay'));
  DOM.promptModalOverlay.addEventListener('click', (e) => { if (e.target === DOM.promptModalOverlay) closeModal('promptModalOverlay'); });
  DOM.logModalOverlay.addEventListener('click', (e) => { if (e.target === DOM.logModalOverlay) closeModal('logModalOverlay'); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('promptModalOverlay');
      closeModal('logModalOverlay');
    }
  });

  // Saved API keys
  wireApiKeys();
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. INIT
   ═══════════════════════════════════════════════════════════════════════════ */

function init() {
  cacheDom();
  wireUi();
  populateProviderSelect();
  populateModelSelect(DOM.providerSelect.value);
  initApiKeys();
  loadStoredData();
  updateByteCounter();
}

function loadStoredData() {
  try {
    const pStr = localStorage.getItem('eq-problems');
    if (pStr) {
      const p = JSON.parse(pStr);
      if (Array.isArray(p) && p.length > 0) {
        state.problems = p;
        state.selectedIndices.clear();
        const n = p.filter(x => x.difficulty === 'normal').length;
        const h = p.filter(x => x.difficulty === 'hard').length;
        showProblemsStatus(`✅ ${p.length} problems loaded from storage`);
        renderProblemList();
        updateSelectionUI();
        updateStats();
      }
    }
  } catch(e) {}

  try {
    const cStr = localStorage.getItem('eq-cheatsheet');
    if (cStr) {
      DOM.cheatsheetTextarea.value = cStr;
    }
  } catch(e) {}
}

document.addEventListener('DOMContentLoaded', init);

/* ═══════════════════════════════════════════════════════════════════════════
   6. MAIN TAB SWITCH
   ═══════════════════════════════════════════════════════════════════════════ */

function switchMainTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');

  const layout = document.getElementById('layout');
  if (tab === 'history') {
    layout.classList.add('history-active');
    renderHistory();
    updateHistoryModelFilter();
  } else {
    layout.classList.remove('history-active');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. PROVIDER / MODEL SELECT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Populates the provider <select> from PROVIDER_CATALOGUE */
function populateProviderSelect() {
  const sel = DOM.providerSelect;
  sel.innerHTML = '';
  Object.entries(PROVIDER_CATALOGUE).forEach(([id, p]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

function populateModelSelect(providerId) {
  const provider = PROVIDER_CATALOGUE[providerId];
  if (!provider) return;
  DOM.modelSelect.innerHTML = '';
  provider.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    DOM.modelSelect.appendChild(opt);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. CHEATSHEET BYTE COUNTER
   ═══════════════════════════════════════════════════════════════════════════ */

function updateByteCounter() {
  const text  = DOM.cheatsheetTextarea.value;
  try { localStorage.setItem('eq-cheatsheet', text); } catch(e) {}
  const bytes = new TextEncoder().encode(text).length;
  const pct   = bytes / MAX_CHEATSHEET_BYTES;

  // Pill display
  const pill = DOM.byteCount;
  pill.textContent = bytes >= 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${bytes} B`;
  pill.className = 'byte-pill';
  if (bytes > MAX_CHEATSHEET_BYTES) pill.classList.add('over');
  else if (pct > 0.85) pill.classList.add('warn');

  // Progress bar
  DOM.byteProgressFill.className = 'byte-progress-fill';
  DOM.byteProgressFill.style.width = `${Math.min(pct * 100, 100)}%`;
  if (bytes > MAX_CHEATSHEET_BYTES) DOM.byteProgressFill.classList.add('over');
  else if (pct > 0.85) DOM.byteProgressFill.classList.add('warn');

  DOM.byteWarning.classList.toggle('hidden', bytes <= MAX_CHEATSHEET_BYTES);
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. JSONL PARSING & PROBLEM LIST
   ═══════════════════════════════════════════════════════════════════════════ */

function readCsvFile(file) {
  const reader = new FileReader();
  reader.onload  = (e) => parseAndLoadJsonl(e.target.result);
  reader.onerror = () => showProblemsStatus('❌ Failed to read file.');
  reader.readAsText(file, 'UTF-8');
}

/**
 * Parses a JSONL file where each line is a JSON object with fields:
 *   id, index, difficulty, equation1, equation2, answer (boolean)
 */
function parseAndLoadJsonl(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter(l => l.trim() !== '');

  if (!lines.length) {
    showProblemsStatus('⚠ File is empty.');
    return;
  }

  const problems = [];
  const errors   = [];

  lines.forEach((line, lineIdx) => {
    try {
      const obj = JSON.parse(line);
      // Required fields
      const eq1 = (obj.equation1 ?? '').trim();
      const eq2 = (obj.equation2 ?? '').trim();
      if (!eq1 || !eq2) { errors.push(`line ${lineIdx + 1}: missing equation1/equation2`); return; }

      const difficulty = (obj.difficulty ?? 'normal').toLowerCase().trim();
      // answer is boolean true/false in JSONL
      let groundTruth = '';
      if (obj.answer === true)  groundTruth = 'TRUE';
      else if (obj.answer === false) groundTruth = 'FALSE';
      else groundTruth = String(obj.answer ?? '').toUpperCase();

      problems.push({
        id:          obj.id ?? `problem_${lineIdx + 1}`,
        index:       obj.index ?? (lineIdx + 1),
        eq1,
        eq2,
        difficulty:  difficulty === 'hard' ? 'hard' : 'normal',
        groundTruth,
      });
    } catch (e) {
      errors.push(`line ${lineIdx + 1}: invalid JSON`);
    }
  });

  if (!problems.length) {
    showProblemsStatus(`⚠ No valid problem lines found.${errors.length ? ' Errors: ' + errors.slice(0, 3).join('; ') : ''}`);
    return;
  }

  state.problems = problems;
  state.selectedIndices.clear();

  try { localStorage.setItem('eq-problems', JSON.stringify(state.problems)); } catch(e) {}

  const n = problems.filter(p => p.difficulty === 'normal').length;
  const h = problems.filter(p => p.difficulty === 'hard').length;
  const errNote = errors.length ? ` (⚠ ${errors.length} skipped)` : '';
  showProblemsStatus(`✅ ${problems.length} problems  (${n} normal, ${h} hard)${errNote}`);

  renderProblemList();
  updateSelectionUI();
  updateStats();
}



function clearProblems() {
  state.problems = [];
  state.selectedIndices.clear();
  try { localStorage.removeItem('eq-problems'); } catch(e) {}
  DOM.csvFileInput.value = '';
  showProblemsStatus('No problems loaded.');
  renderProblemList();
  updateSelectionUI();
  updateStats();
}

function showProblemsStatus(msg) {
  DOM.problemsStatus.textContent = msg;
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. PROBLEM LIST RENDERING & SELECTION
   ═══════════════════════════════════════════════════════════════════════════ */

function getFilteredProblems() {
  const q    = state.searchQuery.toLowerCase();
  const diff = state.difficultyFilter;
  return state.problems
    .map((p, idx) => ({ p, idx }))
    .filter(({ p, idx }) => {
      if (diff !== 'all' && p.difficulty !== diff) return false;
      if (q) {
        const matchNum = `#${idx + 1}`.includes(q) || String(idx + 1).includes(q);
        const matchEq  = p.eq1.toLowerCase().includes(q) || p.eq2.toLowerCase().includes(q);
        if (!matchNum && !matchEq) return false;
      }
      return true;
    });
}

function renderProblemList() {
  const list    = DOM.problemList;
  const items   = getFilteredProblems();
  list.innerHTML = '';

  if (!state.problems.length) {
    list.innerHTML = '<div class="problem-list-empty">Import all_problems.csv to begin.</div>';
    return;
  }
  if (!items.length) {
    list.innerHTML = '<div class="problem-list-empty">No problems match the filter.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  items.forEach(({ p, idx }) => {
    const selected = state.selectedIndices.has(idx);
    const div = document.createElement('div');
    div.className = `problem-item${selected ? ' selected' : ''}`;
    div.setAttribute('role', 'option');
    div.setAttribute('aria-selected', String(selected));
    div.dataset.idx = idx;

    div.innerHTML = `
      <div class="problem-checkbox"></div>
      <div class="problem-info">
        <div class="problem-idx">#${idx + 1}</div>
        <div class="problem-eq">${escHtml(p.eq1)}</div>
        <div class="problem-eq" style="color:var(--text-3)">→ ${escHtml(p.eq2)}</div>
      </div>
      <span class="problem-diff ${p.difficulty}">${p.difficulty}</span>
    `;

    div.addEventListener('click', () => toggleProblemSelection(idx));
    frag.appendChild(div);
  });

  list.appendChild(frag);
}

function toggleProblemSelection(idx) {
  if (state.selectedIndices.has(idx)) {
    state.selectedIndices.delete(idx);
  } else {
    state.selectedIndices.add(idx);
  }
  renderProblemList();
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selectedIndices.size;
  DOM.runCount.textContent = count;
  DOM.runBtn.disabled = count === 0;

  if (count === 0) {
    DOM.selectedPanel.classList.add('hidden');
    return;
  }

  DOM.selectedPanel.classList.remove('hidden');
  DOM.selectedCount.textContent = `${count} selected`;

  // Preview: show first few selected
  const sorted = [...state.selectedIndices].sort((a, b) => a - b);
  DOM.selectedPreview.innerHTML = sorted.slice(0, 6).map(idx => {
    const p = state.problems[idx];
    return `<div class="selected-preview-item">#${idx + 1} ${escHtml(p.eq1.slice(0, 32))}…</div>`;
  }).join('') + (sorted.length > 6 ? `<div class="selected-preview-item" style="color:var(--text-3)">… and ${sorted.length - 6} more</div>` : '');
}

/* ═══════════════════════════════════════════════════════════════════════════
   11. PROMPT BUILDER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Matches the reference Jinja2 template from SPECIFICATION.md section 3.
 * Injects cheatsheet inline (if enabled), then shows the output format.
 */
function buildPrompt(problem, cheatsheetText, useCheatsheet) {
  // Truncate cheatsheet to MAX_CHEATSHEET_BYTES
  let cheatsheet = '';
  if (useCheatsheet && cheatsheetText.trim().length > 0) {
    const enc   = new TextEncoder();
    const bytes = enc.encode(cheatsheetText);
    cheatsheet  = bytes.length > MAX_CHEATSHEET_BYTES
      ? new TextDecoder().decode(bytes.slice(0, MAX_CHEATSHEET_BYTES))
      : cheatsheetText;
  }

  let prompt = `You are a mathematician specializing in equational theories of magmas. Your task is to determine whether Equation 1 (${problem.eq1}) implies Equation 2 (${problem.eq2}) over all magmas.\n`;

  if (cheatsheet) {
    prompt += cheatsheet + '\n';
  }

  prompt += `Output format (use exact headers without any additional text or formatting):
VERDICT: must be exactly TRUE or FALSE (in the same line).
REASONING: must be non-empty.
PROOF: required if VERDICT is TRUE, empty otherwise.
COUNTEREXAMPLE: required if VERDICT is FALSE, empty otherwise.`;

  return prompt;
}

/* ═══════════════════════════════════════════════════════════════════════════
   12. API CALLER
   ═══════════════════════════════════════════════════════════════════════════ */

async function callApi(providerId, modelId, apiKey, prompt, maxTokens, signal) {
  const provider = PROVIDER_CATALOGUE[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const messages = [{ role: 'user', content: prompt }];
  const body     = provider.buildBody(modelId, messages, maxTokens);

  let url = provider.baseUrl.replace('{model}', modelId);
  if (providerId === 'google') url += `?key=${encodeURIComponent(apiKey)}`;

  const headers = { 'Content-Type': 'application/json', ...provider.authHeader(apiKey) };

  const tStart   = Date.now();
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });

  if (!response.ok) {
    let errText = '';
    try { errText = await response.text(); } catch (_) { /* ignore */ }
    throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }

  const json = await response.json();
  const text = provider.extractText(json);
  if (text === undefined || text === null) {
    throw new Error('Could not extract text: ' + JSON.stringify(json).slice(0, 200));
  }

  const elapsed = Date.now() - tStart;

  // Best-effort metadata
  const usage  = json?.usage ?? {};
  
  let tokens = '—';
  if (provider.extractTokens) {
    tokens = provider.extractTokens(json) ?? '—';
  } else if (usage.total_tokens) {
    tokens = usage.total_tokens;
  } else if (usage.completion_tokens || usage.prompt_tokens) {
    tokens = (usage.completion_tokens || 0) + (usage.prompt_tokens || 0);
  } else if (usage.candidates?.[0]?.tokenCount) {
    tokens = usage.candidates?.[0]?.tokenCount;
  }
  
  const cost   = estimateCost(modelId, usage);

  return { text, elapsed, tokens, cost };
}

/** Very rough cost estimate in USD */
function estimateCost(modelId, usage) {
  const inTokens  = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  if (!inTokens && !outTokens) return null;

  // Approximate per-1k-token prices (USD)
  const PRICES = {
    'gpt-4o':       [0.005,  0.015],
    'gpt-4o-mini':  [0.00015,0.0006],
    'gpt-oss-120b': [0.003,  0.009],
    'o3-mini':      [0.0011, 0.0044],
    'gpt-4-turbo':  [0.01,   0.03],
    'grok-4-fast':  [0.002,  0.006],
    'grok-3':       [0.003,  0.009],
    'grok-3-mini':  [0.0003, 0.0005],
    'default':      [0.001,  0.003],
  };
  const [pIn, pOut] = PRICES[modelId] ?? PRICES['default'];
  return (inTokens / 1000) * pIn + (outTokens / 1000) * pOut;
}

/* ═══════════════════════════════════════════════════════════════════════════
   13. ANSWER EXTRACTOR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Finds the LAST VERDICT: TRUE/FALSE in the model response.
 * Returns 'TRUE', 'FALSE', or 'NO_ANSWER'.
 */
function extractAnswer(responseText) {
  if (!responseText) return 'NO_ANSWER';
  ANSWER_REGEX.lastIndex = 0;
  let lastMatch = null;
  let match;
  while ((match = ANSWER_REGEX.exec(responseText)) !== null) lastMatch = match;
  if (!lastMatch) return 'NO_ANSWER';
  return lastMatch[1].toUpperCase();
}

/* ═══════════════════════════════════════════════════════════════════════════
   14. EVALUATION RUN
   ═══════════════════════════════════════════════════════════════════════════ */

async function startEvaluation() {
  const apiKey = DOM.apiKeyInput.value.trim();
  if (!apiKey) { alert('Please enter an API key.'); DOM.apiKeyInput.focus(); return; }
  if (state.selectedIndices.size === 0) { alert('Select at least one problem.'); return; }

  const selectedSorted = [...state.selectedIndices].sort((a, b) => a - b);
  const parallelism    = parseInt(DOM.parallelismSlider.value, 10);
  const maxTokens      = parseInt(DOM.maxTokensInput.value, 10) || 1024;
  const providerId     = DOM.providerSelect.value;
  const modelId        = DOM.modelSelect.value;
  const useCheatsheet  = DOM.useCheatsheetToggle.checked;
  const cheatsheet     = DOM.cheatsheetTextarea.value;

  // Build results array
  state.results = selectedSorted.map(idx => {
    const p = state.problems[idx];
    return {
      problemIdx:  idx,
      eq1:         p.eq1,
      eq2:         p.eq2,
      difficulty:  p.difficulty,
      groundTruth: p.groundTruth,
      prediction:  '',
      correct:     null,
      status:      'pending',
      rawResponse: '',
      errorMsg:    '',
      prompt:      buildPrompt(p, cheatsheet, useCheatsheet),
      elapsed:     null,
      tokens:      null,
      cost:        null,
    };
  });

  state.running = true;
  state.abortController = new AbortController();

  // UI setup
  DOM.resultsEmpty.classList.add('hidden');
  DOM.resultsCards.innerHTML = '';
  DOM.runBtn.disabled  = true;
  DOM.stopBtn.disabled = false;
  setStatusBadge('running', 'RUNNING');
  DOM.evalProgressWrap.classList.remove('hidden');
  updateProgress(0, state.results.length);
  updateStats();

  // Render all cards in pending state
  state.results.forEach((_, i) => createCard(i));

  await runBatch(state.results, providerId, modelId, apiKey, maxTokens, parallelism);

  state.running = false;
  DOM.runBtn.disabled  = state.selectedIndices.size === 0;
  DOM.stopBtn.disabled = true;

  const aborted = state.abortController.signal.aborted;
  setStatusBadge(aborted ? 'idle' : 'done', aborted ? 'STOPPED' : 'DONE');
  DOM.exportCsvBtn.disabled = state.results.length === 0;
}

function stopEvaluation() {
  state.abortController?.abort();
  state.running = false;
  DOM.runBtn.disabled  = state.selectedIndices.size === 0;
  DOM.stopBtn.disabled = true;
  setStatusBadge('idle', 'STOPPED');
}

async function runBatch(results, providerId, modelId, apiKey, maxTokens, parallelism) {
  const signal    = state.abortController.signal;
  const pool      = new Set();
  let   nextIndex = 0;

  const runOne = async (i) => {
    const result = results[i];
    result.status = 'running';
    updateCard(i);

    try {
      const { text, elapsed, tokens, cost } = await callApi(
        providerId, modelId, apiKey, result.prompt, maxTokens, signal
      );
      result.rawResponse = text;
      result.prediction  = extractAnswer(text);
      result.elapsed     = elapsed;
      result.tokens      = tokens;
      result.cost        = cost;
      result.correct     = result.groundTruth
        ? result.prediction === result.groundTruth
        : null;
      result.status = 'done';
    } catch (err) {
      if (err.name === 'AbortError') {
        result.status   = 'skipped';
        result.errorMsg = 'Cancelled';
      } else {
        result.status   = 'error';
        result.errorMsg = err.message || String(err);
        console.error(`Problem #${result.problemIdx + 1} failed:`, err);
      }
    }

    updateCard(i);
    updateStats();
    updateProgress(
      results.filter(r => r.status !== 'pending' && r.status !== 'running').length,
      results.length
    );
  };

  while (nextIndex < results.length || pool.size > 0) {
    if (signal.aborted && pool.size === 0) break;
    while (!signal.aborted && nextIndex < results.length && pool.size < parallelism) {
      const i   = nextIndex++;
      const job = runOne(i).finally(() => pool.delete(job));
      pool.add(job);
    }
    if (pool.size > 0) await Promise.race(pool);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   15. RESULT CARDS
   ═══════════════════════════════════════════════════════════════════════════ */

function createCard(i) {
  const div = document.createElement('div');
  div.id = `card-${i}`;
  DOM.resultsCards.appendChild(div);
  updateCard(i);
}

function updateCard(i) {
  const r   = state.results[i];
  const div = document.getElementById(`card-${i}`);
  if (!div) return;

  const providerId = DOM.providerSelect.value;
  const modelId    = DOM.modelSelect.value;

  // Verdict badge
  let verdictBadgeClass = 'pending';
  let verdictBadgeText  = 'PENDING';
  if (r.status === 'running') {
    verdictBadgeClass = 'running'; verdictBadgeText = 'RUNNING…';
  } else if (r.status === 'skipped') {
    verdictBadgeClass = 'pending'; verdictBadgeText = 'STOPPED';
  } else if (r.status === 'error') {
    verdictBadgeClass = 'error'; verdictBadgeText = 'ERROR';
  } else if (r.status === 'done') {
    if (r.correct === true)  { verdictBadgeClass = 'correct';  verdictBadgeText = 'CORRECT'; }
    else if (r.correct === false) { verdictBadgeClass = 'incorrect'; verdictBadgeText = 'INCORRECT'; }
    else { verdictBadgeClass = 'no-truth'; verdictBadgeText = r.prediction || 'NO ANSWER'; }
  }

  // Card-level border class
  let cardClass = 'result-card';
  if (r.status === 'running' || r.status === 'pending') cardClass += ' status-running';
  if (r.status === 'done' && r.prediction === 'TRUE')  cardClass += ' verdict-true';
  if (r.status === 'done' && r.prediction === 'FALSE') cardClass += ' verdict-false';

  // Metrics
  const timeStr  = r.elapsed != null ? `${(r.elapsed / 1000).toFixed(1)}s` : '—';
  const tokStr   = r.tokens  != null ? String(r.tokens) : '—';
  const costStr  = r.cost    != null ? `$${r.cost.toFixed(4)}` : '$0.0000';
  const predClass = r.prediction === 'TRUE' ? 'green' : r.prediction === 'FALSE' ? 'red' : 'muted';

  // Action buttons enabled only when done
  const done = r.status === 'done' || r.status === 'error';

  div.className = cardClass;
  div.innerHTML = `
    <div class="card-header">
      <span class="card-model-name">${escHtml(`${providerId}/${modelId}`)}</span>
      <span class="card-problem-id">problem #${r.problemIdx + 1}</span>
      <span class="card-verdict-badge ${verdictBadgeClass}">${verdictBadgeText}</span>
    </div>
    <div class="card-equations">
      <span class="card-eq" title="${escHtml(r.eq1)}">${escHtml(r.eq1)}</span>
      <span class="card-eq-arrow">→</span>
      <span class="card-eq" title="${escHtml(r.eq2)}">${escHtml(r.eq2)}</span>
    </div>
    <div class="card-metrics">
      <div class="card-metric">
        <span class="card-metric-val ${predClass}">${r.prediction || '—'}</span>
        <span class="card-metric-label">Output</span>
      </div>
      <div class="card-metric">
        <span class="card-metric-val">${r.groundTruth ? `<span class="${r.groundTruth === 'TRUE' ? 'pred-true' : 'pred-false'}">${r.groundTruth}</span>` : '—'}</span>
        <span class="card-metric-label">Expected</span>
      </div>
      <div class="card-metric">
        <span class="card-metric-val">${costStr}</span>
        <span class="card-metric-label">Cost</span>
      </div>
      <div class="card-metric">
        <span class="card-metric-val">${tokStr}</span>
        <span class="card-metric-label">Tokens</span>
      </div>
      <div class="card-metric">
        <span class="card-metric-val">${timeStr}</span>
        <span class="card-metric-label">Time</span>
      </div>
      <span class="card-difficulty ${r.difficulty}">${r.difficulty}</span>
    </div>
    <div class="card-actions">
      <button class="card-action-btn" ${done ? '' : 'disabled'} onclick="toggleCardDetail(${i}, 'response')">Show response</button>
      <button class="card-action-btn" onclick="showPromptModal(${i})">Show prompt</button>
      <button class="card-action-btn" onclick="showLogModal(${i})" ${done ? '' : 'disabled'}>Full log</button>
    </div>
    <div class="card-detail" id="card-detail-${i}">
      <pre>${r.rawResponse ? escHtml(r.rawResponse) : (r.errorMsg ? escHtml(r.errorMsg) : '…')}</pre>
    </div>
  `;
}

/** Toggles inline response detail on a card */
function toggleCardDetail(i, _type) {
  const detail = document.getElementById(`card-detail-${i}`);
  if (!detail) return;
  detail.classList.toggle('visible');
  // Update button label
  const card = document.getElementById(`card-${i}`);
  const btn  = card?.querySelector('.card-action-btn');
  if (btn) btn.textContent = detail.classList.contains('visible') ? 'Hide response' : 'Show response';
}

/* ═══════════════════════════════════════════════════════════════════════════
   16. STATS UPDATER
   ═══════════════════════════════════════════════════════════════════════════ */

function updateStats() {
  const total   = state.results.length;
  const done    = state.results.filter(r => r.status === 'done').length;
  const errors  = state.results.filter(r => r.status === 'error').length;
  const correct = state.results.filter(r => r.correct === true).length;
  const scorable= state.results.filter(r => r.correct !== null).length;
  const remaining = total - done - errors;

  DOM.statTotal.textContent    = total;
  DOM.statRemaining.textContent= remaining >= 0 ? remaining : '—';
  DOM.statDoneToday.textContent= done;
  DOM.statCorrect.textContent  = correct;
  DOM.statAccuracy.textContent = scorable > 0
    ? `${((correct / scorable) * 100).toFixed(1)}%`
    : '—%';

  // Score banner
  if (scorable >= 5) {
    const pct   = correct / scorable;
    const level = SCORE_THRESHOLDS.find(t => pct >= t.min);
    DOM.scoreInterpretation.textContent = level?.label ?? '';
    DOM.scoreBanner.className = `score-banner ${level?.cls ?? ''}`;
    DOM.scoreBanner.classList.remove('hidden');
  } else {
    DOM.scoreBanner.classList.add('hidden');
  }
}

function updateProgress(done, total) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  DOM.evalProgressFill.style.width = `${pct.toFixed(1)}%`;
  DOM.evalProgressLabel.textContent = `${done} / ${total}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   17. MODALS
   ═══════════════════════════════════════════════════════════════════════════ */

function openModal(domKey) {
  const el = DOM[domKey];
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('visible'));
}

function closeModal(domKey) {
  const el = DOM[domKey];
  el.classList.remove('visible');
  setTimeout(() => el.classList.add('hidden'), 200);
}

/** Show prompt preview modal for result i */
function showPromptModal(i) {
  const r = state.results[i];
  if (!r) return;
  DOM.promptModalContent.textContent = r.prompt || buildPrompt(
    { eq1: r.eq1, eq2: r.eq2 },
    DOM.cheatsheetTextarea.value,
    DOM.useCheatsheetToggle.checked
  );
  openModal('promptModalOverlay');
}

/** Show full raw AI log modal for result i */
function showLogModal(i) {
  const r = state.results[i];
  if (!r) return;
  DOM.logModalTitle.textContent = `Problem #${r.problemIdx + 1} — Raw AI Output`;
  DOM.logModalMeta.innerHTML = `
    <div><strong>Eq1:</strong> ${escHtml(r.eq1)}</div>
    <div><strong>Eq2:</strong> ${escHtml(r.eq2)}</div>
    <div><strong>Prediction:</strong> <span class="${r.prediction === 'TRUE' ? 'pred-true' : r.prediction === 'FALSE' ? 'pred-false' : 'pred-na'}">${r.prediction || 'NO_ANSWER'}</span></div>
    ${r.groundTruth ? `<div><strong>Expected:</strong> <span class="${r.groundTruth === 'TRUE' ? 'pred-true' : 'pred-false'}">${r.groundTruth}</span></div>` : ''}
    ${r.correct !== null ? `<div><strong>Correct:</strong> ${r.correct ? '✓ Yes' : '✗ No'}</div>` : ''}
    ${r.errorMsg ? `<div><strong>Error:</strong> <span style="color:var(--red)">${escHtml(r.errorMsg)}</span></div>` : ''}
  `;
  DOM.logModalContent.textContent = r.rawResponse || '(no response)';
  openModal('logModalOverlay');
}

/* ═══════════════════════════════════════════════════════════════════════════
   18. STATUS BADGE
   ═══════════════════════════════════════════════════════════════════════════ */

function setStatusBadge(badgeState, label) {
  DOM.statusBadge.className = `badge badge-${badgeState}`;
  DOM.statusText.textContent = label;
}

/* ═══════════════════════════════════════════════════════════════════════════
   19. CSV EXPORT
   ═══════════════════════════════════════════════════════════════════════════ */

function exportResultsCsv() {
  if (!state.results.length) return;

  const COLUMNS = [
    'problem_num', 'eq1', 'eq2', 'difficulty',
    'ground_truth', 'prediction', 'correct', 'status',
    'tokens', 'cost', 'elapsed_ms', 'raw_response',
  ];

  const rows = state.results.map(r => [
    r.problemIdx + 1,
    r.eq1, r.eq2, r.difficulty,
    r.groundTruth, r.prediction,
    r.correct === null ? '' : r.correct ? 'TRUE' : 'FALSE',
    r.status,
    r.tokens ?? '',
    r.cost != null ? r.cost.toFixed(6) : '',
    r.elapsed ?? '',
    r.rawResponse.replace(/"/g, '""'),
  ]);

  const csvContent = [COLUMNS, ...rows]
    .map(row => row.map(cell => {
      const s = String(cell ?? '');
      return (s.includes(',') || s.includes('\n') || s.includes('"')) ? `"${s}"` : s;
    }).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `eqthry-results-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════════════════════
   20. UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── End of script.js ─── */



/* ═══════════════════════════════════════════════════════════════════════════
   22. API KEY MANAGER
   ═══════════════════════════════════════════════════════════════════════════ */

state.savedKeys = {};

function initApiKeys() {
  try {
    const saved = localStorage.getItem('eq-api-keys');
    if (saved) state.savedKeys = JSON.parse(saved);
  } catch (_) {
    state.savedKeys = {};
  }
  renderSavedKeys();
}

function wireApiKeys() {
  DOM.saveKeyBtn.addEventListener('click', () => {
    const name = DOM.keyNameInput.value.trim();
    const keyVal = DOM.apiKeyInput.value.trim();
    if (!name || !keyVal) {
      alert("Please provide both a name and an API key to save.");
      return;
    }
    state.savedKeys[name] = keyVal;
    try {
      localStorage.setItem('eq-api-keys', JSON.stringify(state.savedKeys));
    } catch (_) {}
    renderSavedKeys();
    DOM.savedKeysSelect.value = name;
  });

  DOM.loadKeyBtn.addEventListener('click', () => {
    const name = DOM.savedKeysSelect.value;
    if (name && state.savedKeys[name]) {
      DOM.apiKeyInput.value = state.savedKeys[name];
      DOM.keyNameInput.value = name;
    }
  });

  DOM.deleteKeyBtn.addEventListener('click', () => {
    const name = DOM.savedKeysSelect.value;
    if (!name) return;
    if (confirm(`Delete saved key "${name}"?`)) {
      delete state.savedKeys[name];
      try {
        localStorage.setItem('eq-api-keys', JSON.stringify(state.savedKeys));
      } catch (_) {}
      renderSavedKeys();
      DOM.keyNameInput.value = '';
    }
  });
}

function renderSavedKeys() {
  const select = DOM.savedKeysSelect;
  select.innerHTML = '';
  const names = Object.keys(state.savedKeys).sort();
  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- No saved keys --';
    select.appendChild(opt);
    select.disabled = true;
    DOM.loadKeyBtn.disabled = true;
    DOM.deleteKeyBtn.disabled = true;
  } else {
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      select.appendChild(opt);
    });
    select.disabled = false;
    DOM.loadKeyBtn.disabled = false;
    DOM.deleteKeyBtn.disabled = false;
  }
}
