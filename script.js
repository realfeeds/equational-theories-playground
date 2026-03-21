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
  { min: 0.65, label: '> 65% — Excellent — strong cheatsheet content ✨', cls: 'level-excel' },
  { min: 0.59, label: '59–65% — Good — competitive submission range 📈', cls: 'level-good' },
  { min: 0.53, label: '53–58% — Modest improvement — cheatsheet is helping 📊', cls: 'level-modest' },
  { min: 0.50, label: '50–52% — Random — cheatsheet has no measurable effect ─', cls: 'level-random' },
  { min: 0, label: '< 50% — Worse than random — cheatsheet may be harmful ⚠', cls: 'level-below' },
];

/** Matches VERDICT: TRUE or VERDICT: FALSE (case-insensitive, last match wins) */
const ANSWER_REGEX = /VERDICT:\s*(TRUE|FALSE)/gi;

const DEFAULT_PROMPT = `You are a mathematician specializing in equational theories of magmas. Your task is to determine whether Equation 1 ({equation1}) implies Equation 2 ({equation2}) over all magmas.

{cheatsheet}

Output format (use exact headers without any additional text or formatting):
VERDICT: must be exactly TRUE or FALSE (in the same line).
REASONING: must be non-empty.
PROOF: required if VERDICT is TRUE, empty otherwise.
COUNTEREXAMPLE: required if VERDICT is FALSE, empty otherwise.`;

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
  truthFilter: 'all',

  /**
   * Results: one per selected problem run
   * { problemIdx, eq1, eq2, difficulty, groundTruth,
   *   prediction, correct, status, rawResponse, errorMsg, prompt }
   */
  results: [],

  running: false,
  abortController: null,

  activeTab: 'run',
  history: [],
  historyViewingRun: null,
  historyShowFavoritesOnly: false,
  historyCompareMode: false,
  historyCompareSelected: [],
  autoRetryTimeLeft: 0,
};

