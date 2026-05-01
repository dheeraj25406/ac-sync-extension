// Rewritten popup controller — clean and minimal
const $ = (id) => document.getElementById(id);

boot();

async function boot() {
  try {
    await init();
  } catch (error) {
    console.error("CodeSync popup failed to initialize:", error);
    showToast("Popup init failed. Open Settings and retry.");
  }
}

async function init() {
  bindEvents();
  await hydrateSettings();
  await loadAnalytics();
}

function bindEvents() {
  $("manualPush").addEventListener("click", manualPush);
  $("repairPush").addEventListener("click", repairLastPush);
  $("openOptions").addEventListener("click", () =>
    chrome.runtime.openOptionsPage(),
  );
  ["toggleLC", "toggleCF", "toggleGFG"].forEach((id) =>
    $(id).addEventListener("change", saveToggles),
  );

  // New UI elements
  const copyBtn = $("copyCodeBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", copyCodeToClipboard);
  }

  const useBtn = $("useCachedBtn");
  if (useBtn) {
    useBtn.style.display = "none";
    useBtn.addEventListener("click", useCachedSubmission);
  }

  window.__cachedPopupPayload = null;
}

async function repairLastPush() {
  const btn = $("repairPush");
  btn.disabled = true;
  btn.textContent = "Repairing...";
  try {
    const res = await sendRuntimeMessageWithTimeout(
      { type: "REPAIR_LAST_PUSH" },
      30000,
    );
    if (res?.ok) {
      showToast("Repair pushed to GitHub (updated commit).");
      await loadAnalytics();
    } else {
      showToast(res?.error || "Repair failed.");
    }
  } catch (e) {
    showToast(e?.message || "Repair failed.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Repair Last Push";
  }
}

async function hydrateSettings() {
  const s = await chrome.storage.sync.get(["platformEnabled"]);
  const local = await chrome.storage.local.get(["lastSyncTs"]);
  $("toggleLC").checked = s.platformEnabled?.leetcode ?? true;
  $("toggleCF").checked = s.platformEnabled?.codeforces ?? true;
  $("toggleGFG").checked = s.platformEnabled?.gfg ?? true;
  updateStatusLine(local.lastSyncTs || 0);
}

async function saveToggles() {
  await chrome.storage.sync.set({
    platformEnabled: {
      leetcode: $("toggleLC").checked,
      codeforces: $("toggleCF").checked,
      gfg: $("toggleGFG").checked,
    },
  });
  showToast("Platform preferences saved.");
}

async function manualPush() {
  const pushBtn = $("manualPush");
  if (pushBtn.dataset.loading === "1") return;
  pushBtn.dataset.loading = "1";
  const originalText = pushBtn.textContent;
  pushBtn.textContent = "Working...";
  pushBtn.disabled = true;
  updateStatusLine(0, "Preparing...");

  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    console.debug("AC Sync popup: Current tab:", {
      url: tab.url,
      title: tab.title,
    });

    // Validate we're on a supported platform
    if (!tab.url || !isSupportedPlatform(tab.url)) {
      showToast(
        "Please open a LeetCode, Codeforces, or GeeksforGeeks page first.",
      );
      restorePushButton(pushBtn, originalText);
      return;
    }

    // Clear any cached data to force fresh collection
    await chrome.storage.local.remove(["lastDetectedSubmission"]);
    console.debug("AC Sync: Cleared cached submission data");

    // Try to collect from current page
    const liveRes = await sendTabMessageWithTimeout(
      tab.id,
      { type: "COLLECT_CURRENT_SUBMISSION" },
      15000, // Increased timeout
    ).catch(() => ({ ok: false, error: "Communication timeout" }));

    console.debug("AC Sync popup: Live collection result:", {
      ok: liveRes?.ok,
      error: liveRes?.error,
      hasPayload: !!liveRes?.payload,
      codeLength: liveRes?.payload?.code?.length || 0,
      platform: liveRes?.payload?.platform,
    });

    let payload = liveRes?.ok ? { ...liveRes.payload } : {};

    // Fallback to stored submission if live collection fails
    const storedObj = await chrome.storage.local.get([
      "lastDetectedSubmission",
    ]);
    const storedPayload = storedObj.lastDetectedSubmission || null;

    console.debug("AC Sync popup: Stored payload:", storedPayload);

    // BULLETPROOF: Always ensure we have some code
    const codeText = String(payload.code || "").trim();
    const storedCodeText = String(storedPayload?.code || "").trim();

    // Check if code is a placeholder
    const isPlaceholder = (text) => {
      return (
        text.includes("No code captured") ||
        text.includes("No code detected") ||
        text.includes("Unable to detect") ||
        text.length < 10
      );
    };

    const codeLen = codeText.replace(/[ \t\r]+/g, "").length;
    const storedLen = storedCodeText.replace(/[ \t\r]+/g, "").length;

    console.debug("AC Sync: Code validation:", {
      currentCodeLength: codeLen,
      storedCodeLength: storedLen,
      isCurrentPlaceholder: isPlaceholder(codeText),
      isStoredPlaceholder: isPlaceholder(storedCodeText),
    });

    // Always prioritize current page data if it has valid code
    if (codeLen > 10 && !isPlaceholder(codeText)) {
      console.debug("AC Sync: Using current page data - valid code found");
      // Use current page payload as-is
    } else if (storedLen > 10 && !isPlaceholder(storedCodeText)) {
      console.debug(
        "AC Sync: Using stored data - current page has no valid code",
      );
      payload = { ...(storedPayload || {}) };
    } else {
      // BULLETPROOF: Show error to user instead of pushing placeholder
      console.debug("AC Sync: No valid code found - showing error");
      showToast(
        "Unable to capture code. Please ensure you're on a submission page with visible code, then try again.",
      );
      restorePushButton(pushBtn, originalText);
      return;
    }

    // Ensure we have required fields
    if (!payload.platform) {
      const hostname = new URL(tab.url).hostname;
      if (hostname.includes("leetcode")) payload.platform = "leetcode";
      else if (hostname.includes("codeforces")) payload.platform = "codeforces";
      else if (hostname.includes("geeksforgeeks")) payload.platform = "gfg";
      else payload.platform = "unknown";
    }
    if (!payload.problemTitle) payload.problemTitle = "Unknown Problem";
    if (!payload.language) payload.language = "C++";
    if (!payload.accepted) payload.accepted = true;
    if (!payload.stats) payload.stats = { runtime: "N/A", memory: "N/A" };

    console.debug("AC Sync popup: Final payload:", payload);

    // Validate payload
    if (!payload || !payload.code || payload.code.length < 5) {
      showToast(
        "No valid submission captured. Make sure you're on a submission page and try again.",
      );
      restorePushButton(pushBtn, originalText);
      return;
    }

    // Validate platform-specific requirements
    const validationError = validateSubmission(payload);
    if (validationError) {
      showToast(validationError);
      restorePushButton(pushBtn, originalText);
      return;
    }

    // Show preview with enhanced status
    const previewEl = $("previewCode");
    const statusEl = $("previewStatus");

    if (previewEl) {
      previewEl.textContent = payload.code?.trim() || "(no code captured)";
    }

    if (statusEl) {
      const lines = (payload.code?.match(/\n/g) || []).length;
      const chars = payload.code?.length || 0;
      statusEl.textContent = `(${lines} lines, ${chars} chars)`;
      statusEl.style.color = "#10b981";
    }

    const panel = $("previewPanel");
    if (panel && !panel.open) panel.open = true;

    // Store payload for potential retry
    window.__cachedPopupPayload = payload;

    pushBtn.textContent = "Pushing...";
    updateStatusLine(0, "Pushing...");

    const finalPayload = {
      ...window.__cachedPopupPayload,
      notes: $("notesInput").value.trim(),
    };

    console.debug("AC Sync popup: Final payload:", finalPayload);

    const pushRes = await sendRuntimeMessageWithTimeout(
      { type: "MANUAL_PUSH", payload: finalPayload },
      45000, // Extended timeout for reliability
    );

    if (pushRes?.ok) {
      const now = Date.now();
      await chrome.storage.local.set({ lastSyncTs: now });
      updateStatusLine(now, "Pushed successfully");

      if (pushRes.unchanged) {
        showToast("Content unchanged - no push needed.");
      } else {
        showToast(`Pushed to ${pushRes.repo}!`);
      }

      await loadAnalytics();
    } else {
      updateStatusLine(0, "Push failed");
      const errorMsg = pushRes?.error || "Push failed.";
      showToast(errorMsg);

      // Store error for debugging
      try {
        await chrome.storage.local.set({ lastPushResponse: pushRes });
      } catch (e) {}
    }
  } catch (error) {
    updateStatusLine(0, "Push timed out");
    showToast(error?.message || "Push failed. Please try again.");
    console.error("AC Sync push error:", error);
  } finally {
    try {
      window.__cachedPopupPayload = null;
    } catch (e) {}
    if (pushBtn) {
      delete pushBtn.dataset.cached;
      delete pushBtn.dataset.confirm;
      delete pushBtn.dataset.loading;
    }
    restorePushButton(pushBtn, originalText);
  }
}

