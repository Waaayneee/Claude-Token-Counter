// NEW FILE: prompt-estimator.js
// Estimates the token cost of the current draft prompt (typed text + attached
// files) using DOM inspection only, no raw File object access.
(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
	const DOCUMENT_EXTENSIONS = ['pdf', 'docx']; // NEW: document-style attachments, flat-estimated (no line count available)
	const TEXT_FILE_LABEL_PATTERN = /,\s*(\d+)\s*lines?$/i;

	function getFileExtension(filename) {
		if (!filename || typeof filename !== 'string') return '';
		const match = filename.match(/\.([a-zA-Z0-9]+)$/);
		return match ? match[1].toLowerCase() : '';
	}

	// MODIFIED: document.body was too broad, it also scanned attachment
	// thumbnails from already-sent messages in the chat history, so the
	// estimate never reset to null after the first file was sent. This scan
	// root must stay narrow (composer only). Broad DOM-change detection is
	// handled separately in main.js via a document.body observer instead.
	// Preference order: the semantic <form> boundary (most reliable, forms
	// don't span into message history) → the attach-button ancestor climbed
	// a few extra levels (attachment thumbnails render just outside it) →
	// document.body as a last resort only.
	function findComposerRoot(chatInput) {
		const form = chatInput.closest('form');
		if (form) return form;

		const addButton = document.querySelector(CC.DOM.ADD_ATTACHMENT_BUTTON);
		if (addButton) {
			let node = chatInput;
			while (node) {
				if (node.contains(addButton)) {
					for (let i = 0; i < 3 && node.parentElement; i++) node = node.parentElement;
					return node;
				}
				node = node.parentElement;
			}
		}

		return document.body;
	}

	function estimateImageTokens(imgEl) {
		return new Promise((resolve) => {
			const compute = () => {
				const width = imgEl.naturalWidth;
				const height = imgEl.naturalHeight;
				if (width > 0 && height > 0) {
					resolve(Math.ceil((width * height) / CC.CONST.IMAGE_TOKEN_DIVISOR));
				} else {
					resolve(CC.CONST.IMAGE_TOKEN_FALLBACK);
				}
			};

			if (imgEl.complete && imgEl.naturalWidth > 0) {
				compute();
			} else {
				imgEl.addEventListener('load', compute, { once: true });
				imgEl.addEventListener('error', () => resolve(CC.CONST.IMAGE_TOKEN_FALLBACK), { once: true });
			}
		});
	}

	// Quick synchronous check used to decide whether to show or hide the
	// estimate, without waiting on async image dimension loads.
	function hasAnyAttachment(composerRoot) {
		if (!composerRoot) return false;

		const imgElements = composerRoot.querySelectorAll('img[alt]');
		for (const img of imgElements) {
			const ext = getFileExtension(img.getAttribute('alt'));
			if (DOCUMENT_EXTENSIONS.includes(ext) || IMAGE_EXTENSIONS.includes(ext)) return true; // MODIFIED: was a hardcoded 'pdf' check
		}

		const fileButtons = composerRoot.querySelectorAll('button[aria-label]');
		for (const btn of fileButtons) {
			if (TEXT_FILE_LABEL_PATTERN.test(btn.getAttribute('aria-label') || '')) return true;
		}

		return false;
	}

	async function estimateAttachmentTokens(composerRoot) {
		if (!composerRoot) return 0;
		let total = 0;

		const imgElements = composerRoot.querySelectorAll('img[alt]');
		const imageTokenPromises = [];

		for (const img of imgElements) {
			const ext = getFileExtension(img.getAttribute('alt'));
			if (ext === 'pdf') {
				total += CC.CONST.PDF_TOKEN_ESTIMATE;
			} else if (ext === 'docx') {
				total += CC.CONST.DOCX_TOKEN_ESTIMATE; // NEW
			} else if (IMAGE_EXTENSIONS.includes(ext)) {
				imageTokenPromises.push(estimateImageTokens(img));
			}
		}

		const imageTokenResults = await Promise.all(imageTokenPromises);
		for (const tokens of imageTokenResults) total += tokens;

		const fileButtons = composerRoot.querySelectorAll('button[aria-label]');
		for (const btn of fileButtons) {
			const label = btn.getAttribute('aria-label') || '';
			const match = label.match(TEXT_FILE_LABEL_PATTERN);
			if (match) {
				const lineCount = parseInt(match[1], 10);
				if (Number.isFinite(lineCount)) {
					total += lineCount * CC.CONST.TEXT_FILE_TOKENS_PER_LINE;
				}
			}
		}

		return total;
	}

	async function estimatePrompt(chatInput, composerRoot) {
		const text = chatInput?.textContent || '';
		const textTokens = CC.tokens.countTokens(text);
		const attachmentTokens = await estimateAttachmentTokens(composerRoot);
		return textTokens + attachmentTokens;
	}

	CC.promptEstimator = { estimatePrompt, findComposerRoot, hasAnyAttachment };
})();
