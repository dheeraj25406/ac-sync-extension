// content.js — BULLETPROOF PRODUCTION-READY CODEBASE (UPDATE 2023)
(function init() {
  const host = location.hostname;
  console.debug("AC Sync: Content script initializing on:", host);

  const platform = detectPlatform(host);
  console.debug("AC Sync: Detected platform:", platform);

  // expose a small presence flag for quick debugging from the page console
  try {
    window.__acsync_present = !!platform;
    window.__acsync_platform = platform || "none";
  } catch (e) {}

  if (!platform) {
    console.debug("AC Sync: Unsupported platform, content script exiting");
    return;
  }

  console.debug("AC Sync: Setting up platform:", platform);
  setupMessageBridge(platform);
  setupAutoDetection(platform);
})();

function detectPlatform(host) {
  console.debug("AC Sync: Detecting platform for host:", host);

  // Normalize hostname for comparison
  const normalizedHost = host.toLowerCase().trim();

  // Check for LeetCode
  if (normalizedHost.includes("leetcode.com")) {
    console.debug("AC Sync: Detected LeetCode platform");
    return "leetcode";
  }

  // Check for Codeforces
  if (normalizedHost.includes("codeforces.com")) {
    console.debug("AC Sync: Detected Codeforces platform");
    return "codeforces";
  }

  // Check for GeeksforGeeks (multiple domains)
  if (
    normalizedHost.includes("geeksforgeeks.org") ||
    normalizedHost.includes("practice.geeksforgeeks.org")
  ) {
    console.debug("AC Sync: Detected GeeksforGeeks platform");
    return "gfg";
  }

  console.debug("AC Sync: No platform detected for host:", normalizedHost);
  return null;
}

// Global debug function - can be called from console
window.ACSyncDebug = function () {
  console.log("=== AC Sync Debug ===");
  console.log("Platform:", window.__acsync_platform);
  console.log("Present:", window.__acsync_present);
  console.log("URL:", location.href);
  console.log("Hostname:", location.hostname);

  // Test code extraction
  console.log("\nTesting code extraction...");
  const code1 = readCodeFromPage();
  console.log(
    "readCodeFromPage() returned:",
    code1 ? code1.substring(0, 100) + "..." : "EMPTY",
  );

  const code2 = readLeetCodeCode();
  console.log(
    "readLeetCodeCode() returned:",
    code2 ? code2.substring(0, 100) + "..." : "EMPTY",
  );

  return {
    platform: window.__acsync_platform,
    codeFromPage: code1,
    codeFromLeetCode: code2,
  };
};

function isGFGResultPage() {
  return (
    location.hostname.includes("geeksforgeeks") &&
    document.body.innerText.includes("Compilation Results")
  );
}

