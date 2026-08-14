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

	/**
	 * Wait for an element to appear in the DOM using MutationObserver.
	 * More efficient than polling - reacts immediately when element appears.
	 * @param {string} selector - CSS selector
	 * @param {number} [timeoutMs] - Optional timeout in ms. Returns null if timeout expires.
	 */
	
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

	function observeUrlChanges(callback) {
		let lastPath = window.location.pathname;

		const fireIfChanged = () => {
			const current = window.location.pathname;
			if (current !== lastPath) {
				lastPath = current;
				callback();
			}
		};

		// Listen for custom event from bridge (history methods wrapped early)
		window.addEventListener('cc:urlchange', fireIfChanged);
		// Also popstate for back/forward buttons
		window.addEventListener('popstate', fireIfChanged);

		return () => {
			window.removeEventListener('cc:urlchange', fireIfChanged);
			window.removeEventListener('popstate', fireIfChanged);
		};
	}

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

	// NEW: token estimate state for the active composer input and its debounced refresh cycle.
	let promptChatInput = null;
	let promptComposerRoot = null;
	let promptComposerObserver = null;
	let promptInputObserver = null;
	let promptEstimateDebounceId = null;
	let promptEstimateRequestId = 0;

	let usageState = null; // last snapshot
	let usageResetMs = { five_hour: null, seven_day: null }; // cached parsed timestamps
	let lastUsageSseMs = 0;
	let usageFetchInFlight = false;
	let lastUsageUpdateMs = 0;
	const rolloverHandledForResetMs = { five_hour: null, seven_day: null };

	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => {
			// ask for notification permission if not already granted or denied
			if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
				Notification.requestPermission();
			}
			await refreshUsage();
		}
	});
	ui.initialize();

	// Bridge must be ready before we can make requests
	const bridgeReady = CC.injectBridgeOnce();

	function sendNotification(title, options = {}) {
		// Only send if notifications are enabled
		if (!ui.notificationsEnabled) return;
		
		// Check if browser supports Notification API
		if (!('Notification' in window)) return;

		try {
			// Request permission if not already granted
			if (Notification.permission === 'default') {
				Notification.requestPermission();
				return; // Don't send yet, wait for user permission
			}

			if (Notification.permission === 'granted') {
				// Send browser notification
				new Notification(title, {
					icon: '/icons/icon-128.png', // Adjust path if needed
					...options
				});
			}
		} catch (error) {
			// Silently fail if notification fails
		}
	}

	function applyUsageUpdate(normalized, source) {
		if (!normalized) return;
		const now = Date.now();
		usageState = normalized;
		lastUsageUpdateMs = now;
		if (source === 'sse') lastUsageSseMs = now;
		// Cache parsed timestamps to avoid Date.parse() every tick
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
			// ignore
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

	// NEW: token estimate - recomputes the draft token total and writes it into the UI.
	async function runPromptEstimate() {
		if (!promptChatInput || !promptComposerRoot) return;

		const text = promptChatInput.textContent || '';
		const isTextEmpty = text.trim().length === 0;
		const attachmentsPresent = CC.promptEstimator.hasAnyAttachment(promptComposerRoot);

		if (isTextEmpty && !attachmentsPresent) {
			promptEstimateRequestId += 1;
			ui.setPromptEstimate(null);
			return;
		}

		const requestId = ++promptEstimateRequestId;
		const totalTokens = await CC.promptEstimator.estimatePrompt(promptChatInput, promptComposerRoot);
		if (requestId !== promptEstimateRequestId) return; // stale result if the composer changed mid-estimate
		ui.setPromptEstimate(totalTokens);
	}

	// NEW: token estimate - debounces DOM/input changes so the estimator doesn't run on every mutation.
	function scheduleRunPromptEstimate() {
		if (promptEstimateDebounceId) clearTimeout(promptEstimateDebounceId);
		promptEstimateDebounceId = setTimeout(() => {
			promptEstimateDebounceId = null;
			runPromptEstimate();
		}, CC.CONST.PROMPT_ESTIMATE_DEBOUNCE_MS);
	}

	// NEW: token estimate - wires the prompt input and composer observer once per chat input element.
	function attachPromptEstimatorListeners(chatInput) {
		if (!chatInput || chatInput.hasAttribute('data-cc-prompt-estimator')) return;
		chatInput.setAttribute('data-cc-prompt-estimator', 'true');

		promptChatInput = chatInput;
		promptComposerRoot = CC.promptEstimator.findComposerRoot(chatInput);

		chatInput.addEventListener('input', scheduleRunPromptEstimate);

		if (promptComposerObserver) promptComposerObserver.disconnect();
		promptComposerObserver = new MutationObserver(scheduleRunPromptEstimate);
		promptComposerObserver.observe(promptComposerRoot, { childList: true, subtree: true });

		scheduleRunPromptEstimate();
	}

	// NEW: token estimate - rebinds the estimator if Claude re-renders the composer input.
	function ensurePromptEstimatorAttached() {
		const chatInput = document.querySelector(CC.DOM.CHAT_INPUT);
		if (!chatInput) return;
		if (chatInput === promptChatInput && document.contains(chatInput)) return;
		attachPromptEstimatorListeners(chatInput);
	}

	async function handleUrlChange() {
		currentConversationId = getConversationId();

		// Attach usage line and header independently - they have different anchor elements
		// and CHAT_MENU_TRIGGER doesn't exist on home/new pages
		waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
			if (el) ui.attachUsageLine();
		});
		waitForElement(CC.DOM.CHAT_MENU_TRIGGER, 60000).then((el) => {
			if (el) ui.attachHeader();
		});
		waitForElement(CC.DOM.CHAT_INPUT, 60000).then((el) => {
			if (el) attachPromptEstimatorListeners(el); // NEW: token estimate starts once the chat input exists
		});

		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		// Best-effort orgId from cookie.
		updateOrgIdIfNeeded(getOrgIdFromCookie());

		await refreshConversation();

		// Usage is org-level, not conversation-level. Only fetch on first load or if stale.
		if (!usageState) await refreshUsage();
	}

	const unobserveUrl = observeUrlChanges(handleUrlChange);
	window.addEventListener('beforeunload', unobserveUrl);

	// NEW: token estimate - watches for composer re-renders so the listener survives sent messages.
	promptInputObserver = new MutationObserver(ensurePromptEstimatorAttached);
	promptInputObserver.observe(document.body, { childList: true, subtree: true });

	// Refresh on branch navigation - watch for the branch indicator to change
	let branchObserver = null;
	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest('button[aria-label="Previous"], button[aria-label="Next"]');
		if (!btn) return;

		// Find the branch indicator span (matches "X / Y" pattern) near the clicked button
		const container = btn.closest('.inline-flex');
		const spans = container?.querySelectorAll('span') || [];
		const indicator = Array.from(spans).find((s) => /^\d+\s*\/\s*\d+$/.test(s.textContent.trim()));
		if (!indicator) return;

		const originalText = indicator.textContent;

		// Clean up any existing observer
		if (branchObserver) branchObserver.disconnect();

		// Watch for the indicator text to change (with cleanup timeout)
		branchObserver = new MutationObserver(() => {
			if (indicator.textContent !== originalText) {
				branchObserver.disconnect();
				branchObserver = null;
				refreshConversation();
			}
		});

		branchObserver.observe(indicator, { childList: true, characterData: true, subtree: true });

		// Clean up if nothing changes after 60 seconds
		setTimeout(() => {
			if (branchObserver) {
				branchObserver.disconnect();
				branchObserver = null;
			}
		}, 60000);
	});

	// Initial attach + fetches
	handleUrlChange();

	function tick() {
		ui.tick();

		// Refresh usage when a window ends (5h / 7d). SSE won't fire at rollover unless a message is sent.
		const now = Date.now();

		if (usageResetMs.five_hour && now >= usageResetMs.five_hour && rolloverHandledForResetMs.five_hour !== usageResetMs.five_hour) {
			rolloverHandledForResetMs.five_hour = usageResetMs.five_hour;
			// Notify user that 5-hour usage window has reset
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
			// TODO: ADD NOTIFICATION FEATURE HERE - Notify user that 7-day usage window has reset
			// im ngl idk if people would even need this
			sendNotification('7-day usage window reset', {
				body: 'Your 7-day usage window has reset. You can now make new requests.'
			});
			refreshUsage();
		}

		// Optional hourly safety refresh.
		const ONE_HOUR_MS = 60 * 60 * 1000;
		const sseAge = now - lastUsageSseMs;
		const anyAge = now - lastUsageUpdateMs;
		if (!document.hidden && sseAge > ONE_HOUR_MS && anyAge > ONE_HOUR_MS) {
			refreshUsage();
		}
	}

	// Keep countdowns + markers updated.
	setInterval(tick, 1000);
})();