function getActiveResults() {
  if (state.activeTab === 'history' && state.historyViewingRun) return state.historyViewingRun.results;
  return state.results;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PROVIDER CATALOGUE
   ═══════════════════════════════════════════════════════════════════════════ */

const PROVIDER_CATALOGUE = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-oss-120b', label: 'gpt-oss-120b (Stage 1)' },
      { id: 'o3-mini', label: 'o3-mini' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
    buildBody: (model, messages, maxTokens) => ({ model, messages, max_completion_tokens: maxTokens }),
    extractText: (json) => json?.choices?.[0]?.message?.content ?? '',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    models: [
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
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
      { id: 'grok-3', label: 'Grok 3' },
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
      { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite Preview (Stage 1)' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-pro-exp-0205', label: 'Gemini 2.0 Pro Exp 0205' },
      { id: 'gemini-2.0-flash-thinking-exp-0121', label: 'Gemini 2.0 Flash Thinking Exp' },
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
      { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B Instruct (Stage 1)' },
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
    'parallelism-slider', 'parallelism-value',
    'max-tokens-input',
    'import-csv-btn', 'csv-file-input', 'clear-problems-btn', 'add-custom-btn',
    'problems-status',
    'problem-search', 'filter-pills', 'truth-filter-pills',
    'problem-list', 'bulk-select-input', 'bulk-select-btn',
    'selected-panel', 'selected-count', 'selected-preview',
    'clear-sel-btn', 'select-all-btn',
    'run-btn', 'stop-btn', 'run-count',
    'status-badge', 'status-text',
    'stats-bar',
    'stat-done-today', 'stat-total', 'stat-accuracy',
    'stat-tp', 'stat-tn', 'stat-fp', 'stat-fn',
    'eval-progress-wrap', 'eval-progress-fill', 'eval-progress-label',
    'score-banner', 'score-interpretation',
    'results-area', 'results-empty', 'results-cards',
    'export-csv-btn',
    'tab-run', 'tab-history', 'sidebar-run-view', 'sidebar-history-view',
    'history-list', 'clear-history-btn', 'favorite-filter-btn', 'compare-mode-btn',
    'sidebar', 'main-area', 'auto-retry-checkbox', 'run-three-times-checkbox', 'retry-countdown',
    'history-filters', 'hist-diff-filter', 'hist-correct-filter',
    // Saved API keys
    'saved-keys-select', 'load-key-btn', 'delete-key-btn', 'key-name-input', 'save-key-btn',
    // Cheatsheet
    'open-cheatsheet-btn', 'cheatsheet-modal-overlay', 'cheatsheet-modal-close',
    'saved-cheatsheets-select', 'load-cheatsheet-btn', 'delete-cheatsheet-btn',
    'cheatsheet-name-input', 'save-cheatsheet-btn', 'cheatsheet-modal-textarea',
    // Custom Problem
    'custom-modal-overlay', 'custom-modal-close', 'custom-eq1', 'custom-eq2', 'custom-truth', 'save-custom-btn',
    // Prompts
    'prompt-template-textarea', 'open-prompt-btn', 'prompt-template-modal-overlay', 'prompt-template-modal-close',
    'saved-prompts-select', 'load-prompt-btn', 'delete-prompt-btn', 'prompt-name-input', 'save-prompt-btn',
    'prompt-template-modal-textarea',
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
  DOM.providerSelect.addEventListener('change', () => {
    populateModelSelect(DOM.providerSelect.value);
    try { localStorage.setItem('eq-last-provider', DOM.providerSelect.value); } catch(e) {}
  });
  DOM.modelSelect.addEventListener('change', () => {
    try { localStorage.setItem('eq-last-model', DOM.modelSelect.value); } catch(e) {}
  });
  DOM.toggleKeyBtn.addEventListener('click', () => {
    const inp = DOM.apiKeyInput;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  DOM.cheatsheetTextarea.addEventListener('input', () => {
    DOM.cheatsheetModalTextarea.value = DOM.cheatsheetTextarea.value;
    updateByteCounter();
  });
  DOM.cheatsheetModalTextarea.addEventListener('input', () => {
    DOM.cheatsheetTextarea.value = DOM.cheatsheetModalTextarea.value;
    updateByteCounter();
  });

  DOM.promptTemplateTextarea.addEventListener('input', () => {
    DOM.promptTemplateModalTextarea.value = DOM.promptTemplateTextarea.value;
  });
  DOM.promptTemplateModalTextarea.addEventListener('input', () => {
    DOM.promptTemplateTextarea.value = DOM.promptTemplateModalTextarea.value;
  });

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
    DOM.filterPills.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.difficultyFilter = pill.dataset.filter;
    renderProblemList();
  });
  DOM.truthFilterPills.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    DOM.truthFilterPills.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.truthFilter = pill.dataset.truth;
    renderProblemList();
  });

  // Selection controls
  DOM.bulkSelectBtn.addEventListener('click', () => {
    const input = DOM.bulkSelectInput.value.trim();
    if (!input) return;
    const parts = input.split(',');
    for (const part of parts) {
      const range = part.split('-');
      if (range.length === 1) {
        const idx = parseInt(range[0].trim(), 10) - 1;
        if (!isNaN(idx) && state.problems[idx]) state.selectedIndices.add(idx);
      } else if (range.length === 2) {
        const start = parseInt(range[0].trim(), 10) - 1;
        const end = parseInt(range[1].trim(), 10) - 1;
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.max(0, start); i <= Math.min(state.problems.length - 1, end); i++) {
            state.selectedIndices.add(i);
          }
        }
      }
    }
    DOM.bulkSelectInput.value = '';
    renderProblemList();
    updateSelectionUI();
  });
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
  DOM.runBtn.addEventListener('click', () => startEvaluation(false));
  DOM.stopBtn.addEventListener('click', stopEvaluation);

  // Export
  DOM.exportCsvBtn.addEventListener('click', exportResultsCsv);

  // Modals
  DOM.promptModalClose.addEventListener('click', () => closeModal('promptModalOverlay'));
  DOM.logModalClose.addEventListener('click', () => closeModal('logModalOverlay'));
  DOM.cheatsheetModalClose.addEventListener('click', () => closeModal('cheatsheetModalOverlay'));
  DOM.promptTemplateModalClose.addEventListener('click', () => closeModal('promptTemplateModalOverlay'));
  DOM.customModalClose.addEventListener('click', () => closeModal('customModalOverlay'));
  DOM.promptModalOverlay.addEventListener('click', (e) => { if (e.target === DOM.promptModalOverlay) closeModal('promptModalOverlay'); });
  DOM.logModalOverlay.addEventListener('click', (e) => { if (e.target === DOM.logModalOverlay) closeModal('logModalOverlay'); });
  DOM.cheatsheetModalOverlay.addEventListener('click', (e) => { if (e.target === DOM.cheatsheetModalOverlay) closeModal('cheatsheetModalOverlay'); });
  DOM.promptTemplateModalOverlay.addEventListener('click', (e) => { if (e.target === DOM.promptTemplateModalOverlay) closeModal('promptTemplateModalOverlay'); });
  DOM.customModalOverlay.addEventListener('click', (e) => { if (e.target === DOM.customModalOverlay) closeModal('customModalOverlay'); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('promptModalOverlay');
      closeModal('logModalOverlay');
      closeModal('cheatsheetModalOverlay');
      closeModal('promptTemplateModalOverlay');
      closeModal('customModalOverlay');
    }
  });

  // Tabs
  DOM.tabRun.addEventListener('click', () => switchTab('run'));
  DOM.tabHistory.addEventListener('click', () => switchTab('history'));

  DOM.openCheatsheetBtn.addEventListener('click', () => {
    openModal('cheatsheetModalOverlay');
    DOM.cheatsheetModalTextarea.focus();
  });

  DOM.openPromptBtn.addEventListener('click', () => {
    openModal('promptTemplateModalOverlay');
    DOM.promptTemplateModalTextarea.focus();
  });

  DOM.addCustomBtn.addEventListener('click', () => {
    openModal('customModalOverlay');
    DOM.customEq1.focus();
  });

  DOM.saveCustomBtn.addEventListener('click', () => {
    const eq1 = DOM.customEq1.value.trim();
    const eq2 = DOM.customEq2.value.trim();
    const truth = DOM.customTruth.value;
    if (!eq1 || !eq2) { alert('Please enter both equations.'); return; }
    
    state.problems.push({
      id: `custom_${Date.now()}`,
      index: state.problems.length + 1,
      eq1,
      eq2,
      difficulty: 'custom',
      groundTruth: truth
    });
    
    DOM.customEq1.value = '';
    DOM.customEq2.value = '';
    closeModal('customModalOverlay');
    
    try { localStorage.setItem('eq-problems', JSON.stringify(state.problems)); } catch (e) { }
    showProblemsStatus(`✅ ${state.problems.length} problems loaded`);
    renderProblemList();
    updateSelectionUI();
    updateStats();
  });

  // Saved API keys
  wireApiKeys();

  // Saved Cheatsheets
  wireCheatsheets();

  // Saved Prompts
  wirePrompts();

  // History
  wireHistory();
  
  DOM.histDiffFilter.addEventListener('change', applyHistoryFilters);
  DOM.histCorrectFilter.addEventListener('change', applyHistoryFilters);
  
  DOM.favoriteFilterBtn.addEventListener('click', () => {
    state.historyShowFavoritesOnly = !state.historyShowFavoritesOnly;
    DOM.favoriteFilterBtn.classList.toggle('active', state.historyShowFavoritesOnly);
    renderHistoryList();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. INIT
   ═══════════════════════════════════════════════════════════════════════════ */

function init() {
  cacheDom();
  wireUi();
  populateProviderSelect();

  try {
    const lastProvider = localStorage.getItem('eq-last-provider');
    if (lastProvider && PROVIDER_CATALOGUE[lastProvider]) {
      DOM.providerSelect.value = lastProvider;
    }
  } catch(e) {}

  populateModelSelect(DOM.providerSelect.value);

  try {
    const lastModel = localStorage.getItem('eq-last-model');
    if (lastModel && PROVIDER_CATALOGUE[DOM.providerSelect.value].models.some(m => m.id === lastModel)) {
      DOM.modelSelect.value = lastModel;
    }
  } catch(e) {}

  initApiKeys();
  initCheatsheets();
  initPrompts();
  initHistory();
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
  } catch (e) { }

  try {
    const cStr = localStorage.getItem('eq-cheatsheet');
    if (cStr) {
      DOM.cheatsheetTextarea.value = cStr;
      DOM.cheatsheetModalTextarea.value = cStr;
    }
  } catch (e) { }
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
  const text = DOM.cheatsheetTextarea.value;
  try { localStorage.setItem('eq-cheatsheet', text); } catch (e) { }
  const bytes = new TextEncoder().encode(text).length;
  const pct = bytes / MAX_CHEATSHEET_BYTES;

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
  reader.onload = (e) => parseAndLoadJsonl(e.target.result);
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
  const errors = [];

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
      if (obj.answer === true) groundTruth = 'TRUE';
      else if (obj.answer === false) groundTruth = 'FALSE';
      else groundTruth = String(obj.answer ?? '').toUpperCase();

      problems.push({
        id: obj.id ?? `problem_${lineIdx + 1}`,
        index: obj.index ?? (lineIdx + 1),
        eq1,
        eq2,
        difficulty: difficulty === 'hard' ? 'hard' : 'normal',
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

  try { localStorage.setItem('eq-problems', JSON.stringify(state.problems)); } catch (e) { }

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
  try { localStorage.removeItem('eq-problems'); } catch (e) { }
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
  const q = state.searchQuery.toLowerCase();
  const diff = state.difficultyFilter;
  const truth = state.truthFilter;
  return state.problems
    .map((p, idx) => ({ p, idx }))
    .filter(({ p, idx }) => {
      if (diff !== 'all' && p.difficulty !== diff) return false;
      if (truth !== 'all' && p.groundTruth !== truth) return false;
      if (q) {
        const matchNum = `#${idx + 1}`.includes(q) || String(idx + 1).includes(q);
        const matchEq = p.eq1.toLowerCase().includes(q) || p.eq2.toLowerCase().includes(q);
        if (!matchNum && !matchEq) return false;
      }
      return true;
    });
}

function renderProblemList() {
  const list = DOM.problemList;
  const items = getFilteredProblems();
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
 * Merges the user-provided equations and cheatsheet directly into the Prompt string template
 */
function buildPrompt(problem, cheatsheetText) {
  let pText = DOM.promptTemplateTextarea.value.trim();
  if (!pText) pText = DEFAULT_PROMPT;

  // Truncate cheatsheet to MAX_CHEATSHEET_BYTES
  let cheatsheet = '';
  if (cheatsheetText.trim().length > 0) {
    const enc = new TextEncoder();
    const bytes = enc.encode(cheatsheetText);
    cheatsheet = bytes.length > MAX_CHEATSHEET_BYTES
      ? new TextDecoder().decode(bytes.slice(0, MAX_CHEATSHEET_BYTES))
      : cheatsheetText;
  }

  return pText
    .replace('{equation1}', problem.eq1)
    .replace('{equation2}', problem.eq2)
    .replace('{cheatsheet}', cheatsheet);
}

/* ═══════════════════════════════════════════════════════════════════════════
   12. API CALLER
   ═══════════════════════════════════════════════════════════════════════════ */

async function callApi(providerId, modelId, apiKey, prompt, maxTokens, signal) {
  const provider = PROVIDER_CATALOGUE[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const messages = [{ role: 'user', content: prompt }];
  const body = provider.buildBody(modelId, messages, maxTokens);

  let url = provider.baseUrl.replace('{model}', modelId);
  if (providerId === 'google') url += `?key=${encodeURIComponent(apiKey)}`;

  const headers = { 'Content-Type': 'application/json', ...provider.authHeader(apiKey) };

  const tStart = Date.now();
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
  const usage = json?.usage ?? {};

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

  const cost = estimateCost(modelId, usage);

  return { text, elapsed, tokens, cost };
}

/** Very rough cost estimate in USD */
function estimateCost(modelId, usage) {
  const inTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  if (!inTokens && !outTokens) return null;

  // Approximate per-1k-token prices (USD)
  const PRICES = {
    'gpt-4o': [0.005, 0.015],
    'gpt-4o-mini': [0.00015, 0.0006],
    'gpt-oss-120b': [0.003, 0.009],
    'o3-mini': [0.0011, 0.0044],
    'gpt-4-turbo': [0.01, 0.03],
    'grok-4-fast': [0.002, 0.006],
    'grok-3': [0.003, 0.009],
    'grok-3-mini': [0.0003, 0.0005],
    'default': [0.001, 0.003],
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

async function startEvaluation(isRetry = false) {
  if (state.running) return;
  
  if (state.autoRetryTimer) {
    clearInterval(state.autoRetryTimer);
    state.autoRetryTimer = null;
    DOM.retryCountdown.classList.add('hidden');
  }

  const apiKey = DOM.apiKeyInput.value.trim();
  if (!apiKey) { alert('Please enter an API key.'); DOM.apiKeyInput.focus(); return; }
  if (state.selectedIndices.size === 0) { alert('Select at least one problem.'); return; }

  const selectedSorted = [...state.selectedIndices].sort((a, b) => a - b);
  const parallelism = parseInt(DOM.parallelismSlider.value, 10);
  const maxTokens = parseInt(DOM.maxTokensInput.value, 10) || 1024;
  const providerId = DOM.providerSelect.value;
  const modelId = DOM.modelSelect.value;
  const cheatsheet = DOM.cheatsheetTextarea.value;

  if (!isRetry) {
    const runThreeTimes = DOM.runThreeTimesCheckbox.checked;
    state.results = [];
    selectedSorted.forEach(idx => {
      const p = state.problems[idx];
      const attemptsCount = runThreeTimes ? 3 : 1;
      const attempts = [];
      for (let attempt = 1; attempt <= attemptsCount; attempt++) {
        attempts.push({
          attemptNum: attempt,
          prediction: '',
          correct: null,
          status: 'pending',
          rawResponse: '',
          errorMsg: '',
          elapsed: null,
          tokens: null,
          cost: null,
        });
      }
      state.results.push({
        problemIdx: idx,
        eq1: p.eq1,
        eq2: p.eq2,
        difficulty: p.difficulty,
        groundTruth: p.groundTruth,
        status: 'pending',
        prediction: '',
        correct: null,
        prompt: buildPrompt(p, cheatsheet),
        attempts: attempts
      });
    });
    DOM.resultsEmpty.classList.add('hidden');
    DOM.resultsCards.innerHTML = '';
    state.results.forEach((_, i) => createCard(i));
  } else {
    // Reset any errored results back to pending state for a retry
    state.results.forEach((r, i) => {
      let anyError = false;
      r.attempts.forEach(att => {
        if (att.status === 'error') {
          att.status = 'pending';
          att.errorMsg = '';
          att.rawResponse = '';
          att.correct = null;
          anyError = true;
        }
      });
      if (anyError) {
         r.status = 'pending';
         updateCard(i);
      }
    });
  }

  state.running = true;
  state.abortController = new AbortController();

  // UI setup
  DOM.runBtn.disabled = true;
  DOM.stopBtn.disabled = false;
  setStatusBadge('running', 'RUNNING');
  DOM.evalProgressWrap.classList.remove('hidden');
  updateProgress(
    state.results.filter(r => r.status === 'done' || r.status === 'skipped').length,
    state.results.length
  );
  updateStats();

  await runBatch(state.results, providerId, modelId, apiKey, maxTokens, parallelism);

  state.running = false;
  DOM.runBtn.disabled = state.selectedIndices.size === 0;
  DOM.stopBtn.disabled = true;

  const aborted = state.abortController.signal.aborted;
  setStatusBadge(aborted ? 'idle' : 'done', aborted ? 'STOPPED' : 'DONE');
  DOM.exportCsvBtn.disabled = state.results.length === 0;

  const errors = state.results.filter(r => r.status === 'error');
  if (!aborted && errors.length > 0 && DOM.autoRetryCheckbox.checked) {
    beginAutoRetry();
  } else if (state.results.length > 0) {
    // Only save to history once the entire run is completed without any pending retries.
    saveRunToHistory();
  }
}

function beginAutoRetry() {
  state.autoRetryTimeLeft = 60;
  DOM.retryCountdown.textContent = `${state.autoRetryTimeLeft}s`;
  DOM.retryCountdown.classList.remove('hidden');
  
  state.autoRetryTimer = setInterval(() => {
    state.autoRetryTimeLeft--;
    if (state.autoRetryTimeLeft <= 0) {
      clearInterval(state.autoRetryTimer);
      state.autoRetryTimer = null;
      DOM.retryCountdown.classList.add('hidden');
      startEvaluation(true); // IsRetry = true
    } else {
      DOM.retryCountdown.textContent = `${state.autoRetryTimeLeft}s`;
    }
  }, 1000);
}

function stopEvaluation() {
  if (state.autoRetryTimer) {
    clearInterval(state.autoRetryTimer);
    state.autoRetryTimer = null;
    DOM.retryCountdown.classList.add('hidden');
  }
  state.abortController?.abort();
  state.running = false;
  DOM.runBtn.disabled = state.selectedIndices.size === 0;
  DOM.stopBtn.disabled = true;
  setStatusBadge('idle', 'STOPPED');
}

async function runBatch(results, providerId, modelId, apiKey, maxTokens, parallelism) {
  const signal = state.abortController.signal;
  const pool = new Set();
  let nextIndex = 0;

  const activeTasks = [];
  results.forEach((r, rIdx) => {
    r.attempts.forEach((att, aIdx) => {
      if (att.status === 'pending') {
         activeTasks.push({ rIdx, aIdx });
      }
    });
  });

  const runOne = async (tIdx) => {
    const { rIdx, aIdx } = activeTasks[tIdx];
    const result = results[rIdx];
    const att = result.attempts[aIdx];

    att.status = 'running';
    result.status = 'running';
    updateCard(rIdx);

    try {
      const { text, elapsed, tokens, cost } = await callApi(
        providerId, modelId, apiKey, result.prompt, maxTokens, signal
      );
      att.rawResponse = text;
      att.prediction = extractAnswer(text);
      att.elapsed = elapsed;
      att.tokens = tokens;
      att.cost = cost;
      att.correct = result.groundTruth ? att.prediction === result.groundTruth : null;
      att.status = 'done';
    } catch (err) {
      if (err.name === 'AbortError') {
        att.status = 'skipped';
        att.errorMsg = 'Cancelled';
      } else {
        att.status = 'error';
        att.errorMsg = err.message || String(err);
        console.error(`Problem #${result.problemIdx + 1} attempt ${att.attemptNum} failed:`, err);
      }
    }

    const allDone = result.attempts.every(a => a.status === 'done' || a.status === 'skipped');
    const hasError = result.attempts.some(a => a.status === 'error');
    if (hasError) result.status = 'error';
    else if (allDone) result.status = 'done';
    
    if (result.status === 'done') {
       const trues = result.attempts.filter(a => a.prediction === 'TRUE').length;
       const falses = result.attempts.filter(a => a.prediction === 'FALSE').length;
       result.prediction = trues > falses ? 'TRUE' : (falses > trues ? 'FALSE' : result.attempts[0].prediction);
       result.correct = result.groundTruth ? result.prediction === result.groundTruth : null;
    }

    updateCard(rIdx);
    updateStats();

    let totalAtt = 0;
    let doneAtt = 0;
    results.forEach(r => r.attempts.forEach(a => {
      totalAtt++;
      if (a.status === 'done' || a.status === 'skipped' || a.status === 'error') doneAtt++;
    }));
    updateProgress(doneAtt, totalAtt);
  };

  while (nextIndex < activeTasks.length || pool.size > 0) {
    if (signal.aborted && pool.size === 0) break;
    while (!signal.aborted && nextIndex < activeTasks.length && pool.size < parallelism) {
      const i = nextIndex++;
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
  const r = getActiveResults()[i];
  const div = document.getElementById(`card-${i}`);
  if (!div) return;

  const providerId = DOM.providerSelect.value;
  const modelId = DOM.modelSelect.value;

  // Verdict badge
  let verdictBadgeClass = 'pending';
  let verdictBadgeText = 'PENDING';
  if (r.status === 'running') {
    verdictBadgeClass = 'running'; verdictBadgeText = 'RUNNING…';
  } else if (r.status === 'skipped') {
    verdictBadgeClass = 'pending'; verdictBadgeText = 'STOPPED';
  } else if (r.status === 'error') {
    verdictBadgeClass = 'error'; verdictBadgeText = 'ERROR';
  } else if (r.status === 'done') {
    if (r.correct === true) { verdictBadgeClass = 'correct'; verdictBadgeText = 'CORRECT'; }
    else if (r.correct === false) { verdictBadgeClass = 'incorrect'; verdictBadgeText = 'INCORRECT'; }
    else { verdictBadgeClass = 'no-truth'; verdictBadgeText = r.prediction || 'NO ANSWER'; }
  }

  // Card-level border class
  let cardClass = 'result-card';
  if (r.status === 'running' || r.status === 'pending') cardClass += ' status-running';
  if (r.status === 'done' && r.correct === true) cardClass += ' correct-true';
  if (r.status === 'done' && r.correct === false) cardClass += ' correct-false';

  // Metrics
  const timeStr = r.attempts.map(a => a.elapsed != null ? `${(a.elapsed/1000).toFixed(1)}s` : '—').join(' | ');
  const tokStr = r.attempts.map(a => a.tokens != null ? String(a.tokens) : '—').join(' | ');
  const predStr = r.attempts.map(a => `<span class="${a.prediction === 'TRUE' ? 'pred-true' : a.prediction === 'FALSE' ? 'pred-false' : 'pred-na'}">${a.prediction || '—'}</span>`).join('<span style="color:var(--text-3); margin:0 4px;">|</span>');

  // Action buttons enabled only when done
  const done = r.status === 'done' || r.status === 'error';

  div.className = cardClass;
  div.innerHTML = `
    <div class="card-header">
      <span class="card-model-name">${escHtml(`${providerId}/${modelId}`)}</span>
      <span class="card-problem-id">problem #${r.problemIdx + 1}${r.attempts.length > 1 ? ' (3x)' : ''}</span>
      <span class="card-verdict-badge ${verdictBadgeClass}">${verdictBadgeText}</span>
    </div>
    <div class="card-equations">
      <span class="card-eq" title="${escHtml(r.eq1)}">${escHtml(r.eq1)}</span>
      <span class="card-eq-arrow">→</span>
      <span class="card-eq" title="${escHtml(r.eq2)}">${escHtml(r.eq2)}</span>
    </div>
    <div class="card-metrics">
      <div class="card-metric">
        <span class="card-metric-val" style="display:flex; align-items:center;">${predStr}</span>
        <span class="card-metric-label">Output</span>
      </div>
      <div class="card-metric">
        <span class="card-metric-val">${r.groundTruth ? `<span class="${r.groundTruth === 'TRUE' ? 'pred-true' : 'pred-false'}">${r.groundTruth}</span>` : '—'}</span>
        <span class="card-metric-label">Expected</span>
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
      <pre>${r.attempts.map(a => (r.attempts.length > 1 ? `=== ATTEMPT ${a.attemptNum} ===\n` : '') + (a.rawResponse ? escHtml(a.rawResponse) : (a.errorMsg ? escHtml(a.errorMsg) : '…'))).join('\n\n')}</pre>
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
  const btn = card?.querySelector('.card-action-btn');
  if (btn) btn.textContent = detail.classList.contains('visible') ? 'Hide response' : 'Show response';
}

/* ═══════════════════════════════════════════════════════════════════════════
   16. STATS UPDATER
   ═══════════════════════════════════════════════════════════════════════════ */

function updateStats() {
  const activeRes = getActiveResults();
  const total = activeRes.length;
  const done = activeRes.filter(r => r.status === 'done').length;
  const errors = activeRes.filter(r => r.status === 'error').length;
  const correct = activeRes.filter(r => r.correct === true).length;
  const scorable = activeRes.filter(r => r.correct !== null).length;
  const remaining = total - done - errors;

  const tp = activeRes.filter(r => r.groundTruth === 'TRUE' && r.prediction === 'TRUE').length;
  const tn = activeRes.filter(r => r.groundTruth === 'FALSE' && r.prediction === 'FALSE').length;
  const fp = activeRes.filter(r => r.groundTruth === 'FALSE' && r.prediction === 'TRUE').length;
  const fn = activeRes.filter(r => r.groundTruth === 'TRUE' && r.prediction === 'FALSE').length;

  DOM.statTotal.textContent = total;
  DOM.statDoneToday.textContent = done;
  DOM.statAccuracy.textContent = scorable > 0
    ? `${((correct / scorable) * 100).toFixed(1)}%`
    : '—%';

  DOM.statTp.textContent = tp;
  DOM.statTn.textContent = tn;
  DOM.statFp.textContent = fp;
  DOM.statFn.textContent = fn;

  // Score banner
  if (scorable >= 5) {
    const pct = correct / scorable;
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
  const r = getActiveResults()[i];
  if (!r) return;
  DOM.promptModalContent.textContent = r.prompt || buildPrompt(
    { eq1: r.eq1, eq2: r.eq2 },
    DOM.cheatsheetTextarea.value
  );
  openModal('promptModalOverlay');
}

/** Show full raw AI log modal for result i */
function showLogModal(i) {
  const r = getActiveResults()[i];
  if (!r) return;
  DOM.logModalTitle.textContent = `Problem #${r.problemIdx + 1} — Raw AI Output`;
  DOM.logModalMeta.innerHTML = `
    <div><strong>Eq1:</strong> ${escHtml(r.eq1)}</div>
    <div><strong>Eq2:</strong> ${escHtml(r.eq2)}</div>
    <div><strong>Overall Prediction:</strong> <span class="${r.prediction === 'TRUE' ? 'pred-true' : r.prediction === 'FALSE' ? 'pred-false' : 'pred-na'}">${r.prediction || 'NO_ANSWER'}</span></div>
    ${r.groundTruth ? `<div><strong>Expected:</strong> <span class="${r.groundTruth === 'TRUE' ? 'pred-true' : 'pred-false'}">${r.groundTruth}</span></div>` : ''}
    ${r.correct !== null ? `<div><strong>Correct:</strong> ${r.correct ? '✓ Yes' : '✗ No'}</div>` : ''}
  `;
  
  let content = '';
  r.attempts.forEach(att => {
     if (r.attempts.length > 1) content += `=== ATTEMPT ${att.attemptNum} ===\n`;
     content += (att.rawResponse || (att.errorMsg ? 'Error: ' + att.errorMsg : '(no response)')) + '\n\n';
  });
  
  DOM.logModalContent.textContent = content.trim();
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
  const activeRes = getActiveResults();
  if (!activeRes.length) return;

  const COLUMNS = [
    'problem_num', 'eq1', 'eq2', 'attempt', 'difficulty',
    'true_answer', 'verdict', 'reasoning', 'proof', 'counterexample',
    'status', 'tokens', 'cost', 'elapsed_ms', 'raw_response',
  ];

  function extractSection(text, header) {
    if (!text) return '';
    const hdrs = 'VERDICT|REASONING|PROOF|COUNTEREXAMPLE';
    const regex = new RegExp(`(?:^|\\n)[#\\s\\*]*${header}[\\*\\s]*:[\\s\\*]*([\\s\\S]*?)(?=(?:\\r?\\n)[#\\s\\*]*(?:${hdrs})[\\*\\s]*:|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  }

  const rows = [];
  activeRes.forEach(r => {
    r.attempts.forEach((att) => {
      const reasoning = extractSection(att.rawResponse, 'REASONING');
      const proof = extractSection(att.rawResponse, 'PROOF');
      const counterexample = extractSection(att.rawResponse, 'COUNTEREXAMPLE');
      
      rows.push([
        r.problemIdx + 1,
        r.eq1, r.eq2, att.attemptNum || 1, r.difficulty,
        r.groundTruth, att.prediction, reasoning, proof, counterexample,
        att.status,
        att.tokens ?? '',
        att.cost != null ? att.cost.toFixed(6) : '',
        att.elapsed ?? '',
        att.rawResponse,
      ]);
    });
  });

  const csvContent = [COLUMNS, ...rows]
    .map(row => row.map(cell => {
      const s = String(cell ?? '');
      return (s.includes(',') || s.includes('\n') || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');

  const promptName = DOM.promptNameInput?.value.trim() || 'CustomPrompt';
  let runNamePart = DOM.modelSelect.value;
  if (state.activeTab === 'history' && state.historyViewingRun) {
    runNamePart = state.historyViewingRun.runName || state.historyViewingRun.modelId;
  }
  const dateStr = new Date().toISOString().split('T')[0];

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${promptName}_${runNamePart.replace(/[\/\\?%*:|"<>\\]/g, '-')}_${dateStr}.csv`;
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
    } catch (_) { }
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
      } catch (_) { }
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

/* ═══════════════════════════════════════════════════════════════════════════
   23. CHEATSHEETS MANAGER
   ═══════════════════════════════════════════════════════════════════════════ */

state.savedCheatsheets = {};

function initCheatsheets() {
  try {
    const saved = localStorage.getItem('eq-saved-cheatsheets');
    if (saved) state.savedCheatsheets = JSON.parse(saved);
  } catch (_) {
    state.savedCheatsheets = {};
  }
  renderSavedCheatsheets();
}

function wireCheatsheets() {
  DOM.saveCheatsheetBtn.addEventListener('click', () => {
    const name = DOM.cheatsheetNameInput.value.trim();
    const content = DOM.cheatsheetTextarea.value;
    if (!name) {
      alert("Please provide a name to save the cheatsheet.");
      return;
    }
    state.savedCheatsheets[name] = content;
    try {
      localStorage.setItem('eq-saved-cheatsheets', JSON.stringify(state.savedCheatsheets));
    } catch (_) { }
    renderSavedCheatsheets();
    DOM.savedCheatsheetsSelect.value = name;
  });

  DOM.loadCheatsheetBtn.addEventListener('click', () => {
    const name = DOM.savedCheatsheetsSelect.value;
    if (name && state.savedCheatsheets[name] !== undefined) {
      DOM.cheatsheetTextarea.value = state.savedCheatsheets[name];
      DOM.cheatsheetModalTextarea.value = state.savedCheatsheets[name];
      DOM.cheatsheetNameInput.value = name;
      updateByteCounter();
    }
  });

  DOM.deleteCheatsheetBtn.addEventListener('click', () => {
    const name = DOM.savedCheatsheetsSelect.value;
    if (!name) return;
    if (confirm(`Delete saved cheatsheet "${name}"?`)) {
      delete state.savedCheatsheets[name];
      try {
        localStorage.setItem('eq-saved-cheatsheets', JSON.stringify(state.savedCheatsheets));
      } catch (_) { }
      renderSavedCheatsheets();
      DOM.cheatsheetNameInput.value = '';
    }
  });
}

function renderSavedCheatsheets() {
  const select = DOM.savedCheatsheetsSelect;
  select.innerHTML = '';
  const names = Object.keys(state.savedCheatsheets).sort();
  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- No saved cheatsheets --';
    select.appendChild(opt);
    select.disabled = true;
    DOM.loadCheatsheetBtn.disabled = true;
    DOM.deleteCheatsheetBtn.disabled = true;
  } else {
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      select.appendChild(opt);
    });
    select.disabled = false;
    DOM.loadCheatsheetBtn.disabled = false;
    DOM.deleteCheatsheetBtn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   24. PROMPTS MANAGER
   ═══════════════════════════════════════════════════════════════════════════ */

state.savedPrompts = {};

function initPrompts() {
  try {
    const saved = localStorage.getItem('eq-saved-prompts');
    if (saved) state.savedPrompts = JSON.parse(saved);
  } catch (_) {
    state.savedPrompts = {};
  }
  
  if (!state.savedPrompts['official1']) {
    state.savedPrompts['official1'] = DEFAULT_PROMPT;
    try { localStorage.setItem('eq-saved-prompts', JSON.stringify(state.savedPrompts)); } catch (e) {}
  }
  
  const current = localStorage.getItem('eq-current-prompt') || DEFAULT_PROMPT;
  DOM.promptTemplateTextarea.value = current;
  DOM.promptTemplateModalTextarea.value = current;

  renderSavedPrompts();
}

function wirePrompts() {
  DOM.promptTemplateTextarea.addEventListener('input', () => {
    try { localStorage.setItem('eq-current-prompt', DOM.promptTemplateTextarea.value); } catch(e) {}
  });

  DOM.savePromptBtn.addEventListener('click', () => {
    const name = DOM.promptNameInput.value.trim();
    const content = DOM.promptTemplateTextarea.value;
    if (!name) {
      alert("Please provide a name to save the prompt.");
      return;
    }
    state.savedPrompts[name] = content;
    try {
      localStorage.setItem('eq-saved-prompts', JSON.stringify(state.savedPrompts));
    } catch (_) { }
    renderSavedPrompts();
    DOM.savedPromptsSelect.value = name;
  });

  DOM.loadPromptBtn.addEventListener('click', () => {
    const name = DOM.savedPromptsSelect.value;
    if (name && state.savedPrompts[name] !== undefined) {
      DOM.promptTemplateTextarea.value = state.savedPrompts[name];
      DOM.promptTemplateModalTextarea.value = state.savedPrompts[name];
      DOM.promptNameInput.value = name;
      try { localStorage.setItem('eq-current-prompt', state.savedPrompts[name]); } catch(e) {}
    }
  });

  DOM.deletePromptBtn.addEventListener('click', () => {
    const name = DOM.savedPromptsSelect.value;
    if (!name) return;
    if (name === 'official1') {
      alert("Cannot delete the official1 default prompt.");
      return;
    }
    if (confirm(`Delete saved prompt "${name}"?`)) {
      delete state.savedPrompts[name];
      try {
        localStorage.setItem('eq-saved-prompts', JSON.stringify(state.savedPrompts));
      } catch (_) { }
      renderSavedPrompts();
      DOM.promptNameInput.value = '';
    }
  });
}

function renderSavedPrompts() {
  const select = DOM.savedPromptsSelect;
  select.innerHTML = '';
  const names = Object.keys(state.savedPrompts).sort();
  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- No saved prompts --';
    select.appendChild(opt);
    select.disabled = true;
    DOM.loadPromptBtn.disabled = true;
    DOM.deletePromptBtn.disabled = true;
  } else {
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      select.appendChild(opt);
    });
    select.disabled = false;
    DOM.loadPromptBtn.disabled = false;
    DOM.deletePromptBtn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   25. HISTORY MANAGER
   ═══════════════════════════════════════════════════════════════════════════ */

function switchTab(tab) {
  state.activeTab = tab;
  DOM.tabRun.classList.toggle('active', tab === 'run');
  DOM.tabHistory.classList.toggle('active', tab === 'history');
  
  if (tab === 'run') {
    DOM.sidebarRunView.classList.remove('hidden');
    DOM.sidebarHistoryView.classList.add('hidden');
    DOM.historyFilters.classList.add('hidden');
    // If we're not running, restore state.results to the screen
    if (!state.running && state.results.length > 0) {
      renderActiveResults();
    } else {
      // either running or empty
      DOM.evalProgressWrap.classList.toggle('hidden', state.results.length === 0);
      DOM.scoreBanner.classList.toggle('hidden', state.results.length === 0);
      updateStats();
    }
  } else {
    DOM.sidebarRunView.classList.add('hidden');
    DOM.sidebarHistoryView.classList.remove('hidden');
    DOM.evalProgressWrap.classList.add('hidden');
    DOM.scoreBanner.classList.add('hidden');
    DOM.historyFilters.classList.remove('hidden');
    
    // Clear out run view or show a prompt
    renderHistoryList();
    if (state.history.length === 0) {
      DOM.resultsCards.innerHTML = '';
      DOM.resultsEmpty.classList.remove('hidden');
      DOM.resultsEmpty.innerHTML = `
        <div class="results-empty-icon">🕒</div>
        <p>No past runs found in History.</p>
      `;
    } else {
      // Check if we are already viewing a run
      if (!state.historyViewingRun) {
         DOM.resultsCards.innerHTML = '';
         DOM.resultsEmpty.classList.remove('hidden');
         DOM.resultsEmpty.innerHTML = `
           <div class="results-empty-icon">🕒</div>
           <p>Select a local run from the left sidebar to view past metrics and raw outputs.</p>
         `;
      } else {
         renderActiveResults();
      }
    }
  }
}

function renderActiveResults() {
  DOM.resultsEmpty.classList.add('hidden');
  DOM.resultsCards.innerHTML = '';
  // Redraw stats based on getActiveResults
  updateStats();
  
  const results = getActiveResults();
  if (results.length === 0) {
    DOM.resultsEmpty.classList.remove('hidden');
    return;
  }
  
  results.forEach((_, i) => createCard(i));
  
  applyHistoryFilters();
  
  // Call interpretation manually
  const total = results.length;
  const correct = results.filter(r => r.correct === true).length;
  const scorable = results.filter(r => r.correct !== null).length;
  if(scorable > 0) {
    const acc = correct / scorable;
    let text = '';
    const pct = (acc * 100).toFixed(1);
    const scoreObj = SCORE_THRESHOLDS.find(t => acc >= t.min);
    if (scoreObj) {
      text = `<span class="${scoreObj.cls}">Expected submission score ≈ ${pct}%</span> <span class="dim">| ${scoreObj.label}</span>`;
    } else {
      text = `<span class="level-below">Score ≈ ${pct}% </span> <span class="dim">| < 50%</span>`;
    }
    DOM.scoreInterpretation.innerHTML = text;
    DOM.scoreBanner.classList.remove('hidden');
  } else {
    DOM.scoreBanner.classList.add('hidden');
  }
}

function applyHistoryFilters() {
  if (state.activeTab !== 'history') return;
  const diff = DOM.histDiffFilter.value;
  const corr = DOM.histCorrectFilter.value;
  const results = getActiveResults();
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const card = document.getElementById(`card-${i}`);
    if (!card) continue;
    let show = true;
    if (diff !== 'all' && r.difficulty !== diff) show = false;
    if (corr === 'correct' && r.correct !== true) show = false;
    if (corr === 'incorrect' && r.correct !== false) show = false;
    if (corr === 'none' && r.correct !== null) show = false;
    card.style.display = show ? '' : 'none';
  }
}

function initHistory() {
  try {
    const saved = localStorage.getItem('eq-history');
    if (saved) state.history = JSON.parse(saved);
  } catch (_) {
    state.history = [];
  }
}

function wireHistory() {
  DOM.clearHistoryBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to clear your entire run history?")) {
      state.history = [];
      state.historyViewingRun = null;
      try { localStorage.setItem('eq-history', JSON.stringify(state.history)); } catch (e) {}
      renderHistoryList();
      switchTab('history'); // forces empty screen refresh
    }
  });

  DOM.compareModeBtn.addEventListener('click', () => {
    state.historyCompareMode = !state.historyCompareMode;
    DOM.compareModeBtn.classList.toggle('active', state.historyCompareMode);
    if (!state.historyCompareMode) {
      state.historyCompareSelected = [];
      if (state.historyViewingRun) {
        renderActiveResults();
      } else {
        DOM.resultsEmpty.classList.remove('hidden');
        DOM.resultsEmpty.innerHTML = `<div class="results-empty-icon">🕒</div><p>Select a local run from the left sidebar to view past metrics and raw outputs.</p>`;
        DOM.resultsCards.innerHTML = '';
        DOM.scoreBanner.classList.add('hidden');
      }
    } else {
      DOM.resultsCards.innerHTML = '';
      DOM.scoreBanner.classList.add('hidden');
      DOM.resultsEmpty.classList.remove('hidden');
      DOM.resultsEmpty.innerHTML = `<div class="results-empty-icon">⚖️</div><p>Select two runs from the sidebar to compare them (0/2).</p>`;
      state.historyViewingRun = null;
    }
    renderHistoryList();
  });
}

function saveRunToHistory() {
  // Build a compact run object
  const total = state.results.length;
  const correct = state.results.filter(r => r.correct === true).length;
  const scorable = state.results.filter(r => r.correct !== null).length;
  const accuracy = scorable > 0 ? (correct / scorable) : 0;
  
  const providerId = DOM.providerSelect.value;
  const modelId = DOM.modelSelect.value;
  let cheatsheetName = DOM.savedCheatsheetsSelect.value || (DOM.cheatsheetTextarea.value.trim() ? "Custom" : "None");
  // Clean ' / ' if anything existed in earlier formats, just keep simple alphanumeric prefixes where possible, but it shouldn't matter.
  
  let nextNum = 1;
  const prefix = cheatsheetName + '_';
  state.history.forEach(r => {
    if (r.runName && r.runName.startsWith(prefix)) {
      const num = parseInt(r.runName.substring(prefix.length), 10);
      if (!isNaN(num) && num >= nextNum) {
        nextNum = num + 1;
      }
    }
  });
  const defaultRunName = `${cheatsheetName}_${nextNum}`;

  const runObj = {
    id: 'run_' + Date.now(),
    timestamp: Date.now(),
    modelId: modelId,
    runName: defaultRunName,
    cheatsheetName: cheatsheetName,
    accuracy: accuracy,
    scorable: scorable,
    total: total,
    results: JSON.parse(JSON.stringify(state.results)),
    favorite: false
  };
  
  state.history.unshift(runObj);
  
  let nonFavCount = state.history.filter(r => !r.favorite).length;
  while (nonFavCount > 50) {
    for (let i = state.history.length - 1; i >= 0; i--) {
      if (!state.history[i].favorite) {
        state.history.splice(i, 1);
        nonFavCount--;
        break;
      }
    }
  }
  
  try {
    localStorage.setItem('eq-history', JSON.stringify(state.history));
  } catch (e) {
    console.error("Failed to save history:", e);
  }
}

function renderHistoryList() {
  const list = DOM.historyList;
  list.innerHTML = '';
  
  const runsToShow = state.historyShowFavoritesOnly 
    ? state.history.filter(run => run.favorite) 
    : state.history;

  if (runsToShow.length === 0) {
    list.innerHTML = `<div class="history-empty" style="color:var(--text-3); font-size:0.8rem; text-align:center; padding:20px 0;">No history yet.</div>`;
    return;
  }
  
  runsToShow.forEach(run => {
    const div = document.createElement('div');
    div.className = 'history-item';
    
    if (!state.historyCompareMode && state.historyViewingRun && state.historyViewingRun.id === run.id) {
      div.classList.add('active');
    }
    if (state.historyCompareMode && state.historyCompareSelected.includes(run.id)) {
      div.classList.add('active');
    }
    
    const d = new Date(run.timestamp);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const pct = run.scorable > 0 ? (run.accuracy * 100).toFixed(1) + '%' : '—';
    
    const cbHtml = state.historyCompareMode ? `<input type="checkbox" class="compare-cb" data-id="${run.id}" ${state.historyCompareSelected.includes(run.id) ? 'checked' : ''} style="margin-right: 6px; cursor: pointer;" />` : '';
    const nameStr = escHtml(run.runName || run.modelId);

    div.innerHTML = `
      <div style="display:flex; justify-content: space-between; align-items: flex-start;">
        <div style="display:flex; align-items:flex-start;">
          ${cbHtml}
          <div class="history-title" style="margin-bottom:0; line-height: 1.2;">${nameStr}</div>
          <button class="icon-btn edit-name-btn" style="font-size:0.9rem; margin-left:4px; margin-top:-2px; padding:0; color:var(--text-3); background:none; border:none; cursor:pointer;" title="Edit name">✎</button>
        </div>
        <div style="display:flex; gap: 4px;">
          <button class="icon-btn fav-btn" style="font-size:1.1rem; padding:0; line-height:1; color:${run.favorite ? 'gold' : 'var(--text-3)'}; border:none; background:transparent; cursor:pointer;" aria-label="Favorite">★</button>
          <button class="icon-btn del-btn" style="font-size:1.1rem; padding:0; line-height:1; color:var(--text-3); border:none; background:transparent; cursor:pointer;" aria-label="Delete">✕</button>
        </div>
      </div>
      <div style="font-size: 0.72rem; color: var(--text-3); margin-top: 4px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">📄 ${escHtml(run.cheatsheetName || 'Unknown')}</div>
      <div class="history-meta">
        <span>${dateStr}</span>
        <span style="color: ${run.accuracy >= 0.53 ? 'var(--green)' : 'var(--text-2)'}; font-weight:600;">${pct}</span>
      </div>
    `;
    
    const favBtn = div.querySelector('.fav-btn');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      run.favorite = !run.favorite;
      try { localStorage.setItem('eq-history', JSON.stringify(state.history)); } catch (e) {}
      renderHistoryList();
    });

    const editBtn = div.querySelector('.edit-name-btn');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt("Enter new run name:", run.runName || run.modelId);
      if (newName !== null && newName.trim() !== "") {
        run.runName = newName.trim();
        try { localStorage.setItem('eq-history', JSON.stringify(state.history)); } catch (e) {}
        renderHistoryList();
        if (!state.historyCompareMode && state.historyViewingRun && state.historyViewingRun.id === run.id) renderActiveResults();
      }
    });

    const delBtn = div.querySelector('.del-btn');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Delete this history run?')) {
        state.history = state.history.filter(r => r.id !== run.id);
        if (state.historyViewingRun && state.historyViewingRun.id === run.id) {
          state.historyViewingRun = null;
          DOM.resultsEmpty.classList.remove('hidden');
          DOM.resultsEmpty.innerHTML = `<div class="results-empty-icon">🕒</div><p>Select a local run from the left sidebar to view past metrics and raw outputs.</p>`;
          DOM.resultsCards.innerHTML = '';
          updateStats();
        }
        try { localStorage.setItem('eq-history', JSON.stringify(state.history)); } catch (e) {}
        renderHistoryList();
      }
    });

    if (state.historyCompareMode) {
      const cb = div.querySelector('.compare-cb');
      cb.addEventListener('change', (e) => {
         if (e.target.checked) {
            if (state.historyCompareSelected.length >= 2) {
               e.target.checked = false;
               alert("You can only compare 2 runs at a time.");
               return;
            }
            state.historyCompareSelected.push(run.id);
         } else {
            state.historyCompareSelected = state.historyCompareSelected.filter(id => id !== run.id);
         }
         
         if (state.historyCompareSelected.length === 2) {
            const r1 = state.history.find(r => r.id === state.historyCompareSelected[0]);
            const r2 = state.history.find(r => r.id === state.historyCompareSelected[1]);
            renderCompareView(r1, r2);
         } else {
            DOM.resultsCards.innerHTML = '';
            DOM.scoreBanner.classList.add('hidden');
            DOM.resultsEmpty.classList.remove('hidden');
            DOM.resultsEmpty.innerHTML = `<div class="results-empty-icon">⚖️</div><p>Select one more run from the sidebar to compare (${state.historyCompareSelected.length}/2).</p>`;
         }
         renderHistoryList();
      });
      
      div.addEventListener('click', (e) => {
         if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
         cb.click();
      });
    } else {
      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        state.historyViewingRun = run;
        renderHistoryList(); 
        renderActiveResults();
      });
    }

    list.appendChild(div);
  });
}