// Helper function to validate submission data
function validateSubmission(payload) {
  if (!payload.platform) {
    return "Unable to detect platform. Please ensure you're on a supported page.";
  }

  if (!payload.problemTitle || payload.problemTitle.length < 3) {
    return "Unable to detect problem title. Please ensure you're on a problem page.";
  }

  // Remove language requirement completely - just ensure we have code
  if (!payload.code || payload.code.trim().length < 10) {
    return "No valid code found. Please ensure you're on a submission page.";
  }

  // Set a default language if missing
  if (!payload.language || payload.language === "Unknown") {
    payload.language = "C++"; // Default for competitive programming
  }

  return null; // No validation errors
}

// Helper function to copy code to clipboard
async function copyCodeToClipboard() {
  const codeEl = $("previewCode");
  if (!codeEl) return;

  const code = codeEl.textContent;
  if (!code || code === "(preview will appear here)") {
    showToast("No code to copy");
    return;
  }

  try {
    await navigator.clipboard.writeText(code);
    showToast("Code copied to clipboard!");
  } catch (error) {
    // Fallback for older browsers
    const textArea = document.createElement("textarea");
    textArea.value = code;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    showToast("Code copied to clipboard!");
  }
}

// Helper function to use cached submission
async function useCachedSubmission() {
  try {
    const stored = await chrome.storage.local.get(["lastDetectedSubmission"]);
    const cached = stored.lastDetectedSubmission;

    if (!cached || !cached.code) {
      showToast("No cached submission available");
      return;
    }

    window.__cachedPopupPayload = cached;

    // Update preview
    const previewEl = $("previewCode");
    if (previewEl) {
      previewEl.textContent = cached.code?.trim() || "(no code captured)";
    }

    // Update status
    const statusEl = $("previewStatus");
    if (statusEl) {
      statusEl.textContent = "(Using cached)";
      statusEl.style.color = "#fbbf24";
    }

    showToast("Using cached submission");
  } catch (error) {
    showToast("Failed to load cached submission");
    console.error("Cache load error:", error);
  }
}

