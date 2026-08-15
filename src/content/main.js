(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__started) return;
	CC.__started = true;

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function getOrgIdFromCookie() {
		try {
			return document.cookie
				.split('; ')
				.find((row) => row.startsWith('lastActiveOrg='))
				?.split('=')[1] || null;
		} catch {
			return null;
		}
	}

	// Wait until a target element appears in the DOM without rolling polling loops.
	function waitForElement(selector, timeoutMs) {
		return new Promise((resolve) => {
			const existing = document.querySelector(selector);
			if (existing) {
				resolve(existing);
				return;
			}

			let timeoutId;
			const observer = new MutationObserver(() => {
				const el = document.querySelector(selector);
				if (el) {
					if (timeoutId) clearTimeout(timeoutId);
					observer.disconnect();
					resolve(el);
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });

			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					observer.disconnect();
					resolve(null);
				}, timeoutMs);
			}
		});
	}

	CC.waitForElement = waitForElement;

	// Listen for SPA route changes so the UI can resync when the current chat changes.
	function observeUrlChanges(callback) {
		let lastPath = window.location.pathname;

		const fireIfChanged = () => {
			const current = window.location.pathname;
			if (current !== lastPath) {
				lastPath = current;
				callback();
			}
		};

		window.addEventListener('cc:urlchange', fireIfChanged);
		window.addEventListener('popstate', fireIfChanged);

		return () => {
			window.removeEventListener('cc:urlchange', fireIfChanged);
			window.removeEventListener('popstate', fireIfChanged);
		};
	}

	// Normalize the org usage payload into a single format used by the UI and timers.
	function parseUsageFromUsageEndpoint(raw) {
		if (!raw || typeof raw !== 'object') return null;

		const normalizeWindow = (w, hours) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const utilization = Math.max(0, Math.min(100, w.utilization));
			const resets_at = typeof w.resets_at === 'string' ? w.resets_at : null;
			return { utilization, resets_at, window_hours: hours };
		};

		const fiveHour = normalizeWindow(raw.five_hour, 5);
		const sevenDay = normalizeWindow(raw.seven_day, 24 * 7);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	function parseUsageFromMessageLimit(raw) {
		if (!raw?.windows || typeof raw.windows !== 'object') return null;

		const normalizeWindow = (w, hours) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const utilization = Math.max(0, Math.min(100, w.utilization * 100));
			const resets_at = typeof w.resets_at === 'number' && Number.isFinite(w.resets_at)
				? new Date(w.resets_at * 1000).toISOString()
				: null;
			return { utilization, resets_at, window_hours: hours };
		};

		const fiveHour = normalizeWindow(raw.windows['5h'], 5);
		const sevenDay = normalizeWindow(raw.windows['7d'], 24 * 7);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	let currentConversationId = null;
	let currentOrgId = null;

	let promptComposerObserver = null;
	let promptEstimateDebounceId = null;
	let promptEstimateRequestId = 0;

	let usageState = null;
	let usageResetMs = { five_hour: null, seven_day: null };
	let lastUsageSseMs = 0;
	let usageFetchInFlight = false;
	let lastUsageUpdateMs = 0;
	const rolloverHandledForResetMs = { five_hour: null, seven_day: null };

	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => {
			if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
				Notification.requestPermission();
			}
			await refreshUsage();
		}
	});
	ui.initialize();

	const bridgeReady = CC.injectBridgeOnce();

	function sendNotification(title, options = {}) {
		if (!ui.notificationsEnabled) return;
		
		if (!('Notification' in window)) return;

		try {
			if (Notification.permission === 'default') {
				Notification.requestPermission();
				return;
			}

			if (Notification.permission === 'granted') {
				new Notification(title, {
					icon: '/icons/icon-128.png',
					...options
				});
			}
		} catch (error) {
		}
	}

	function applyUsageUpdate(normalized, source) {
		if (!normalized) return;
		const now = Date.now();
		usageState = normalized;
		lastUsageUpdateMs = now;
		if (source === 'sse') lastUsageSseMs = now;
		usageResetMs.five_hour = normalized.five_hour?.resets_at ? Date.parse(normalized.five_hour.resets_at) : null;
		usageResetMs.seven_day = normalized.seven_day?.resets_at ? Date.parse(normalized.seven_day.resets_at) : null;
		ui.setUsage(normalized);
	}

	function updateOrgIdIfNeeded(newOrgId) {
		if (newOrgId && typeof newOrgId === 'string' && newOrgId !== currentOrgId) {
			currentOrgId = newOrgId;
		}
	}

	async function refreshUsage() {
		await bridgeReady;
		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) return;
		updateOrgIdIfNeeded(orgId);

		if (usageFetchInFlight) return;
		usageFetchInFlight = true;
		let raw;
		try {
			raw = await CC.bridge.requestUsage(orgId);
		} catch {
			return;
		} finally {
			usageFetchInFlight = false;
		}

		const parsed = parseUsageFromUsageEndpoint(raw);
		applyUsageUpdate(parsed, 'usage');
	}

	async function refreshConversation() {
		await bridgeReady;
		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) return;
		updateOrgIdIfNeeded(orgId);

		try {
			await CC.bridge.requestConversation(orgId, currentConversationId);
		} catch {
		}
	}

	function handleGenerationStart() {
		if (!currentConversationId) return;
		ui.setPendingCache(true);
	}

	async function handleConversationPayload({ orgId, conversationId, data }) {
		if (!conversationId || conversationId !== currentConversationId) return;
		updateOrgIdIfNeeded(orgId);
		if (!data) return;

		const metrics = await CC.tokens.computeConversationMetrics(data);
		ui.setConversationMetrics({ totalTokens: metrics.totalTokens, cachedUntil: metrics.cachedUntil });
	}

	function handleMessageLimit(messageLimit) {
		const parsed = parseUsageFromMessageLimit(messageLimit);
		applyUsageUpdate(parsed, 'sse');
	}

	CC.bridge.on('cc:generation_start', handleGenerationStart);
	CC.bridge.on('cc:conversation', handleConversationPayload);
	CC.bridge.on('cc:message_limit', handleMessageLimit);

	// Recompute the live draft estimate whenever the conversation input changes.
	async function runPromptEstimate() {
		const chatInput = document.querySelector(CC.DOM.CHAT_INPUT);
		if (!chatInput) {
			promptEstimateRequestId += 1;
			ui.setPromptEstimate(null);
			return;
		}

		const composerRoot = CC.promptEstimator.findComposerRoot(chatInput);
		const text = chatInput.textContent || '';
		const isTextEmpty = text.trim().length === 0;
		const attachmentsPresent = CC.promptEstimator.hasAnyAttachment(composerRoot);

		if (isTextEmpty && !attachmentsPresent) {
			promptEstimateRequestId += 1;
			ui.setPromptEstimate(null);
			CC.promptEstimator.resetImageTokenCache();
			return;
		}

		const requestId = ++promptEstimateRequestId;
		const totalTokens = await CC.promptEstimator.estimatePrompt(chatInput, composerRoot);
		if (requestId !== promptEstimateRequestId) return;
		ui.setPromptEstimate(totalTokens);
	}

	// Debounce prompt estimation to avoid recomputing on every keystroke.
	function scheduleRunPromptEstimate() {
		if (promptEstimateDebounceId) clearTimeout(promptEstimateDebounceId);
		promptEstimateDebounceId = setTimeout(() => {
			promptEstimateDebounceId = null;
			runPromptEstimate();
		}, CC.CONST.PROMPT_ESTIMATE_DEBOUNCE_MS);
	}

	// Bind the prompt estimator to the live composer so the estimate stays current.
	function attachPromptEstimatorListeners(chatInput) {
		if (!chatInput || chatInput.hasAttribute('data-cc-prompt-estimator')) return;
		chatInput.setAttribute('data-cc-prompt-estimator', 'true');

		chatInput.addEventListener('input', scheduleRunPromptEstimate);

		if (!promptComposerObserver) {
			promptComposerObserver = new MutationObserver(() => {
				const liveChatInput = document.querySelector(CC.DOM.CHAT_INPUT);
				if (liveChatInput && !liveChatInput.hasAttribute('data-cc-prompt-estimator')) {
					attachPromptEstimatorListeners(liveChatInput);
				}
				scheduleRunPromptEstimate();
			});
			promptComposerObserver.observe(document.body, { childList: true, subtree: true });
		}

		scheduleRunPromptEstimate();
	}

	async function handleUrlChange() {
		currentConversationId = getConversationId();

		waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
			if (el) ui.attachUsageLine();
		});
		waitForElement(CC.DOM.CHAT_MENU_TRIGGER, 60000).then((el) => {
			if (el) ui.attachHeader();
		});
		waitForElement(CC.DOM.CHAT_INPUT, 60000).then((el) => {
			if (el) attachPromptEstimatorListeners(el);
		});

		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		updateOrgIdIfNeeded(getOrgIdFromCookie());

		await refreshConversation();

		if (!usageState) await refreshUsage();
	}

	const unobserveUrl = observeUrlChanges(handleUrlChange);
	window.addEventListener('beforeunload', unobserveUrl);

	let branchObserver = null;
	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest('button[aria-label="Previous"], button[aria-label="Next"]');
		if (!btn) return;

		const container = btn.closest('.inline-flex');
		const spans = container?.querySelectorAll('span') || [];
		const indicator = Array.from(spans).find((s) => /^\d+\s*\/\s*\d+$/.test(s.textContent.trim()));
		if (!indicator) return;

		const originalText = indicator.textContent;

		if (branchObserver) branchObserver.disconnect();

		branchObserver = new MutationObserver(() => {
			if (indicator.textContent !== originalText) {
				branchObserver.disconnect();
				branchObserver = null;
				refreshConversation();
			}
		});

		branchObserver.observe(indicator, { childList: true, characterData: true, subtree: true });

		setTimeout(() => {
			if (branchObserver) {
				branchObserver.disconnect();
				branchObserver = null;
			}
		}, 60000);
	});

	handleUrlChange();

	function tick() {
		ui.tick();

		const now = Date.now();

		if (usageResetMs.five_hour && now >= usageResetMs.five_hour && rolloverHandledForResetMs.five_hour !== usageResetMs.five_hour) {
			rolloverHandledForResetMs.five_hour = usageResetMs.five_hour;
			const isNotificationsEnabled = localStorage.getItem('cc-notifications-enabled') === 'true';
			if (isNotificationsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
				new Notification('Claude session reset', {
					body: 'Your 5-hour usage window has reset.'
				});
			}

			refreshUsage();
		}

		if (usageResetMs.seven_day && now >= usageResetMs.seven_day && rolloverHandledForResetMs.seven_day !== usageResetMs.seven_day) {
			rolloverHandledForResetMs.seven_day = usageResetMs.seven_day;
			sendNotification('7-day usage window reset', {
				body: 'Your 7-day usage window has reset. You can now make new requests.'
			});
			refreshUsage();
		}

		const ONE_HOUR_MS = 60 * 60 * 1000;
		const sseAge = now - lastUsageSseMs;
		const anyAge = now - lastUsageUpdateMs;
		if (!document.hidden && sseAge > ONE_HOUR_MS && anyAge > ONE_HOUR_MS) {
			refreshUsage();
		}
	}

	setInterval(tick, 1000);
})();