// ====== COMPARE RENDER ======

function renderCompareView(runA, runB) {
  DOM.resultsEmpty.classList.add('hidden');
  DOM.resultsCards.innerHTML = '';
  
  const aMap = new Map();
  runA.results.forEach(r => aMap.set(r.problemIdx, r));
  const bMap = new Map();
  runB.results.forEach(r => bMap.set(r.problemIdx, r));

  const commonIndices = Array.from(aMap.keys()).filter(idx => bMap.has(idx)).sort((a,b)=>a-b);

  if (commonIndices.length === 0) {
    DOM.resultsEmpty.classList.remove('hidden');
    DOM.resultsEmpty.innerHTML = `<div class="results-empty-icon">Ø</div><p>No common problems found between these two runs.</p>`;
    return;
  }

  let bothCorrect = 0, aBetter = 0, bBetter = 0, bothWrong = 0;
  commonIndices.forEach(idx => {
    const resA = aMap.get(idx);
    const resB = bMap.get(idx);
    const aCorr = resA.correct === true;
    const bCorr = resB.correct === true;
    if (aCorr && bCorr) bothCorrect++;
    else if (aCorr && !bCorr) aBetter++;
    else if (!aCorr && bCorr) bBetter++;
    else bothWrong++;
  });

  DOM.scoreBanner.classList.remove('hidden', 'level-excel', 'level-good', 'level-modest', 'level-random', 'level-below');
  DOM.scoreBanner.className = 'score-banner';
  DOM.scoreInterpretation.innerHTML = `
    <strong>Comparison:</strong> 
    <span style="color:var(--green)">Both Correct: ${bothCorrect}</span> <span class="dim">|</span> 
    <span style="color:var(--cyan)">${escHtml(runA.modelId)} Better: ${aBetter}</span> <span class="dim">|</span> 
    <span style="color:var(--cyan)">${escHtml(runB.modelId)} Better: ${bBetter}</span> <span class="dim">|</span> 
    <span style="color:var(--red)">Both Wrong: ${bothWrong}</span>
  `;

  const frag = document.createDocumentFragment();
  commonIndices.forEach(idx => {
    const resA = aMap.get(idx);
    const resB = bMap.get(idx);
    frag.appendChild(createCompareCard(resA, resB, runA.modelId, runB.modelId));
  });
  DOM.resultsCards.appendChild(frag);

  DOM.statTotal.textContent = commonIndices.length;
  DOM.statDoneToday.textContent = '—';
  DOM.statAccuracy.textContent = '—';
  DOM.statTp.textContent = '—';
  DOM.statTn.textContent = '—';
  DOM.statFp.textContent = '—';
  DOM.statFn.textContent = '—';
}

