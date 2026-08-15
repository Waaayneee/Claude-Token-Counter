(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
	const DOCUMENT_EXTENSIONS = ['pdf', 'docx'];
	const TEXT_FILE_LABEL_PATTERN = /,\s*(\d+)\s*lines?$/i;

	const imageTokenCache = new Map();

	function getFileExtension(filename) {
		if (!filename || typeof filename !== 'string') return '';
		const match = filename.match(/\.([a-zA-Z0-9]+)$/);
		return match ? match[1].toLowerCase() : '';
	}

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

	function computeImageTokensFromDimensions(width, height) {
		const longestEdge = Math.max(width, height);
		let scaledWidth = width;
		let scaledHeight = height;
		if (longestEdge > CC.CONST.IMAGE_LONG_EDGE_CAP) {
			const scale = CC.CONST.IMAGE_LONG_EDGE_CAP / longestEdge;
			scaledWidth = width * scale;
			scaledHeight = height * scale;
		}
		return Math.ceil((scaledWidth * scaledHeight) / CC.CONST.IMAGE_TOKEN_DIVISOR);
	}

	function estimateImageTokens(imgEl, cacheKey) {
		return new Promise((resolve) => {
			const compute = () => {
				const width = imgEl.naturalWidth;
				const height = imgEl.naturalHeight;
				let tokens;
				if (width > 0 && height > 0) {
					tokens = computeImageTokensFromDimensions(width, height);
				} else {
					tokens = CC.CONST.IMAGE_TOKEN_FALLBACK;
				}

				const previousTokens = imageTokenCache.get(cacheKey);
				const bestTokens = previousTokens ? Math.max(previousTokens, tokens) : tokens;
				imageTokenCache.set(cacheKey, bestTokens);
				resolve(bestTokens);
			};

			if (imgEl.complete && imgEl.naturalWidth > 0) {
				compute();
			} else {
				imgEl.addEventListener('load', compute, { once: true });
				imgEl.addEventListener('error', () => resolve(CC.CONST.IMAGE_TOKEN_FALLBACK), { once: true });
			}
		});
	}

	function resetImageTokenCache() {
		imageTokenCache.clear();
	}

	function hasAnyAttachment(composerRoot) {
		if (!composerRoot) return false;

		const imgElements = composerRoot.querySelectorAll('img[alt]');
		for (const img of imgElements) {
			const ext = getFileExtension(img.getAttribute('alt'));
			if (DOCUMENT_EXTENSIONS.includes(ext) || IMAGE_EXTENSIONS.includes(ext)) return true;
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
				total += CC.CONST.DOCX_TOKEN_ESTIMATE;
			} else if (IMAGE_EXTENSIONS.includes(ext)) {
				imageTokenPromises.push(estimateImageTokens(img, img.getAttribute('alt')));
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

	CC.promptEstimator = { estimatePrompt, findComposerRoot, hasAnyAttachment, resetImageTokenCache };
})();
