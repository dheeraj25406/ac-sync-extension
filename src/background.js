const DEFAULT_SETTINGS = {
  githubToken: "",
  defaultRepo: "",
  defaultBranch: "main",
  commitMessageTemplate: "feat({platform}): solve {problem} [{language}]",
  platformEnabled: {
    leetcode: true,
    codeforces: true,
    gfg: true,
  },
  platformFolders: {
    leetcode: "LeetCode",
    codeforces: "CodeForces",
    gfg: "GeeksForGeeks",
  },
  autoPushEnabled: false,
};

const PLATFORM_NAMES = {
  leetcode: "LeetCode",
  codeforces: "CodeForces",
  gfg: "GeeksForGeeks",
};

// INIT
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  await chrome.storage.sync.set(merged);
});

// Ensure content script is present on matching tabs. Some sites (SPAs or
// non-www variants) can miss content script injection; proactively inject on
// navigation/activation for supported hosts.
function isSupportedHost(url) {
  try {
    const h = new URL(url).hostname;
    return (
      h.includes("leetcode.com") ||
      h.includes("codeforces.com") ||
      h.includes("geeksforgeeks.org")
    );
  } catch (e) {
    return false;
  }
}

async function tryInjectContentScript(tabId, url) {
  if (!isSupportedHost(url)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ["src/content.js"],
    });
    console.debug("[AC Sync] injected content script into tab", tabId, url);
  } catch (e) {
    console.debug(
      "[AC Sync] failed to inject content script into tab",
      tabId,
      e?.message || e,
    );
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url) {
    tryInjectContentScript(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url) await tryInjectContentScript(tab.id, tab.url);
  } catch (e) {
    // ignore
  }
});