// Helper function to check if URL is supported
function isSupportedPlatform(url) {
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname.includes("leetcode.com") ||
      hostname.includes("codeforces.com") ||
      hostname.includes("geeksforgeeks.org")
    );
  } catch (e) {
    return false;
  }
}

async function loadAnalytics() {
  try {
    chrome.runtime.sendMessage({ type: "GET_ANALYTICS" }, (res) => {
      if (!res?.ok) {
        console.warn("Failed to load analytics:", res);
        return;
      }

      const a = res.analytics;
      $("total").textContent = a.total || 0;
      $("week").textContent = a.solvedWeek || 0;
      $("month").textContent = a.solvedMonth || 0;
      renderGraph(a.recent || []);
    });
  } catch (error) {
    console.error("Analytics loading failed:", error);
  }
}

function renderGraph(recent) {
  const graph = $("graph");
  graph.innerHTML = "";
  const byDay = {};
  recent.forEach((x) => {
    const key = new Date(x.ts).toISOString().slice(0, 10);
    byDay[key] = (byDay[key] || 0) + 1;
  });
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const count = byDay[key] || 0;
    const dot = document.createElement("div");
    dot.className = "dot";
    dot.style.background =
      count === 0
        ? "#1f2937"
        : count < 2
          ? "#1d4ed8"
          : count < 4
            ? "#2563eb"
            : "#60a5fa";
    dot.title = `${key}: ${count} solved`;
    graph.appendChild(dot);
  }
}

function showToast(text, duration = 1800) {
  const t = $("toast");
  if (!t) return;

  t.textContent = text;
  t.style.opacity = "1";

  // Clear existing timeout
  if (t._hideTimeout) {
    clearTimeout(t._hideTimeout);
  }

  t._hideTimeout = setTimeout(() => {
    t.style.opacity = "0";
  }, duration);
}

function updateStatusLine(lastSyncTs, overrideText = "") {
  const el = $("statusLine");
  if (!el) return;
  if (overrideText) {
    el.textContent = overrideText;
    return;
  }
  if (!lastSyncTs) {
    el.textContent = "Ready to push";
    return;
  }
  const mins = Math.max(1, Math.floor((Date.now() - lastSyncTs) / 60000));
  el.textContent = `Last sync: ${mins} min${mins === 1 ? "" : "s"} ago`;
}

function restorePushButton(button, text) {
  button.disabled = false;
  button.textContent = text;
  button.dataset.loading = "0";
}

function sendTabMessageWithTimeout(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error("Taking too long. Try again on submission details page."),
      );
    }, timeoutMs);
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error:
            chrome.runtime.lastError.message ||
            "Open a supported problem page first.",
        });
        return;
      }
      resolve(res);
    });
  });
}

function sendRuntimeMessageWithTimeout(message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Push timed out. Please retry once."));
    }, timeoutMs);
    chrome.runtime.sendMessage(message, (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(
          new Error("Extension background unavailable. Reload extension."),
        );
        return;
      }
      resolve(res);
    });
  });
}

function updateStatusLine(lastSyncTs, overrideText = "") {
  const el = $("statusLine");
  if (!el) return;
  if (overrideText) {
    el.textContent = overrideText;
    return;
  }
  if (!lastSyncTs) {
    el.textContent = "Ready to push";
    return;
  }
  const mins = Math.max(1, Math.floor((Date.now() - lastSyncTs) / 60000));
  el.textContent = `Last sync: ${mins} min${mins === 1 ? "" : "s"} ago`;
}

function restorePushButton(button, text) {
  button.disabled = false;
  button.textContent = text;
  button.dataset.loading = "0";
}

function sendRuntimeMessageWithTimeout(message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Push timed out. Please retry once."));
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(
          new Error("Extension background unavailable. Reload extension."),
        );
        return;
      }
      resolve(res);
    });
  });
}
