# Changelog

All notable changes to the Equational Theories Playground will be documented in this file.

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
