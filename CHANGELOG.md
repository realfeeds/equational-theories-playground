# Changelog

All notable changes to the Equational Theories Playground will be documented in this file.

## v1.2.2
- **Editable History Runs:** Users can now cleanly rename their saved past runs directly within the History sidebar by clicking the edit icon. This custom run name is now natively used as the identifier filename when exporting that run to CSV.
- Automatic history run names now robustly default to appending auto-incrementing suffixes to the active cheatsheet (`CheatsheetName_1`, `CheatsheetName_2`, etc.).
- **Feature Checkbox:** Added "Run 3x" toggle to compute multiple attempts sequentially. This evaluates a majority-vote verdict per problem, neatly rendering all three model responses chronologically inside a single consolidated display card to reduce variance.
- **Run Compare Mode:** Implemented a new intelligent framework inside the History Tab to simultaneously select and benchmark two historical runs head-to-head. Dynamically computes the overlap in evaluated problems, reporting a top-line differential (e.g. 'Model A Better: 4', 'Both Correct') and rendering beautifully formatted split-view comparison cards.
- **Bulk Selection:** Introduced a sidebar input specifically to quickly batch-select problem subsets utilizing arbitrarily chunked comma-separated ranges (e.g. `1-10, 15`).
- **History Pruning & Tagging:** Added per-run "Favorite" (★) buttons to definitively curate meaningful past generations. The system auto-pruning algorithm will natively preserve favorited items past its typical 50-item limit.
- **History Filtering:** Enhanced History run inspection with robust dropdown filters isolating models based on target Problem Difficulty and Verification status (Correct/Incorrect/No Answer).
- Added an explicit `✕` delete button inside History item widgets to instantly clear a single specific run from storage.
- **Export Redesign:** Overhauled CSV exports to automatically format with accurate identifiers: `[prompt_name]_[model_id]_[date].csv`.
- Expanded extracted CSV column datasets to distinctly break down `attempt`, `true_answer`, `verdict`, `reasoning`, `proof`, and `counterexample`.
- Refactored internal extraction Regex logic allowing CSVs to accurately parse trailing AI output regardless of unexpected spacing, hashes or bolding styles inside the reasoning text blocks (`e.g. ## COUNTEREXAMPLE:`).
- Fixed UX: The LLM model dropdown selector intuitively maps explicitly to the last-used `Provider` and `Model` saved directly against local storage tracking mechanics.
- Removed overly verbose `Cost` metric calculations from being visualized inside the card UI, retaining cost strictly within CSV outputs.

## v1.2.1
- Feature: Added an `Auto-retry errors` toggle that automatically triggers a 60-second countdown to re-run any failed API server requests due to rate limits or connection issues.
- Feature: Added Cheatsheet name tracking to Run History items in the sidebar.
- UI Improvement: Changed result card side-borders to color correctly based on model accuracy rather than the raw output prediction.

## v1.2.0
- Extracted hardcoded prompt mechanics into a fully UI-editable Prompt Template format.
- Mapped system template placeholders (`{equation1}`, `{equation2}`, and `{cheatsheet}`).
- Added robust local storage persistence across sessions to save/load user-created prompts.
- Deprecated 'Use Cheatsheet' feature toggle in favor of `{cheatsheet}` mapping.
- Deployed `official1` standard baseline prompt automatically to client storage.
- Restored the History Tab to seamlessly store and dynamically display serialized local run evaluations and UI components.
- Standardized CSS classes for Saved API Keys inputs for consistency.

## v1.1.4
- Added UI to save and load named Cheatsheets locally.
- Introduced a pop-out modal for editing and managing Cheatsheets more easily.
- Added filter options for problem Ground Truth (`TRUE`/`FALSE`).
- Added ability to create Custom Problems directly from the UI.
- Removed deprecated UI metrics/`Criteria Left` and replaced them with robust Confusion Matrix stats (`TP`, `TN`, `FP`, `FN`).
- Added heavier Google Gemini models (`Gemini 2.5 Pro`, `Gemini 2.0 Pro Exp`, `Gemini 2.0 Flash Thinking Exp`) for better reasoning capabilities.

## v1.1.3
- Removed the previously outdated legacy History Tab.
- Updated models catalogue and scoring logic.
- Consolidated styling and refactored UI.