function createCompareCard(resA, resB, nameA, nameB) {
  const div = document.createElement('div');
  div.className = 'result-card comparison-card';

  const formatAtt = (r) => {
    if(!r.attempts) return `<span class="${r.prediction === 'TRUE' ? 'pred-true' : r.prediction === 'FALSE' ? 'pred-false' : 'pred-na'}">${r.prediction || '—'}</span>`;
    return r.attempts.map(a => `<span class="${a.prediction === 'TRUE' ? 'pred-true' : a.prediction === 'FALSE' ? 'pred-false' : 'pred-na'}">${a.prediction || '—'}</span>`).join('<span style="color:var(--text-3); margin:0 4px;">|</span>');
  };
  const formatTime = (r) => {
    if(!r.attempts) return r.elapsed != null ? `${(r.elapsed/1000).toFixed(1)}s` : '—';
    return r.attempts.map(a => a.elapsed != null ? `${(a.elapsed/1000).toFixed(1)}s` : '—').join(' | ');
  };

  const getVerdictBadge = (r) => {
    if (r.correct === true) return '<span class="card-verdict-badge correct">CORRECT</span>';
    if (r.correct === false) return '<span class="card-verdict-badge incorrect">INCORRECT</span>';
    return `<span class="card-verdict-badge no-truth">${r.prediction || 'NO ANSWER'}</span>`;
  };

  div.innerHTML = `
    <div class="card-header" style="flex-wrap: wrap;">
      <span class="card-problem-id" style="min-width: 100%;">Problem #${resA.problemIdx + 1}</span>
    </div>
    <div class="card-equations">
      <span class="card-eq" title="${escHtml(resA.eq1)}">${escHtml(resA.eq1)}</span>
      <span class="card-eq-arrow">→</span>
      <span class="card-eq" title="${escHtml(resA.eq2)}">${escHtml(resA.eq2)}</span>
      <span class="card-difficulty ${resA.difficulty}" style="margin-left:auto">${resA.difficulty}</span>
    </div>
    
    <div style="display:flex; gap: 10px; margin-top: 10px;">
      <div style="flex: 1; border: 1px solid var(--border); border-radius: 4px; padding: 8px;">
        <div style="font-size: 0.75rem; font-weight: 600; margin-bottom: 4px; color: var(--text-2); display:flex; justify-content:space-between;">
           <span>A: ${escHtml(nameA)}</span>
           ${getVerdictBadge(resA)}
        </div>
        <div style="font-size: 0.8rem; margin-bottom: 2px;"><strong>Output:</strong> <span style="display:inline-flex; align-items:center;">${formatAtt(resA)}</span></div>
        <div style="font-size: 0.8rem; color: var(--text-3);"><strong>Time:</strong> ${formatTime(resA)}</div>
      </div>
      <div style="flex: 1; border: 1px solid var(--border); border-radius: 4px; padding: 8px;">
        <div style="font-size: 0.75rem; font-weight: 600; margin-bottom: 4px; color: var(--text-2); display:flex; justify-content:space-between;">
           <span>B: ${escHtml(nameB)}</span>
           ${getVerdictBadge(resB)}
        </div>
        <div style="font-size: 0.8rem; margin-bottom: 2px;"><strong>Output:</strong> <span style="display:inline-flex; align-items:center;">${formatAtt(resB)}</span></div>
        <div style="font-size: 0.8rem; color: var(--text-3);"><strong>Time:</strong> ${formatTime(resB)}</div>
      </div>
    </div>
  `;
  return div;
}

