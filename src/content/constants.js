(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		CHAT_MENU_TRIGGER: '[data-testid="chat-menu-trigger"]',
		MODEL_SELECTOR_DROPDOWN: '[data-testid="model-selector-dropdown"]',
		CHAT_PROJECT_WRAPPER: '.chat-project-wrapper',
		BRIDGE_SCRIPT_ID: 'cc-bridge-script',
		CHAT_INPUT: '[data-testid="chat-input"]', // NEW: prompt textbox used by prompt-estimator.js
		ADD_ATTACHMENT_BUTTON: '[aria-label="Add files, connectors, and more"]' // NEW: used to locate the composer root
	});

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS: 5 * 60 * 1000,
		CONTEXT_LIMIT_TOKENS: 200000,
		PROMPT_ESTIMATE_DEBOUNCE_MS: 300, // NEW: debounce delay for the prompt token estimator
		IMAGE_TOKEN_DIVISOR: 750, // NEW: width * height / 750, per Anthropic's rough public image token formula
		IMAGE_TOKEN_FALLBACK: 1600, // NEW: used only if natural dimensions can't be read at all, tunable
		PDF_TOKEN_ESTIMATE: 12000, // NEW: flat estimate per PDF, sized for a typical multi-page document, tunable
		DOCX_TOKEN_ESTIMATE: 6000, // NEW: flat estimate per Word document, tunable
		TEXT_FILE_TOKENS_PER_LINE: 7, // NEW: ~25-35 chars/line at ~4 chars/token for code, tunable
	});

	CC.COLORS = Object.freeze({
		PROGRESS_FILL_DARK: '#E6C843',
		PROGRESS_FILL_LIGHT: '#FFD700',
		PROGRESS_OUTLINE_DARK: '#787877',
		PROGRESS_OUTLINE_LIGHT: '#bfbfbf',
		PROGRESS_MARKER_DARK: '#ffffff',
		PROGRESS_MARKER_LIGHT: '#111111',
		RED_WARNING: '#ce2029',
		BOLD_LIGHT: '#141413',
		BOLD_DARK: '#faf9f5'
	});
})();
