(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	// Support common raster image payloads and keep the existing image estimator intact.
	const IMAGE_EXTENSIONS = new Set([
		'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
		'heic', 'heif', 'heics', 'heifs', 'avif', 'tif', 'tiff', 'ico', 'jfif'
	]);
	const imageTokenCache = new Map();

	// Pull the last extension from a filename or path so we can match attachment types consistently.
	function getFileExtension(filename) {
		if (!filename || typeof filename !== 'string') return '';
		const normalized = filename.split('?')[0].split('#')[0].trim();
		const lastSegment = normalized.split('/').pop();
		const match = lastSegment.match(/\.([a-zA-Z0-9]+)$/);
		return match ? match[1].toLowerCase() : '';
	}

	function extractFileNamesFromText(value) {
		if (typeof value !== 'string') return [];
		const matches = value.matchAll(/(?:^|[^A-Za-z0-9])([A-Za-z0-9_. -]+\.(?:[A-Za-z0-9]+))/g);
		return Array.from(matches, (match) => match[1].trim()).filter((name) => !!name && /\.[A-Za-z0-9]+$/.test(name));
	}

	function getAttachmentNames(node) {
		if (!node) return [];
		const names = new Set();
		const seen = new Set();

		const addValues = (...values) => {
			for (const value of values) {
				if (typeof value !== 'string' || !value.trim()) continue;
				for (const name of extractFileNamesFromText(value)) {
					if (!seen.has(name)) {
						seen.add(name);
						names.add(name);
					}
				}
			}
		};

		for (const attribute of ['alt', 'title', 'src', 'currentSrc', 'data-name', 'data-filename', 'aria-label']) {
			addValues(node.getAttribute?.(attribute));
		}

		const text = node.textContent || '';
		addValues(text);

		const closestButton = node.closest?.('button');
		if (closestButton) {
			for (const attribute of ['aria-label', 'title', 'data-name', 'data-filename']) {
				addValues(closestButton.getAttribute?.(attribute));
			}
			addValues(closestButton.textContent || '');
		}

		return Array.from(names);
	}

	// Accept common raster and HEIC/HEIF variants so image docs are handled across browsers.
	function isImageAttachment(filename) {
		const ext = getFileExtension(filename || '');
		return !!ext && IMAGE_EXTENSIONS.has(ext);
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

	// Return true when the composer contains a supported image attachment.
	function hasAnyAttachment(composerRoot) {
		if (!composerRoot) return false;

		const candidates = composerRoot.querySelectorAll('img, button, [aria-label], [title], [data-name], [data-filename]');
		for (const node of candidates) {
			const names = getAttachmentNames(node);
			if (names.some((name) => isImageAttachment(name))) return true;
		}

		return false;
	}

	// Add token cost only for image attachments; document attachment estimation is intentionally disabled.
	async function estimateAttachmentTokens(composerRoot) {
		if (!composerRoot) return 0;

		let total = 0;
		const imageTokenPromises = [];
		const seenNames = new Set();

		const candidates = composerRoot.querySelectorAll('img, button, [aria-label], [title], [data-name], [data-filename]');
		for (const node of candidates) {
			const names = getAttachmentNames(node);
			for (const name of names) {
				if (seenNames.has(name)) continue;
				seenNames.add(name);

				if (!isImageAttachment(name)) continue;

				const img = node.tagName === 'IMG' ? node : node.closest?.('img');
				if (img) imageTokenPromises.push(estimateImageTokens(img, name));
			}
		}

		const imageTokenResults = await Promise.all(imageTokenPromises);
		for (const tokens of imageTokenResults) total += tokens;

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
