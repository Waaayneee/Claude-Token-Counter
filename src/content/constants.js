(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		CHAT_MENU_TRIGGER: '[data-testid="chat-menu-trigger"]',
		MODEL_SELECTOR_DROPDOWN: '[data-testid="model-selector-dropdown"]',
		CHAT_PROJECT_WRAPPER: '.chat-project-wrapper',
		BRIDGE_SCRIPT_ID: 'cc-bridge-script',
		CHAT_INPUT: '[data-testid="chat-input"]', // NEW: token estimate target for the prompt textbox
		ADD_ATTACHMENT_BUTTON: '[aria-label="Add files, connectors, and more"]' // NEW: token estimate target for the composer root
	});

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS: 5 * 60 * 1000,
		CONTEXT_LIMIT_TOKENS: 200000,
		PROMPT_ESTIMATE_DEBOUNCE_MS: 300, // NEW: token estimate debounce delay for input and DOM mutations
		IMAGE_TOKEN_DIVISOR: 750, // NEW: token estimate divisor for image dimensions
		IMAGE_TOKEN_FALLBACK: 1600, // NEW: token estimate fallback when image dimensions are unavailable
		PDF_TOKEN_ESTIMATE: 12000, // NEW: token estimate for a PDF attachment
		TEXT_FILE_TOKENS_PER_LINE: 7, // NEW: token estimate for text file attachments by line count
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