function setupMessageBridge(platform) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // helpful debug: log incoming requests (keeps noise low by checking type)
    if (message?.type === "COLLECT_CURRENT_SUBMISSION") {
      console.debug(
        "AC Sync content: received COLLECT_CURRENT_SUBMISSION request from popup, platform=",
        platform,
      );
    }
    if (message?.type !== "COLLECT_CURRENT_SUBMISSION") return false;

    console.debug(
      "AC Sync content: collecting submission for platform:",
      platform,
    );

    collectSubmission(platform)
      .then((payload) => {
        console.debug("AC Sync content: collected payload:", {
          platform: payload.platform,
          problemTitle: payload.problemTitle,
          language: payload.language,
          codeLength: payload.code?.length || 0,
        });

        payload.notes = message?.notes?.trim?.() || "";
        sendResponse({ ok: true, payload });
      })
      .catch((error) => {
        console.error("AC Sync content: collection failed:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  });
}

async function getCodeWithRetry() {
  let best = "";
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    let cur = readCodeFromPage();
    if (cur && cur.length > 20) {
      best = cur;
      if ((cur.match(/\n/g) || []).length > 3) break;
    }
  }
  return best;
}

function setupAutoDetection(platform) {
  const observer = new MutationObserver(async () => {
    // light debug to show the observer fired
    // (will be noisy; only present during debugging and safe to remove later)
    try {
      console.debug(
        "AC Sync content: mutation observer triggered (platform=",
        platform,
        ")",
      );
    } catch (e) {}
    try {
      if (!isExtensionContextValid()) return;
      const verdict = readVerdict(platform);
      if (!verdict.trigger) return;
      console.debug("AC Sync content: verdict trigger detected:", verdict);
      await new Promise((r) => setTimeout(r, 800)); // allow editor to load

      const payload = await collectSubmission(platform);

      // 🔥 FORCE retry if code is empty
      if (!payload.code || payload.code.length < 20) {
        console.debug("AC Sync: retrying code capture...");
        payload.code = await getCodeWithRetry();
      }
      payload.accepted = verdict.accepted;
      payload.verdictText = verdict.text;

      if (!payload.problemTitle) return;
      // Do NOT auto-push. Save a lightweight detection record and prompt user to push
      try {
        // Save analytics entry
        const s = await chrome.storage.local.get(["submissions"]);
        const list = s.submissions || [];
        list.push({
          ts: Date.now(),
          problem: payload.problemTitle,
          platform: payload.platform,
          verdict:
            payload.verdictText || (payload.accepted ? "Accepted" : "Failed"),
        });
        await chrome.storage.local.set({ submissions: list });
        // Persist the full detected submission so user can manually push later
        try {
          try {
            const originalCode = String(payload.code || "");
            let codeToSave = originalCode;
            // 🔥 FORCE PRESERVE NEWLINES (CRITICAL FIX)
            codeToSave = codeToSave
              .replace(/\r\n/g, "\n") // normalize windows line endings
              .replace(/\r/g, "\n") // normalize old mac
              .replace(/\n{2,}/g, "\n"); // avoid excessive blank lines (optional)̦
            let codeLen = codeToSave.length;
            let maybeTruncated = false;

            // Helper to compute trimmed length (non-whitespace characters)
            const trimmedLen = (s) =>
              String(s || "").replace(/[ \t\r]+/g, "").length;

            // If the captured code is suspiciously short in terms of non-whitespace
            // content, attempt retries so editors have time to render. Compare
            // trimmed lengths and prefer the capture with larger trimmed length.
            if (trimmedLen(codeToSave) < 5) {
              maybeTruncated = true;
              for (let i = 0; i < 6; i++) {
                // small backoff increasing slightly
                await new Promise((r) => setTimeout(r, 120 * (i + 1)));
                try {
                  const fresh = readCodeFromPage() || "";
                  // Prefer the capture with larger trimmed (non-whitespace) length.
                  if (trimmedLen(fresh) > trimmedLen(codeToSave)) {
                    codeToSave = fresh;
                    codeLen = codeToSave.length;
                  }
                  // stop early if we obtained a reasonably sized trimmed capture
                  if (trimmedLen(codeToSave) > 40) break;
                } catch (e) {
                  // ignore read failures during retries
                }
              }
            }

            const preview = String(codeToSave || "")
              .slice(0, 200)
              .replace(/\n/g, "\\n");
            // add a small debug object so popup and background can inspect what was saved
            const toSave = {
              ...payload,
              code: codeToSave,
              _debug: { codeLen, preview, maybeTruncated },
            };
            console.debug(
              "AC Sync content: saving detected submission. codeLen:",
              codeLen,
              "preview:",
              preview,
              "maybeTruncated:",
              maybeTruncated,
            );
            await chrome.storage.local.set({ lastDetectedSubmission: toSave });
          } catch (e) {
            // ignore storage errors
            try {
              await chrome.storage.local.set({
                lastDetectedSubmission: payload,
              });
            } catch (ee) {}
          }
        } catch (e) {
          // ignore storage errors
        }
      } catch (e) {
        // storage failures shouldn't break page behavior
      }

      if (payload.accepted) {
        showToast(`Accepted: ${payload.problemTitle}. Open extension to push.`);
      } else {
        showToast(`${payload.problemTitle}: ${payload.verdictText}`);
      }

      // Temporarily disconnect observer to avoid duplicate triggers, then resume
      observer.disconnect();
      setTimeout(() => {
        try {
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        } catch (e) {
          // ignore
        }
      }, 2000);
    } catch (error) {
      if (!isContextInvalidatedError(error)) {
        console.warn("AC Sync content observer error:", error);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function safeSendRuntimeMessage(message, callback) {
  try {
    chrome.runtime.sendMessage(message, callback);
    return true;
  } catch (error) {
    if (!isContextInvalidatedError(error)) {
      console.warn("AC Sync runtime message failed:", error);
    }
    return false;
  }
}

function isExtensionContextValid() {
  try {
    return !!chrome?.runtime?.id;
  } catch (error) {
    return false;
  }
}

function isContextInvalidatedError(error) {
  return /Extension context invalidated/i.test(
    String(error?.message || error || ""),
  );
}

function getRuntimeLastErrorMessage() {
  try {
    return chrome.runtime?.lastError?.message || "";
  } catch (error) {
    return "Extension context invalidated";
  }
}

function readVerdict(platform) {
  try {
    // ---------------- LEETCODE ----------------
    if (platform === "leetcode") {
      // Enhanced LeetCode verdict detection
      const verdictSelectors = [
        '[data-e2e-locator="submission-result"]',
        ".text-success",
        ".text-error",
        ".submission-result",
        ".status-label",
        ".result-success",
        ".result-failed",
      ];

      for (const selector of verdictSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const txt = el.textContent?.trim() || "";
          console.debug(`[AC Sync] LeetCode verdict from ${selector}:`, txt);

          if (/Accepted/i.test(txt))
            return { trigger: true, accepted: true, text: "Accepted" };

          if (
            /Wrong Answer|Time Limit Exceeded|Runtime Error|Compile Error|Memory Limit Exceeded/i.test(
              txt,
            )
          )
            return { trigger: true, accepted: false, text: txt };
        }
      }

      // Check submission table for status
      const submissionRows = document.querySelectorAll("tr, .submission-row");
      for (const row of submissionRows) {
        const statusCell = row.querySelector(
          "td:nth-child(1), .status-cell, .verdict-cell",
        );
        if (statusCell) {
          const txt = statusCell.textContent?.trim() || "";
          if (/Accepted/i.test(txt))
            return { trigger: true, accepted: true, text: "Accepted" };
          if (/Wrong|Time|Error|Limit/i.test(txt))
            return { trigger: true, accepted: false, text: txt };
        }
      }

      // Check page URL for submission context
      if (location.pathname.includes("/submissions/")) {
        // On submission page, assume we want to trigger
        return { trigger: true, accepted: true, text: "Submission Page" };
      }

      return { trigger: false, accepted: false, text: "" };
    }

    // ---------------- CODEFORCES ----------------
    if (platform === "codeforces") {
      const el =
        document.querySelector(".verdict-accepted") ||
        document.querySelector(".verdict");

      const txt = el?.textContent?.trim() || "";

      if (/Accepted|OK/i.test(txt))
        return { trigger: true, accepted: true, text: "Accepted" };

      if (
        /Wrong answer|Time limit exceeded|Runtime error|Compilation error/i.test(
          txt,
        )
      )
        return { trigger: true, accepted: false, text: txt };

      return { trigger: false, accepted: false, text: "" };
    }

    // ---------------- GFG ----------------
    if (platform === "gfg") {
      const el =
        document.querySelector(".success-message") ||
        document.querySelector(".ui success message") ||
        document.querySelector(".output");

      const txt = el?.textContent?.trim() || "";

      if (/Problem Solved Successfully|Accepted|Correct/i.test(txt))
        return { trigger: true, accepted: true, text: "Accepted" };

      if (
        /Wrong Answer|Compilation Error|Runtime Error|Time Limit Exceeded/i.test(
          txt,
        )
      )
        return { trigger: true, accepted: false, text: txt };

      return { trigger: false, accepted: false, text: "" };
    }
  } catch (e) {}

  return { trigger: false, accepted: false, text: "" };
}

async function collectSubmission(platform) {
  if (platform === "leetcode") return collectLeetCode();
  if (platform === "codeforces") return collectCodeforces();
  if (platform === "gfg") return collectGfg();
  throw new Error("Unsupported platform.");
}

/* ---------------- LeetCode ---------------- */
async function collectLeetCode() {
  console.debug("AC Sync: Starting LeetCode collection from:", location.href);

  // Get basic info
  const title =
    document.title.replace(" - LeetCode", "").trim() || "Unknown Problem";

  // Extract code - try multiple times
  let code = "";
  for (let i = 0; i < 3; i++) {
    code = readCodeFromPage();
    if (code && code.length > 30) {
      console.debug("AC Sync: Successfully extracted code on attempt", i + 1);
      break;
    }
    console.debug(
      "AC Sync: Code extraction attempt",
      i + 1,
      "failed, retrying...",
    );
    await new Promise((r) => setTimeout(r, 500));
  }

  // Detect language from code content
  let language = "C++"; // default
  if (code.includes("#include")) language = "C++";
  else if (code.includes("def ")) language = "Python";
  else if (code.includes("public class")) language = "Java";
  else if (
    code.includes("function") ||
    code.includes("const ") ||
    code.includes("let ")
  )
    language = "JavaScript";

  const result = {
    platform: "leetcode",
    problemTitle: cleanTitle(title),
    difficulty: "Medium", // Simplified
    tags: [],
    language: language,
    code: code.trim(),
    accepted: true,
    submissionId: location.pathname.split("/").pop() || "",
    stats: { runtime: "N/A", memory: "N/A" },
    problemUrl: location.href,
    notes: "",
  };

  console.debug(
    "AC Sync: LeetCode collection complete - Code length:",
    result.code?.length || 0,
  );

  return Promise.resolve(result);
}

// Enhanced LeetCode language detection
function detectLeetCodeLanguage() {
  // Try multiple strategies to detect language on LeetCode

  // Strategy 1: Check submission page language selector
  const submissionLang =
    queryText("select option[selected]") ||
    queryText(".select__language") ||
    queryText("[data-e2e-locator*='language']") ||
    queryText(".language-selector");
  if (submissionLang && submissionLang !== "Unknown") {
    return normalizeLanguageName(submissionLang);
  }

  // Strategy 2: Check current editor language button
  const editorLang =
    queryText("button[data-mode-id]") ||
    queryText(".lang-button") ||
    queryText("[data-active-lang]") ||
    queryText(".editor-lang");
  if (editorLang && editorLang !== "Unknown") {
    return normalizeLanguageName(editorLang);
  }

  // Strategy 3: Look for language in submission table
  const submissionTableLang =
    queryText(".language-column") ||
    queryText("td:nth-child(3)") || // Language is often 3rd column
    queryText(".submission-language");
  if (submissionTableLang && submissionTableLang !== "Unknown") {
    return normalizeLanguageName(submissionTableLang);
  }

  // Strategy 4: Check URL for language hints
  const urlLang = detectLanguageFromUrl();
  if (urlLang) {
    return urlLang;
  }

  // Strategy 5: Detect from code content
  const code = readCodeFromPage();
  if (code && code.length > 50) {
    const detectedLang = detectLanguage(code);
    if (detectedLang !== "Unknown") {
      return detectedLang;
    }
  }

  return "Unknown";
}

// Helper to detect language from URL patterns
function detectLanguageFromUrl() {
  const url = location.href;
  const pathname = location.pathname;

  // Check for language indicators in URL
  if (url.includes("cpp") || url.includes("c++")) return "C++";
  if (url.includes("java")) return "Java";
  if (url.includes("python") || url.includes("py")) return "Python";
  if (url.includes("javascript") || url.includes("js")) return "JavaScript";

  // Check submission page patterns
  if (pathname.includes("/submissions/")) {
    // Look for language in page title or meta
    const title = document.title.toLowerCase();
    if (title.includes("c++") || title.includes("cpp")) return "C++";
    if (title.includes("java")) return "Java";
    if (title.includes("python")) return "Python";
    if (title.includes("javascript") || title.includes("js"))
      return "JavaScript";
  }

  return null;
}

// Detect language from code content
function detectLanguage(code) {
  if (!code || code.length < 10) return "Unknown";

  if (
    code.includes("#include") ||
    code.includes("std::") ||
    (code.includes("int main") && code.includes(";"))
  )
    return "C++";
  if (code.includes("public class") || code.includes("import java."))
    return "Java";
  if (code.includes("def ") && code.includes(":")) return "Python";
  if (
    code.includes("function") ||
    code.includes("const ") ||
    code.includes("let ")
  )
    return "JavaScript";

  return "Unknown";
}

// Try robust extraction of runtime/memory values for LeetCode pages
function getLeetCodeStats() {
  // Try a number of selectors commonly used across LeetCode UIs
  const candidates = [
    "span[data-key='runtime']",
    "span[data-key='memory']",
    ".runtime",
    ".memory",
    ".runtime__value",
    ".memory__value",
    ".submission-runtime",
    ".submission-memory",
    ".status-runtime",
    ".status-memory",
    ".submission__stats",
    ".result-runtime",
    ".result-memory",
    ".css-viewport div:contains(runtime)",
  ];

  let runtime = "";
  let memory = "";

  for (const sel of candidates) {
    try {
      // skip pseudo selector entries we can't query
      if (sel.includes(":contains")) continue;
      const el = document.querySelector(sel);
      if (!el) continue;
      const txt = (el.textContent || "").trim();
      const rMatch = txt.match(/(\d+(?:\.\d+)?\s*ms)/i);
      const mMatch = txt.match(/(\d+(?:\.\d+)?\s*MB)/i);
      if (!runtime && rMatch) runtime = rMatch[1];
      if (!memory && mMatch) memory = mMatch[1];
      if (runtime && memory) break;
    } catch (e) {
      // ignore per-selector failures
    }
  }

  // If selectors failed, look for labeled nodes that contain 'Runtime' or 'Memory'
  if (!runtime || !memory) {
    try {
      const nodes = Array.from(document.querySelectorAll("body *"));
      for (const n of nodes) {
        const txt = (n.textContent || "").trim();
        if (!txt) continue;
        if (!runtime && /runtime\b/i.test(txt)) {
          const r = txt.match(/(\d+(?:\.\d+)?\s*ms)/i);
          if (r) runtime = r[1];
        }
        if (!memory && /memory\b/i.test(txt)) {
          const m = txt.match(/(\d+(?:\.\d+)?\s*MB)/i);
          if (m) memory = m[1];
        }
        if (runtime && memory) break;
      }
    } catch (e) {
      // ignore
    }
  }

  // Last resort: scan recent document text for first occurrences of ms/MB patterns
  if (!runtime || !memory) {
    const body = document.body?.innerText || "";
    if (!runtime) {
      const r = body.match(/(\d+(?:\.\d+)?\s*ms)/i);
      if (r) runtime = r[1];
    }
    if (!memory) {
      const m = body.match(/(\d+(?:\.\d+)?\s*MB)/i);
      if (m) memory = m[1];
    }
  }

  return { runtime: runtime || "", memory: memory || "" };
}

function normalizeStatValue(val, type) {
  if (!val) return "";
  // collapse whitespace and newlines
  let v = String(val).replace(/\s+/g, " ").trim();

  // If it's a bare number, append appropriate unit
  if (/^\d+$/.test(v)) {
    if (type === "runtime") v = `${v} ms`;
    if (type === "memory") v = `${v} MB`;
  }

  // If it contains number + unit but unit is stuck on next line earlier, normalize
  const mRuntime = v.match(/(\d+)\s*(ms)/i);
  if (mRuntime && type === "runtime") v = `${mRuntime[1]} ms`;
  const mMemory = v.match(/(\d+)\s*(MB)/i);
  if (mMemory && type === "memory") v = `${mMemory[1]} MB`;

  return v;
}

/* ---------------- Codeforces ---------------- */
function collectCodeforces() {
  return collectCodeforcesSmart();
}

async function collectCodeforcesSmart() {
  console.debug("AC Sync: Collecting Codeforces from:", location.href);

  // 1. Submission page (best case)
  const fromSubmissionPage = collectFromCodeforcesSubmissionPage();
  if (fromSubmissionPage) {
    console.debug("AC Sync: Found Codeforces submission page data");
    return fromSubmissionPage;
  }

  // 2. My submissions
  const fromMySubmissions = await collectFromCodeforcesMySubmissions();
  if (fromMySubmissions) {
    console.debug("AC Sync: Found Codeforces my submissions data");
    return fromMySubmissions;
  }

  // 3. Fallback: problem page with code visible
  console.debug("AC Sync: Trying Codeforces fallback extraction");

  const title =
    queryText(".problem-statement .title") ||
    queryText(".caption.titled") ||
    queryText("h1") ||
    document.title.split(" - Codeforces")[0];

  let code = "";

  // Try multiple Codeforces code selectors
  const codeSelectors = [
    "#program-source-text",
    ".program-source",
    ".submission-source",
    ".source-code",
    "pre code",
    "pre",
    ".ace_content",
    ".view-lines",
    ".ace_editor",
    ".monaco-editor",
    "textarea",
  ];

  for (const selector of codeSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        let text = "";

        if (element.tagName === "TEXTAREA") {
          text = element.value;
        } else if (
          selector.includes(".ace_content") ||
          selector.includes(".view-lines")
        ) {
          // Monaco/ACE editor - extract lines properly
          const lines = element.querySelectorAll(".ace_line, .view-line");
          if (lines.length > 0) {
            text = Array.from(lines)
              .map((line) => line.textContent.replace(/\u00a0/g, " ").trim())
              .filter((line) => line.length > 0)
              .join("\n");
          } else {
            text = element.textContent || "";
          }
        } else {
          const lineElements = element.querySelectorAll("li, .line, tr td");
          if (lineElements.length > 1) {
            text = Array.from(lineElements)
              .map((el) => el.textContent.trim())
              .filter((line) => line.length > 0)
              .join("\n");
          } else {
            text = element.textContent || "";
          }
        }

        text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

        if (text.length > 50) {
          console.debug(
            `AC Sync: Found Codeforces code with selector ${selector}, length: ${text.length}`,
          );
          code = text;
          break;
        }
      }
    } catch (e) {
      console.debug(`AC Sync: Error with Codeforces selector ${selector}:`, e);
    }
  }

  // Final fallback: use generic code extraction
  if (!code || code.length < 20) {
    console.debug("AC Sync: Using generic Codeforces code extraction");
    code = readCodeFromPage() || "";
  }

  const language =
    queryText("select[name='programTypeId'] option[selected]") ||
    queryText(".language") ||
    queryText("select")?.value?.trim() ||
    "Unknown";

  const result = {
    platform: "codeforces",
    problemTitle: cleanTitle(title),
    difficulty: mapCodeforcesDifficulty(inferCodeforcesRating()),
    tags: [],
    language: language.trim(),
    code: code.trim(),
    accepted: true,
    submissionId: "",
    stats: {},
    problemUrl: location.href,
    notes: "",
  };

  console.debug("AC Sync: Codeforces collection result:", {
    platform: result.platform,
    problemTitle: result.problemTitle,
    language: result.language,
    codeLength: result.code?.length || 0,
  });

  return result;
}

function collectFromCodeforcesSubmissionPage() {
  const submissionMatch = location.pathname.match(
    /\/contest\/(\d+)\/submission\/(\d+)/,
  );
  if (!submissionMatch) return null;

  const title =
    queryText(".datatable a[href*='/problem/']") ||
    queryText(".caption.titled") ||
    queryText(".problem-statement .title") ||
    document.title;

  const language =
    queryText(".datatable td:nth-child(5)") ||
    queryText(".language") ||
    "Unknown";

  // Use enhanced code extraction
  const code = readCodeforcesCode() || "";

  const difficulty = mapCodeforcesDifficulty(inferCodeforcesRating());

  // Validate we have meaningful code
  if (!code || code.length < 20) {
    console.debug("AC Sync: No valid code found on Codeforces submission page");
    return null;
  }

  return {
    platform: "codeforces",
    problemTitle: cleanTitle(title),
    difficulty,
    tags: [],
    language,
    code: code.trim(),
    accepted: true,
    submissionId: submissionMatch[2],
    stats: {},
    problemUrl:
      location.origin + location.pathname.replace(/\/submission\/\d+$/, ""),
    notes: "",
  };
}

async function collectFromCodeforcesMySubmissions() {
  // Look for a selected row in submissions table (user's submissions)
  try {
    const rows = Array.from(
      document.querySelectorAll(".status-frame-datatable tr, .datatable tr"),
    );
    if (!rows.length) return null;

    // Find the most recent accepted row with a link to view source
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const verdict = row.querySelector(
        ".verdict-cell, .status-cell, .verdict",
      );
      const verdictText = verdict?.textContent?.trim() || "";
      if (!/accepted|ok/i.test(verdictText)) continue;

      // Try to extract problem link and submission id
      const link = row.querySelector(
        "a[href*='/problem/'], a[href*='/contest/']",
      );
      const problemTitle =
        link?.textContent?.trim() ||
        queryText(".problem-title") ||
        document.title;
      // Try to open modal or fetch source if available in DOM
      const viewLink = row.querySelector(
        "a[href*='/submission/'], a.view-source, a.view-submission",
      );
      if (viewLink) {
        // If the source is present in the page (e.g., #program-source-text), use it
        const codeEl = document.querySelector("#program-source-text");
        if (codeEl && codeEl.textContent.trim().length > 0) {
          return {
            platform: "codeforces",
            problemTitle: cleanTitle(problemTitle),
            difficulty: mapCodeforcesDifficulty(inferCodeforcesRating()),
            tags: [],
            language: queryText(".lang") || "Unknown",
            code: codeEl.textContent.trim(),
            accepted: true,
            submissionId: (viewLink.href || "").split("/").pop(),
            stats: {},
            problemUrl: location.origin + location.pathname,
            notes: "",
          };
        }

        // If not, try to click/view modal (non-blocking)
        try {
          viewLink.click();
          await new Promise((r) => setTimeout(r, 300));
          const modalCode = readCodeforcesVisibleSourceModal();
          if (modalCode) {
            return {
              platform: "codeforces",
              problemTitle: cleanTitle(problemTitle),
              difficulty: mapCodeforcesDifficulty(inferCodeforcesRating()),
              tags: [],
              language: queryText(".lang") || "Unknown",
              code: modalCode,
              accepted: true,
              submissionId: (viewLink.href || "").split("/").pop(),
              stats: {},
              problemUrl: location.origin + location.pathname,
              notes: "",
            };
          }
        } catch (e) {
          // ignore click errors
        }
      }
    }
  } catch (e) {
    // ignore and fallback
  }
  return null;
}

function readCodeforcesVisibleSourceModal() {
  // Codeforces modal often contains #program-source-text or .program-source
  const el =
    document.querySelector("#program-source-text") ||
    document.querySelector(".program-source") ||
    document.querySelector(".submission-source") ||
    document.querySelector(".source-code");
  if (el) {
    const lines = el.querySelectorAll("li, .line");
    if (lines.length > 0) {
      return Array.from(lines)
        .map((l) => l.textContent)
        .join("\n")
        .trim();
    }
    return el.textContent?.trim() || "";
  }
  // Try to find pre/code blocks inside modals
  const pre = document.querySelector(
    ".modal pre, .modal code, .popup pre, .popup code",
  );
  if (pre) return pre.textContent?.trim() || "";
  return "";
}

function inferCodeforcesRating() {
  // Try to read rating from problem statement or meta
  const ratingText =
    queryText(".problem-statement .difficulty") ||
    queryText(".problem-constraints") ||
    queryText(".problem-tags") ||
    queryText(".title") ||
    document.body?.innerText?.slice(0, 8000) ||
    "";
  const match = ratingText.match(/rating\s*[:\-]?\s*(\d{3,4})/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

function mapCodeforcesDifficulty(rating) {
  if (!rating) return "Unknown";
  if (rating < 1200) return "Easy";
  if (rating < 1800) return "Medium";
  return "Hard";
}

/* ---------------- GeeksforGeeks ---------------- */
function collectGfg() {
  console.debug("AC Sync: Collecting from GFG page:", location.href);

  // 🔥 HANDLE GFG RESULT PAGE (NO CODE AVAILABLE)
  if (
    location.hostname.includes("geeksforgeeks") &&
    document.body.innerText.includes("Compilation Results")
  ) {
    console.debug("AC Sync: GFG result page detected (no code here)");

    return Promise.resolve({
      platform: "gfg",
      problemTitle: "",
      difficulty: "",
      tags: [],
      language: "",
      code: "",
      accepted: false,
      submissionId: "",
      stats: {},
      problemUrl: location.href,
      notes: "",
      error: "GFG result page has no code. Open problem page.",
    });
  }

  const title =
    queryText(".problem-tab__name") ||
    queryText(".problems_header_content h1") ||
    queryText("h1") ||
    document.title.replace(" - GeeksforGeeks", "").trim();

  const difficulty = extractGfgDifficulty() || inferDifficultyFromBody();

  const language =
    detectGfgLanguage() ||
    queryText("select option[selected]") ||
    document.querySelector("select")?.value?.trim() ||
    "Unknown";

  let code = readGfgCode() || readTextAreaCode() || readCodeFromPage() || "";

  // 🔥 EXTRA SAFETY: retry if code is weak
  if (!code || code.length < 20) {
    console.debug("AC Sync: retrying GFG code capture...");
    code = readCodeFromPage() || code;
  }

  const result = {
    platform: "gfg",
    problemTitle: cleanTitle(title),
    difficulty: normalizeDifficulty(difficulty),
    tags: [],
    language: language.trim(),
    code: code.trim(),
    accepted: true,
    submissionId: location.pathname,
    stats: {},
    problemUrl: location.href,
    notes: "",
  };

  console.debug("AC Sync: GFG collection result:", result);
  return Promise.resolve(result);
}
// Try to detect language on GeeksforGeeks pages. GFG uses several different
// language selectors depending on the problem/practice UI; try a number of
// selectors and fall back to inferring from code.
function detectGfgLanguage() {
  try {
    // common select controls
    const selCandidates = [
      "select[data-lang]",
      "select#language",
      "select[name='language']",
      "select[name='lang']",
      ".language-select",
      ".select-language",
      ".practice-language",
    ];
    for (const s of selCandidates) {
      try {
        const el = document.querySelector(s);
        if (!el) continue;
        const v = (
          el.value ||
          el.textContent ||
          el.getAttribute("data-lang") ||
          ""
        ).trim();
        if (v) return normalizeLanguageName(v);
      } catch (e) {}
    }

    // Sometimes GFG shows a small button or dropdown label with language text
    const labelCandidates = [
      ".lang",
      ".lang-label",
      ".language",
      "button[data-lang]",
    ];
    for (const sel of labelCandidates) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const t = (el.textContent || "").trim();
      if (t && t.length < 30 && /[A-Za-z+#]/.test(t))
        return normalizeLanguageName(t);
    }

    // Try to detect from code block classes like language-cpp, lang-python
    const codeEl = document.querySelector('pre code[class*="language-"]');
    if (codeEl) {
      const cls = Array.from(codeEl.classList).find((c) =>
        c.startsWith("language-"),
      );
      if (cls) return normalizeLanguageName(cls.replace(/^language-/, ""));
    }

    // Fallback: inspect editor content for language-specific tokens
    const codeSample =
      readGfgCode() || readCodeFromPage() || readTextAreaCode();
    if (codeSample && codeSample.length > 10) {
      if (/\b#include\b|std::|cout\b|cin\b/.test(codeSample)) return "C++";
      if (/\bdef\b|print\(/.test(codeSample)) return "Python";
      if (/public class|System\.out|println\(|import java\./.test(codeSample))
        return "Java";
      if (/console\.log|function\s+\w+|let\s|const\s/.test(codeSample))
        return "JavaScript";
    }

    return null;
  } catch (e) {
    return null;
  }
}

function normalizeLanguageName(raw) {
  const r = String(raw || "").toLowerCase();
  if (r.includes("c++") || r.includes("cpp") || r.includes("c plus"))
    return "C++";
  if (r.includes("java")) return "Java";
  if (r.includes("python")) return "Python";
  if (r.includes("js") || r.includes("javascript")) return "JavaScript";
  if (r.includes("c#") || r.includes("csharp")) return "C#";
  return String(raw || "").trim();
}

function extractGfgDifficulty() {
  const selectors = [
    "[class*='difficulty']",
    ".problems_header_description",
    ".problem-tab__header",
    ".problem-navbar",
    ".problem-meta-info",
    ".difficulty-level",
  ];
  const combined = selectors
    .map((selector) => queryText(selector))
    .filter(Boolean)
    .join(" ");
  const source = `${combined} ${document.body?.innerText?.slice(0, 12000) || ""}`;
  const match = source.match(/(easy|medium|hard)/i);
  if (match) return match[1];
  return "";
}

function readGfgCode() {
  console.debug("AC Sync: Attempting to read GFG code from:", location.href);

  // Try modern GFG selectors first
  const modernSelectors = [
    "[data-e2e-locator*='code']",
    ".editor-wrapper .ace_editor",
    ".monaco-editor .view-lines",
    ".code-editor textarea",
    ".ide-editor textarea",
    ".input-area textarea",
    ".code-input textarea",
  ];

  for (const selector of modernSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        let text = "";
        if (element.tagName === "TEXTAREA") {
          text = element.value;
        } else {
          text = element.textContent || element.innerText || "";
        }

        // Clean up the text
        text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

        if (text.length > 50) {
          console.debug(
            `AC Sync: Found GFG code with selector ${selector}, length: ${text.length}`,
          );
          return text;
        }
      }
    } catch (e) {
      console.debug(`AC Sync: Error with selector ${selector}:`, e);
    }
  }

  // Fallback to older selectors
  const textareas = Array.from(document.querySelectorAll("textarea"));
  const textareaCode = textareas
    .map((el) => (el.value || el.textContent || "").trim())
    .find((v) => v.length > 20);
  if (textareaCode) {
    console.debug(
      "AC Sync: Found GFG code in textarea, length:",
      textareaCode.length,
    );
    return textareaCode;
  }

  // Try ACE editor lines
  const aceLines = Array.from(
    document.querySelectorAll(".ace_layer.ace_text-layer .ace_line"),
  )
    .map((el) => (el.textContent || "").replace(/\u00a0/g, " "))
    .map((line) => line.replace(/\s+$/g, ""));
  if (aceLines.length > 0) {
    const joined = aceLines.join("\n").trim();
    if (joined.length > 50) {
      console.debug(
        "AC Sync: Found GFG code in ACE editor, length:",
        joined.length,
      );
      return joined;
    }
  }

  // Try generic code blocks
  const codeBlocks = Array.from(
    document.querySelectorAll("pre, code, .code-block, .source-code"),
  )
    .map((el) => (el.textContent || el.innerText || "").trim())
    .filter((text) => text.length > 20);

  if (codeBlocks.length > 0) {
    const bestBlock = codeBlocks.sort((a, b) => b.length - a.length)[0];
    console.debug(
      "AC Sync: Found GFG code in block, length:",
      bestBlock.length,
    );
    return bestBlock;
  }

  console.debug("AC Sync: No GFG code found with any selector");
  return "";
}

/* ---------------- Generic helpers ---------------- */
function queryText(selector) {
  try {
    return document.querySelector(selector)?.textContent?.trim() || "";
  } catch (e) {
    return "";
  }
}

// Enhanced code extraction for Codeforces to prevent single-line issues
function readCodeforcesCode() {
  let code = "";

  // Try multiple selectors in order of preference
  const selectors = [
    "#program-source-text",
    ".program-source",
    ".submission-source",
    ".source-code",
    "pre code",
    "pre",
    ".ace_content",
    ".view-lines",
  ];

  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        let text = "";

        // Handle different element types
        if (element.tagName === "TEXTAREA") {
          text = element.value;
        } else if (
          selector.includes(".ace_content") ||
          selector.includes(".view-lines")
        ) {
          // Monaco/ACE editor - extract lines properly
          const lines = element.querySelectorAll(".ace_line, .view-line");
          if (lines.length > 0) {
            text = Array.from(lines)
              .map((line) => line.textContent.replace(/\u00a0/g, " ").trim())
              .filter((line) => line.length > 0)
              .join("\n");
          } else {
            text = element.textContent || "";
          }
        } else {
          // Regular element - get text content
          text = element.textContent || "";

          // If it has line elements, join them properly
          const lineElements = element.querySelectorAll("li, .line, tr td");
          if (lineElements.length > 1) {
            text = Array.from(lineElements)
              .map((el) => el.textContent.trim())
              .filter((line) => line.length > 0)
              .join("\n");
          }
        }

        // Clean up and validate
        text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

        // Check if this looks like valid code
        if (
          text.length > 50 &&
          (text.includes("\n") ||
            text.includes(";") ||
            text.includes("{") ||
            text.includes("#include"))
        ) {
          code = text;
          break;
        }
      }
    } catch (e) {
      console.debug("AC Sync: Error with selector", selector, e);
    }
  }

  return code;
}

function readCodeFromPage() {
  console.debug("AC Sync: Reading code from page...");

  // STRATEGY 1: Try textarea first (most reliable)
  const textareas = document.querySelectorAll("textarea");
  for (const ta of textareas) {
    const val = ta.value?.trim();
    if (val && val.length > 30) {
      console.debug("AC Sync: Found code in textarea, length:", val.length);
      return val;
    }
  }

  // STRATEGY 2: Try pre/code blocks (syntax highlighted code)
  const codeBlocks = document.querySelectorAll("pre, code");
  for (const block of codeBlocks) {
    const text = block.textContent?.trim();
    if (
      text &&
      text.length > 50 &&
      (text.includes("class") ||
        text.includes("int ") ||
        text.includes("def ") ||
        text.includes("#include") ||
        text.includes("function"))
    ) {
      console.debug(
        "AC Sync: Found code in pre/code block, length:",
        text.length,
      );
      return text;
    }
  }

  // STRATEGY 3: Try Monaco editor (LeetCode)
  const monacoLines = document.querySelectorAll(".monaco-editor .view-line");
  if (monacoLines.length > 0) {
    const lines = Array.from(monacoLines)
      .map((el) => el.textContent || "")
      .filter((line) => line.trim().length > 0);
    if (lines.length > 5) {
      const code = lines.join("\n");
      console.debug(
        "AC Sync: Found code in Monaco editor, lines:",
        lines.length,
      );
      return code;
    }
  }

  // STRATEGY 4: Try view-lines (alternative Monaco)
  const viewLines = document.querySelectorAll(".view-line");
  if (viewLines.length > 0) {
    const lines = Array.from(viewLines)
      .map((el) => el.textContent || "")
      .filter((line) => line.trim().length > 0);
    if (lines.length > 5) {
      const code = lines.join("\n");
      console.debug("AC Sync: Found code in view-lines, lines:", lines.length);
      return code;
    }
  }

  // STRATEGY 5: Try any element with 'code' in class name
  const codeElements = document.querySelectorAll("[class*='code']");
  for (const el of codeElements) {
    const text = el.textContent?.trim();
    if (
      text &&
      text.length > 100 &&
      (text.includes(";") || text.includes("{") || text.includes("}"))
    ) {
      console.debug(
        "AC Sync: Found code in element with 'code' class, length:",
        text.length,
      );
      return text;
    }
  }

  // STRATEGY 6: Try ACE editor
  const aceLines = document.querySelectorAll(".ace_line");
  if (aceLines.length > 0) {
    const lines = Array.from(aceLines)
      .map((el) => el.textContent?.replace(/\u00a0/g, " ") || "")
      .filter((line) => line.trim().length > 0);
    if (lines.length > 5) {
      const code = lines.join("\n");
      console.debug("AC Sync: Found code in ACE editor, lines:", lines.length);
      return code;
    }
  }

  // STRATEGY 7: Final fallback - scan body for code patterns
  const bodyText = document.body?.innerText || "";
  const patterns = [
    /class\s+Solution\s*\{[\s\S]{100,5000}?\n\}/,
    /#include[\s\S]{100,5000}?(?=\n\n|\Z)/,
    /def\s+\w+\s*\([\s\S]{100,5000}?\n\n/,
  ];

  for (const pattern of patterns) {
    const match = bodyText.match(pattern);
    if (match && match[0].length > 100) {
      console.debug(
        "AC Sync: Found code via pattern matching, length:",
        match[0].length,
      );
      return match[0];
    }
  }

  console.debug("AC Sync: No code found with any strategy");
  return "";
}

function readTextAreaCode() {
  try {
    return document.querySelector("textarea")?.value || "";
  } catch (e) {
    return "";
  }
}

// Debug helper to log all available elements
function debugLogAllElements() {
  console.debug("AC Sync DEBUG: Logging all potential code containers...");

  const debugSelectors = [
    "pre",
    "code",
    "textarea",
    "[class*='code']",
    "[class*='editor']",
    "[class*='view']",
    "[class*='monaco']",
    "[class*='ace']",
    "[class*='syntax']",
  ];

  debugSelectors.forEach((selector) => {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      console.debug(
        `AC Sync DEBUG: Found ${elements.length} elements for "${selector}"`,
      );
      elements.forEach((el, i) => {
        const text = (el.textContent || el.innerText || "").substring(0, 100);
        console.debug(`  [${i}] ${el.tagName}.${el.className}: "${text}..."`);
      });
    }
  });
}

// Specific LeetCode code extraction
function readLeetCodeCode() {
  console.debug("AC Sync: Attempting LeetCode-specific code extraction");

  // Debug: Log all available elements
  debugLogAllElements();

  // LeetCode specific selectors based on actual DOM inspection
  const leetcodeSelectors = [
    // Monaco editor - view lines
    ".monaco-editor .view-lines .view-line",
    ".monaco-editor .view-line",
    ".view-lines .view-line",
    ".view-line",

    // Monaco editor containers
    ".monaco-editor",
    "[class*='monaco']",

    // Code display areas
    "pre",
    "code",
    "[class*='code']",

    // LeetCode specific classes (from actual inspection)
    ".hljs",
    ".CodeMirror",
    ".cm-s-default",

    // Submission page
    ".submission",
    ".submissions",

    // Editor areas
    ".editor",
    "[class*='editor']",

    // Solution code
    ".solution",
    ".answer",

    // Line containers
    ".line",
    ".lines",
  ];

  for (const selector of leetcodeSelectors) {
    try {
      const elements = document.querySelectorAll(selector);

      console.debug(
        `AC Sync: Selector "${selector}" found ${elements.length} elements`,
      );

      if (elements.length > 0) {
        // For Monaco editor with view-lines
        if (selector.includes("view-line")) {
          const lines = Array.from(elements)
            .map((el) => el.textContent || el.innerText || "")
            .filter((line) => line.trim().length > 0);
          if (lines.length > 0) {
            const code = lines.join("\n");
            if (code.length > 50) {
              console.debug(
                `AC Sync: Found LeetCode code with ${selector}, lines: ${lines.length}`,
              );
              return code;
            }
          }
        }
        // For pre/code blocks (syntax highlighted code)
        else if (
          selector === "pre" ||
          selector === "code" ||
          selector === ".hljs"
        ) {
          for (const el of elements) {
            const text = el.textContent || el.innerText || "";
            // Check if it looks like actual code
            if (
              text.length > 50 &&
              (text.includes(";") ||
                text.includes("{") ||
                text.includes("}") ||
                text.includes("int") ||
                text.includes("class") ||
                text.includes("def"))
            ) {
              console.debug(
                `AC Sync: Found LeetCode code in ${selector}, length: ${text.length}`,
              );
              return text;
            }
          }
        }
        // For single element or containers
        else {
          for (const el of elements) {
            const text = el.textContent || el.innerText || "";
            if (text.length > 100) {
              // Require longer text for generic selectors
              console.debug(
                `AC Sync: Found potential code with ${selector}, length: ${text.length}`,
              );
              // Verify it looks like code
              if (
                text.includes(";") ||
                text.includes("{") ||
                text.includes("class") ||
                text.includes("def") ||
                text.includes("function") ||
                text.includes("int ")
              ) {
                return text;
              }
            }
          }
        }
      }
    } catch (e) {
      console.debug(`AC Sync: Error with LeetCode selector ${selector}:`, e);
    }
  }

  // Final fallback - try to get any text that looks like code
  try {
    const bodyText = document.body.innerText;
    const codePatterns = [
      /class\s+Solution[\s\S]{50,5000}/,
      /#include[\s\S]{50,5000}/,
      /def\s+\w+[\s\S]{50,5000}/,
    ];

    for (const pattern of codePatterns) {
      const match = bodyText.match(pattern);
      if (match && match[0].length > 100) {
        console.debug("AC Sync: Found code via pattern matching");
        return match[0];
      }
    }
  } catch (e) {
    console.debug("AC Sync: Pattern matching failed:", e);
  }

  console.debug("AC Sync: No LeetCode code found");
  return "";
}

function cleanTitle(raw) {
  return String(raw || "")
    .replace(/^[A-Z]\.\s*/, "")
    .replace(/^[A-Z]\d?\s*-\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/\s*[-|–]\s*LeetCode$/i, "")
    .trim();
}

function normalizeDifficulty(raw) {
  const t = String(raw || "").toLowerCase();
  if (t.includes("easy")) return "Easy";
  if (t.includes("medium")) return "Medium";
  if (t.includes("hard")) return "Hard";
  return "Unknown";
}

function inferDifficultyFromBody() {
  const t = document.body?.innerText?.toLowerCase() || "";
  if (t.includes("easy")) return "Easy";
  if (t.includes("medium")) return "Medium";
  if (t.includes("hard")) return "Hard";
  return "Unknown";
}

function showToast(text) {
  try {
    let box = document.getElementById("codesync-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "codesync-toast";
      box.style.position = "fixed";
      box.style.right = "20px";
      box.style.bottom = "20px";
      box.style.padding = "10px 14px";
      box.style.borderRadius = "10px";
      box.style.background = "#111827";
      box.style.color = "#f9fafb";
      box.style.zIndex = "999999";
      box.style.fontSize = "13px";
      box.style.boxShadow = "0 8px 30px rgba(0,0,0,0.25)";
      box.style.transition = "opacity 300ms ease";
      box.style.opacity = "0";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.style.opacity = "1";
    clearTimeout(box._hideTimeout);
    box._hideTimeout = setTimeout(() => {
      box.style.opacity = "0";
    }, 2500);
  } catch (e) {
    // ignore UI errors
  }
}
