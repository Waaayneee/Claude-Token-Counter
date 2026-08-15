(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		CHAT_MENU_TRIGGER: '[data-testid="chat-menu-trigger"]',
		MODEL_SELECTOR_DROPDOWN: '[data-testid="model-selector-dropdown"]',
		CHAT_PROJECT_WRAPPER: '.chat-project-wrapper',
		BRIDGE_SCRIPT_ID: 'cc-bridge-script',
		CHAT_INPUT: '[data-testid="chat-input"]',
		ADD_ATTACHMENT_BUTTON: '[aria-label="Add files, connectors, and more"]'
	});

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS: 5 * 60 * 1000,
		CONTEXT_LIMIT_TOKENS: 200000,
		PROMPT_ESTIMATE_DEBOUNCE_MS: 300,
		IMAGE_TOKEN_DIVISOR: 750,
		IMAGE_LONG_EDGE_CAP: 1568,
		IMAGE_TOKEN_FALLBACK: 1600,
	});

	CC.COLORS = Object.freeze({
		PROGRESS_FILL_DARK: '#df643b',
		PROGRESS_FILL_LIGHT: '#D97757',
		PROGRESS_OUTLINE_DARK: '#787877',
		PROGRESS_OUTLINE_LIGHT: '#bfbfbf',
		PROGRESS_MARKER_DARK: '#ffffff',
		PROGRESS_MARKER_LIGHT: '#111111',
		RED_WARNING: '#ce2029',
		BOLD_LIGHT: '#141413',
		BOLD_DARK: '#faf9f5'
	});
})();
