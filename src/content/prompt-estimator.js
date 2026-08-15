(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	// Only images should be tokenized by dimensions; text documents are counted by line totals.
	const IMAGE_EXTENSIONS = new Set([
		'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
		'heic', 'heif', 'heics', 'heifs', 'avif', 'tif', 'tiff', 'ico', 'jfif'
	]);
	const TEXT_FILE_LABEL_PATTERN = /,\s*(\d+)\s*lines?$/i;
	const imageTokenCache = new Map();

	// Pull the last extension from a filename so we can match attachment types consistently.
	function getFileExtension(filename) {
		if (!filename || typeof filename !== 'string') return '';
		const match = filename.match(/\.([a-zA-Z0-9]+)$/);
		return match ? match[1].toLowerCase() : '';
	}

	// Accept common raster and HEIC/HEIF variants so image docs are handled across browsers.
	function isImageAttachment(filename) {
		return !!filename && IMAGE_EXTENSIONS.has(getFileExtension(filename));
	}

	function hasTextDocumentLabel(label) {
		return typeof label === 'string' && TEXT_FILE_LABEL_PATTERN.test(label);
	}

	// Find the nearest Composer root so the estimator can inspect attached files in context.
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

	// Scale the image to the extension cap and estimate token usage from the pixel area.
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

	// Resolve image tokens once the image loads, falling back safely if the browser blocks it.
	function estimateImageTokens(imgEl, cacheKey) {
		return new Promise((resolve) => {
			const compute = () => {
				const width = imgEl.naturalWidth;
				const height = imgEl.naturalHeight;
				const tokens = width > 0 && height > 0
					? computeImageTokensFromDimensions(width, height)
					: CC.CONST.IMAGE_TOKEN_FALLBACK;

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

	// Clear caches when the user empties the input so the estimate resets cleanly.
	function resetImageTokenCache() {
		imageTokenCache.clear();
	}

	// Return true when the draft contains a supported image or text-file attachment.
	function hasAnyAttachment(composerRoot) {
		if (!composerRoot) return false;

		for (const img of composerRoot.querySelectorAll('img[alt]')) {
			const altText = img.getAttribute('alt') || '';
			if (isImageAttachment(altText)) return true;
		}

		for (const btn of composerRoot.querySelectorAll('button[aria-label]')) {
			if (hasTextDocumentLabel(btn.getAttribute('aria-label') || '')) return true;
		}

		return false;
	}

	// Add token cost for all supported attachments while ignoring unsupported binary document types.
	async function estimateAttachmentTokens(composerRoot) {
		if (!composerRoot) return 0;

		let total = 0;
		const imageTokenPromises = [];

		for (const img of composerRoot.querySelectorAll('img[alt]')) {
			const altText = img.getAttribute('alt') || '';
			if (isImageAttachment(altText)) {
				imageTokenPromises.push(estimateImageTokens(img, altText));
			}
		}

		const imageTokenResults = await Promise.all(imageTokenPromises);
		for (const tokens of imageTokenResults) total += tokens;

		for (const btn of composerRoot.querySelectorAll('button[aria-label]')) {
			const label = btn.getAttribute('aria-label') || '';
			const match = label.match(TEXT_FILE_LABEL_PATTERN);
			if (!match) continue;

			const lineCount = Number.parseInt(match[1], 10);
			if (Number.isFinite(lineCount)) {
				total += lineCount * CC.CONST.TEXT_FILE_TOKENS_PER_LINE;
			}
		}

		return total;
	}

	// Combine the draft text and attachment costs into a single prompt estimate.
	async function estimatePrompt(chatInput, composerRoot) {
		const text = chatInput?.textContent || '';
		const textTokens = CC.tokens.countTokens(text);
		const attachmentTokens = await estimateAttachmentTokens(composerRoot);
		return textTokens + attachmentTokens;
	}

	CC.promptEstimator = { estimatePrompt, findComposerRoot, hasAnyAttachment, resetImageTokenCache };
})();