// MESSAGE HANDLER
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "MANUAL_PUSH") {
    (async () => {
      try {
        const res = await processSubmission(message.payload);
        sendResponse(res);
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // 🔥 REQUIRED
  }

  if (message.type === "AUTO_PUSH_ACCEPTED") {
    (async () => {
      try {
        const settings = await chrome.storage.sync.get(
          Object.keys(DEFAULT_SETTINGS),
        );
        const config = { ...DEFAULT_SETTINGS, ...settings };

        // Respect the ON/OFF toggle
        if (!config.autoPushEnabled) {
          sendResponse({ ok: false, reason: "disabled" });
          return;
        }

        // Dedup: skip if this exact submission was already pushed
        const payload = message.payload;
        const dedupKey = `autopush:${payload.platform}:${sanitize(payload.problemTitle)}:${payload.submissionId || ""}`;
        const stored = await chrome.storage.local.get(["autoPushLog"]);
        const log = stored.autoPushLog || {};

        // Prune entries older than 24 h
        const now = Date.now();
        for (const k of Object.keys(log)) {
          if (now - log[k] > 86400000) delete log[k];
        }

        if (log[dedupKey]) {
          console.debug("[AC Sync] Auto-push dedup skip:", dedupKey);
          await chrome.storage.local.set({ autoPushLog: log });
          sendResponse({ ok: false, reason: "duplicate" });
          return;
        }

        // Mark as in-flight before async work
        log[dedupKey] = now;
        await chrome.storage.local.set({ autoPushLog: log });

        // Reuse exact same push logic as manual push
        const res = await processSubmission(payload);

        // Notify user via browser notification
        if (res.ok) {
          chrome.notifications.create({
            type: "basic",
            iconUrl: "assets/icon48.png",
            title: "AC Sync — Auto-pushed ✓",
            message: `${payload.problemTitle} pushed to ${res.repo}`,
          });
        } else {
          chrome.notifications.create({
            type: "basic",
            iconUrl: "assets/icon48.png",
            title: "AC Sync — Auto-push failed",
            message: res.error || "Unknown error",
          });
          // On failure remove the dedup key so user can retry manually
          delete log[dedupKey];
          await chrome.storage.local.set({ autoPushLog: log });
        }

        sendResponse(res);
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // keep channel open for async
  }

  if (message.type === "REPAIR_LAST_PUSH") {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(["lastSentPayload"]);
        const last = stored.lastSentPayload?.payload;
        if (!last) {
          sendResponse({ ok: false, error: "No lastSentPayload found" });
          return;
        }

        const settings = await chrome.storage.sync.get(
          Object.keys(DEFAULT_SETTINGS),
        );
        const config = { ...DEFAULT_SETTINGS, ...settings };
        const token = config.githubToken?.trim();
        const repo = config.defaultRepo?.trim();
        const branch = config.defaultBranch;
        if (!token || !repo) {
          sendResponse({
            ok: false,
            error: "Missing GitHub token or repo in settings",
          });
          return;
        }

        // Before rebuilding, apply an additional conservative normalization
        // to recover common single-line concatenations (NBSPs, comma joins,
        // missing newlines). This is a last-resort repair for previously
        // committed single-line content.
        function aggressiveNormalizeCode(src) {
          if (!src) return src || "";
          let s = String(src);
          // Replace non-breaking spaces and other invisible separators with normal space
          s = s.replace(/\u00A0/g, " ").replace(/[\u202F\u2007\u2009]/g, " ");
          // Trim outer whitespace
          s = s.trim();
          // If it already has real newlines, leave as-is (but still normalize NBSPs)
          if (s.indexOf("\n") !== -1) return s;
          // If it looks like a JSON array string, try to parse and join
          if (s.startsWith("[") && s.endsWith("]")) {
            try {
              const a = JSON.parse(s);
              if (Array.isArray(a)) return a.join("\n");
            } catch (e) {}
          }
          // Replace semicolons with semicolon+newline (conservative)
          s = s.replace(/;(?!\n)/g, ";\n");
          // Put braces on their own lines
          s = s.replace(/\)\s*\{/g, ")\n{\n");
          s = s.replace(/\{\s*/g, "{\n");
          s = s.replace(/\s*\}/g, "\n}\n");
          // Ensure preprocessor directives on their own lines
          s = s.replace(/#include/g, "\n#include");
          s = s.replace(/#define/g, "\n#define");
          s = s.replace(/\busing\s+namespace\b/g, "\nusing namespace");
          // If still no newline, as a last attempt split on commas when many commas
          if (
            s.indexOf("\n") === -1 &&
            s.includes("#include") &&
            (s.match(/,/g) || []).length > 4
          ) {
            const parts = s
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean);
            const tokeny = parts.filter((p) =>
              /#include|std::|return\b|int\b|cout\b|cin\b/.test(p),
            ).length;
            if (tokeny >= Math.ceil(parts.length * 0.2)) s = parts.join("\n");
          }
          return s;
        }

        last.code = aggressiveNormalizeCode(last.code);

        // Rebuild content using buildContent (this will run reflowCode and produce final content)
        const language = last.language || detectLanguage(last.code);
        const stats = last.stats || {};
        const content = buildContent({ ...last, language, stats });
        const ext = languageToExt(language);
        const path = buildPath(
          last,
          ext,
          (await chrome.storage.sync.get(["platformFolders"]))
            ?.platformFolders || DEFAULT_SETTINGS.platformFolders,
        );
        const messageText = buildCommitMessage(config.commitMessageTemplate, {
          ...last,
          language,
        });

        const res = await pushToGitHub({
          token,
          repo,
          branch,
          path,
          content,
          message: messageText,
        });
        sendResponse({ ok: true, result: res });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === "GET_ANALYTICS") {
    (async () => {
      const data = await chrome.storage.local.get(["submissions"]);
      const list = data.submissions || [];

      const now = Date.now();
      let week = 0,
        month = 0;

      list.forEach((x) => {
        if (now - x.ts <= 7 * 86400000) week++;
        if (now - x.ts <= 30 * 86400000) month++;
      });

      sendResponse({
        ok: true,
        analytics: {
          total: list.length,
          solvedWeek: week,
          solvedMonth: month,
          recent: list.slice(-50),
        },
      });
    })();
    return true;
  }

  return false;
});

// MAIN LOGIC - Enhanced with better validation and error handling
async function processSubmission(payload) {
  if (!payload?.problemTitle) {
    payload.problemTitle = document?.title?.trim() || "Unknown Problem";
  }

  const settings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const config = { ...DEFAULT_SETTINGS, ...settings };

  const token = config.githubToken?.trim();
  const repo = config.defaultRepo?.trim();
  const branch = config.defaultBranch;

  if (!token || !repo) {
    return {
      ok: false,
      error:
        "Missing GitHub token or repository. Please configure in settings.",
    };
  }

  // Validate token format (basic check)
  if (
    !token.startsWith("ghp_") &&
    !token.startsWith("gho_") &&
    !token.startsWith("ghu_") &&
    token.length < 20
  ) {
    return {
      ok: false,
      error: "Invalid GitHub token format. Please check your settings.",
    };
  }

  // Validate repository format
  if (!repo.includes("/")) {
    return {
      ok: false,
      error: "Invalid repository format. Use 'owner/repo' format.",
    };
  }

  // 🚀 FORCE REQUIRED FIELDS
  const language = payload.language || detectLanguage(payload.code);
  const stats = payload.stats || {};
  const runtime = stats.runtime || "N/A";
  const memory = stats.memory || "N/A";

  const ext = languageToExt(language);
  const path = buildPath(payload, ext, config.platformFolders);

  // Enhanced validation of code
  if (!payload.code || payload.code.trim().length < 10) {
    return {
      ok: false,
      error: "No valid code found. Code appears to be empty or too short.",
    };
  }

  // Debug logging
  try {
    console.debug("[AC Sync] Processing submission:", {
      platform: payload.platform,
      problemTitle: payload.problemTitle,
      language,
      codeLength: payload.code.length,
      path,
    });
  } catch (e) {
    console.debug("[AC Sync] Debug logging failed", e);
  }

  // Store submission for debugging
  try {
    const codeLen = String(payload.code || "").length;
    const preview = String(payload.code || "")
      .slice(0, 200)
      .replace(/\n/g, "\\n");
    await chrome.storage.local.set({
      lastSentPayload: {
        payload,
        _debug: { codeLen, preview, timestamp: Date.now() },
      },
    });
  } catch (e) {
    console.debug("[AC Sync] Failed to store payload for debugging", e);
  }

  const content = buildContent({
    ...payload,
    language,
    stats: { runtime, memory },
  });

  // Store diagnostic info
  try {
    const rawCode = payload.code;
    const codeStr =
      typeof rawCode === "string" ? rawCode : JSON.stringify(rawCode || "");
    const newlineCount = (codeStr.match(/\n/g) || []).length;
    const hasEscapedNewlines = /\\n/.test(codeStr);

    await chrome.storage.local.set({
      lastPushAttempt: {
        ts: Date.now(),
        path,
        contentPreview: String(content).slice(0, 2000),
        codeType: typeof rawCode,
        codeLength: codeStr.length,
        newlineCount,
        hasEscapedNewlines,
        platform: payload.platform,
        language,
      },
    });
  } catch (e) {
    console.debug("[AC Sync] Failed to store diagnostics", e);
  }

  const message = buildCommitMessage(config.commitMessageTemplate, {
    ...payload,
    language,
  });

  try {
    const result = await pushToGitHub({
      token,
      repo,
      branch,
      path,
      content,
      message,
    });

    await saveAnalytics(payload);

    return {
      ok: true,
      repo,
      path,
      commitSha: result.commitSha,
      unchanged: result.unchanged || false,
    };
  } catch (error) {
    console.error("[AC Sync] Push failed:", error);
    return {
      ok: false,
      error: error.message || "Unknown error occurred while pushing to GitHub.",
    };
  }
}

// ANALYTICS SAVE
async function saveAnalytics(payload) {
  const data = await chrome.storage.local.get(["submissions"]);
  const list = data.submissions || [];

  list.push({
    ts: Date.now(),
    problem: payload.problemTitle,
  });

  await chrome.storage.local.set({ submissions: list });
}

// HELPERS

function detectLanguage(code = "") {
  if (code.includes("#include")) return "C++";
  if (code.includes("public class")) return "Java";
  if (code.includes("def ")) return "Python";
  if (code.includes("function")) return "JavaScript";
  if (/console\.log/.test(code)) return "JavaScript";
  if (/print\s*\(/.test(code)) return "Python";
  return "Unknown";
}

function buildCommitMessage(template, payload) {
  return template
    .replaceAll("{platform}", payload.platform)
    .replaceAll("{problem}", payload.problemTitle)
    .replaceAll("{language}", payload.language);
}

function buildPath(payload, ext, folders) {
  const platform = folders[payload.platform] || "Other";
  const difficulty = payload.difficulty || "Unknown";
  const name = sanitize(payload.problemTitle);
  return `${platform}/${difficulty}/${name}.${ext}`;
}

function sanitize(str) {
  return str.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-");
}

function languageToExt(lang = "") {
  const l = lang.toLowerCase();
  if (l.includes("c++")) return "cpp";
  if (l.includes("java")) return "java";
  if (l.includes("python")) return "py";
  if (l.includes("js")) return "js";
  return "txt";
}

// Enhanced reflow function that handles more edge cases
function reflowCode(src) {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escaped = false;
  let prev = "";
  let braceDepth = 0;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (!escaped) {
      if (ch === "'" && !inDouble && !inBacktick) {
        inSingle = !inSingle;
      } else if (ch === '"' && !inSingle && !inBacktick) {
        inDouble = !inDouble;
      } else if (ch === "`" && !inSingle && !inDouble) {
        inBacktick = !inBacktick;
      }
    }

    // track escape state
    if (ch === "\\" && !escaped) {
      escaped = true;
      out += ch;
      prev = ch;
      continue;
    }

    // If we hit a semicolon outside of any string, insert a newline after it
    if (!inSingle && !inDouble && !inBacktick && ch === ";") {
      out += ";\n";
      prev = ch;
      escaped = false;
      continue;
    }

    // If an opening brace outside strings, ensure it starts on a new line
    if (!inSingle && !inDouble && !inBacktick && ch === "{") {
      // insert newline before if previous char isn't newline
      if (out.length && out.slice(-1) !== "\n") out += "\n";
      out += "{\n";
      braceDepth++;
      prev = ch;
      escaped = false;
      continue;
    }

    // If a closing brace outside strings, ensure it is on its own line
    if (!inSingle && !inDouble && !inBacktick && ch === "}") {
      if (out.length && out.slice(-1) !== "\n") out += "\n";
      out += "}\n";
      braceDepth = Math.max(0, braceDepth - 1);
      prev = ch;
      escaped = false;
      continue;
    }

    // Handle commas in function calls/arrays - add newline for complex structures
    if (
      !inSingle &&
      !inDouble &&
      !inBacktick &&
      ch === "," &&
      braceDepth === 0
    ) {
      // Look ahead to see if this is a complex structure
      let remaining = src.slice(i + 1, Math.min(i + 100, src.length));
      if (
        remaining.includes("{") ||
        remaining.includes(";") ||
        remaining.length > 50
      ) {
        out += ",\n";
        prev = ch;
        escaped = false;
        continue;
      }
    }

    // Keep normal characters
    out += ch;
    prev = ch;
    // reset escape when we've consumed escaped char
    if (escaped) escaped = false;
  }

  // Post-process directives and keywords to ensure they start on new lines
  out = out.replace(/\s*#include/g, "\n#include");
  out = out.replace(/\s*#define/g, "\n#define");
  out = out.replace(/\s*using\s+namespace/g, "\nusing namespace");
  out = out.replace(/\s*int\s+main/g, "\nint main");
  out = out.replace(/\s*void\s+main/g, "\nvoid main");
  out = out.replace(/\s*def\s+/g, "\ndef ");
  out = out.replace(/\s*function\s+/g, "\nfunction ");
  out = out.replace(/\s*class\s+/g, "\nclass ");
  out = out.replace(/\s*public\s+class/g, "\npublic class");

  // Clean up excessive blank lines
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

// CONTENT FORMAT - Enhanced with better error handling
function buildContent(payload) {
  // Normalize code so that any escaped newlines ("\\n") are converted to
  // real newlines, and normalize CRLF to LF. Preserve indentation and avoid
  // collapsing whitespace — we want the exact source as the user submitted.
  let code = payload.code;

  // Handle different code input types
  if (Array.isArray(code)) {
    code = code.join("\n");
  } else if (code && typeof code === "object") {
    try {
      code = JSON.stringify(code, null, 2);
    } catch (e) {
      code = String(code);
    }
  }

  code = String(code || "");

  // Normalize line endings
  code = code.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Handle escaped newlines
  if (!code.includes("\n") && code.includes("\\n")) {
    code = code.replace(/\\n/g, "\n");
  }

  // Handle JSON array strings that got stringified
  if (code.trim().startsWith("[") && code.trim().endsWith("]")) {
    try {
      const maybeArr = JSON.parse(code.trim());
      if (Array.isArray(maybeArr)) {
        code = maybeArr.join("\n");
        console.debug("[AC Sync] Parsed JSON array string to lines");
      }
    } catch (e) {
      // Not valid JSON, continue processing
    }
  }

  // 🚀 ENHANCED FIX for competitive programming compressed code
  const newlineCount = (code.match(/\n/g) || []).length;
  if (newlineCount === 0 && code.length > 80) {
    console.debug("[AC Sync] Applying enhanced single-line code recovery");

    // Try multiple recovery strategies
    const strategies = [
      // Strategy 1: Basic keyword-based splitting
      () =>
        code
          .replace(/#include/g, "\n#include")
          .replace(/using namespace/g, "\nusing namespace")
          .replace(/#define/g, "\n#define")
          .replace(/int main/g, "\nint main")
          .replace(/void main/g, "\nvoid main")
          .replace(/def /g, "\ndef ")
          .replace(/function /g, "\nfunction ")
          .replace(/public class/g, "\npublic class")
          .replace(/;/g, ";\n"),

      // Strategy 2: Comma-based splitting for certain patterns
      () => {
        if (code.includes(",") && (code.match(/,/g) || []).length > 5) {
          const parts = code
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
          if (parts.length > 3) return parts.join(",\n");
        }
        return code;
      },

      // Strategy 3: Use the enhanced reflow function
      () => reflowCode(code),
    ];

    for (const strategy of strategies) {
      try {
        const result = strategy();
        if ((result.match(/\n/g) || []).length > newlineCount) {
          code = result;
          break;
        }
      } catch (e) {
        console.debug("[AC Sync] Strategy failed:", e);
      }
    }
  }

  // 🚀 FINAL SAFETY: if still single-line and long, use aggressive reflow
  if ((code.match(/\n/g) || []).length === 0 && code.length > 100) {
    console.debug("[AC Sync] Applying final aggressive reflowCode()");
    code = reflowCode(code);
  }

  // Debug logging
  try {
    const finalNewlines = (code.match(/\n/g) || []).length;
    console.debug("[AC Sync] Final code stats:", {
      originalLength: payload.code?.length || 0,
      finalLength: code.length,
      newlines: finalNewlines,
      hasIncludes: code.includes("#include"),
      hasMain: code.includes("main"),
      hasSemicolons: code.includes(";"),
    });
  } catch (e) {}

  // Validate we have meaningful code
  if (!code || code.trim().length < 10) {
    code = "// No code captured or code too short";
  }

  // Choose a fence language for GitHub highlighting
  const ext = languageToExt(payload.language || "");
  const fenceLang = ext === "txt" ? "" : ext;

  return [
    `# ${payload.problemTitle || "Unknown Problem"}`,
    "",
    `- Platform: ${PLATFORM_NAMES[payload.platform] || "Unknown"}`,
    `- URL: ${payload.problemUrl || "N/A"}`,
    `- Difficulty: ${payload.difficulty || "Unknown"}`,
    `- Language: ${payload.language || "Unknown"}`,
    `- Status: ${payload.accepted ? "Accepted" : "WIP"}`,
    `- Runtime: ${payload.stats?.runtime || "N/A"}`,
    `- Memory: ${payload.stats?.memory || "N/A"}`,
    `- Solved At: ${new Date().toISOString()}`,
    "",
    "## Code",
    fenceLang ? "```" + fenceLang : "```",
    code || "// no code",
    "```",
  ].join("\n");
}

// GITHUB PUSH - Enhanced with better error handling and retries
async function pushToGitHub({ token, repo, branch, path, content, message }) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;

  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "AC-Sync-Chrome-Extension",
  };

  let sha = null;
  let retryCount = 0;
  const maxRetries = 3;

  // First, try to get existing file info
  while (retryCount < maxRetries) {
    try {
      const res = await fetch(url, { headers });

      if (res.status === 404) {
        // File doesn't exist, that's fine
        break;
      }

      if (res.ok) {
        const data = await res.json();
        sha = data.sha;

        // Check if content is identical
        const existing = atob(data.content);
        if (existing === content) {
          console.debug("[AC Sync] Content unchanged, skipping push");
          return { commitSha: sha, unchanged: true };
        }
        break;
      } else if (res.status >= 500 && res.status < 600) {
        // Server error, retry
        retryCount++;
        console.debug(
          `[AC Sync] GitHub API error ${res.status}, retry ${retryCount}/${maxRetries}`,
        );
        await new Promise((r) => setTimeout(r, 1000 * retryCount));
        continue;
      } else {
        // Client error, don't retry
        const errorText = await res.text();
        throw new Error(`GitHub API error ${res.status}: ${errorText}`);
      }
    } catch (error) {
      if (retryCount === maxRetries - 1) throw error;
      retryCount++;
      await new Promise((r) => setTimeout(r, 1000 * retryCount));
    }
  }

  // Prepare the push payload
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
    ...(sha && { sha }),
  };

  // Debug logging
  try {
    console.debug("[AC Sync] Pushing to GitHub:", {
      path,
      contentLength: content.length,
      encodedLength: body.content.length,
      hasExistingSha: !!sha,
    });
  } catch (e) {
    // ignore logging errors
  }

  // Push with retries
  retryCount = 0;
  while (retryCount < maxRetries) {
    try {
      const put = await fetch(url, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (put.ok) {
        const data = await put.json();
        const result = { commitSha: data.commit.sha };

        // Store successful response
        try {
          await chrome.storage.local.set({
            lastPushResponse: {
              ok: true,
              status: put.status,
              commitSha: data.commit.sha,
              ts: Date.now(),
            },
          });
        } catch (e) {}

        console.debug("[AC Sync] Successfully pushed to GitHub");
        return result;
      } else {
        const errorText = await put.text();

        // Store error response
        try {
          await chrome.storage.local.set({
            lastPushResponse: {
              ok: false,
              status: put.status,
              text: errorText,
              ts: Date.now(),
            },
          });
        } catch (e) {}

        // Check for retryable errors
        if (put.status >= 500 || put.status === 429) {
          retryCount++;
          console.debug(
            `[AC Sync] Push failed, retry ${retryCount}/${maxRetries}`,
          );
          await new Promise((r) => setTimeout(r, 2000 * retryCount));
          continue;
        }

        throw new Error(`GitHub push failed: ${put.status} - ${errorText}`);
      }
    } catch (error) {
      if (retryCount === maxRetries - 1) {
        throw new Error(
          `Failed to push to GitHub after ${maxRetries} attempts: ${error.message}`,
        );
      }
      retryCount++;
      await new Promise((r) => setTimeout(r, 2000 * retryCount));
    }
  }
}
