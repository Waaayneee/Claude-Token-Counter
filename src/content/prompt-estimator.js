// NEW: token estimate - estimates the current draft prompt cost from DOM text and attachment chips.
(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
	const TEXT_FILE_LABEL_PATTERN = /,\s*(\d+)\s*lines?$/i;

	function getFileExtension(filename) {
		if (!filename || typeof filename !== 'string') return '';
		const match = filename.match(/\.([a-zA-Z0-9]+)$/);
		return match ? match[1].toLowerCase() : '';
	}

	// NEW: token estimate - finds the smallest composer ancestor that contains the attachment button.
	function findComposerRoot(chatInput) {
		const addButton = document.querySelector(CC.DOM.ADD_ATTACHMENT_BUTTON);
		if (!addButton) {
			return chatInput.closest('form') || chatInput.parentElement?.parentElement?.parentElement || document.body;
		}

		let node = chatInput;
		while (node) {
			if (node.contains(addButton)) return node;
			node = node.parentElement;
		}
		return document.body;
	}

	// NEW: token estimate - approximates image tokens from natural dimensions.
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

	// NEW: token estimate - checks whether attachments are present without waiting on async image loads.
	function hasAnyAttachment(composerRoot) {
		if (!composerRoot) return false;

		const imgElements = composerRoot.querySelectorAll('img[alt]');
		for (const img of imgElements) {
			const ext = getFileExtension(img.getAttribute('alt'));
			if (ext === 'pdf' || IMAGE_EXTENSIONS.includes(ext)) return true;
		}

		const fileButtons = composerRoot.querySelectorAll('button[aria-label]');
		for (const btn of fileButtons) {
			if (TEXT_FILE_LABEL_PATTERN.test(btn.getAttribute('aria-label') || '')) return true;
		}

		return false;
	}

	// NEW: token estimate - sums attachment tokens from images, PDFs, and text-file line counts.
	async function estimateAttachmentTokens(composerRoot) {
		if (!composerRoot) return 0;

		let total = 0;
		const imgElements = composerRoot.querySelectorAll('img[alt]');
		const imageTokenPromises = [];

		for (const img of imgElements) {
			const ext = getFileExtension(img.getAttribute('alt'));
			if (ext === 'pdf') {
				total += CC.CONST.PDF_TOKEN_ESTIMATE;
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

	// NEW: token estimate - combines prompt text tokens with attachment tokens.
	async function estimatePrompt(chatInput, composerRoot) {
		const text = chatInput?.textContent || '';
		const textTokens = CC.tokens.countTokens(text);
		const attachmentTokens = await estimateAttachmentTokens(composerRoot);
		return textTokens + attachmentTokens;
	}

	CC.promptEstimator = { estimatePrompt, findComposerRoot, hasAnyAttachment };
})();
