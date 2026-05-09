// AC Sync - Production Content Script
// Supports: LeetCode, Codeforces, GeeksforGeeks
// Captures: code, difficulty, runtime, memory, language

(function () {
  const host = location.hostname;
  console.log("[AC Sync] Loaded on:", host);

  // Detect platform
  let platform = null;
  if (host.includes("leetcode.com")) platform = "leetcode";
  else if (host.includes("codeforces.com")) platform = "codeforces";
  else if (host.includes("geeksforgeeks.org")) platform = "gfg";

  if (!platform) {
    console.log("[AC Sync] Unsupported platform, exiting");
    return;
  }

  console.log("[AC Sync] Platform:", platform);

  // ===== MESSAGE LISTENER =====
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type !== "COLLECT_CURRENT_SUBMISSION") return false;

    console.log("[AC Sync] Collecting submission...");

    collectAll(platform)
      .then((data) => {
        console.log("[AC Sync] Collection done:", {
          codeLen: data.code?.length || 0,
          difficulty: data.difficulty,
          language: data.language,
          runtime: data.stats?.runtime,
          memory: data.stats?.memory,
        });
        sendResponse({ ok: true, payload: data });
      })
      .catch((err) => {
        console.error("[AC Sync] Collection error:", err);
        sendResponse({ ok: false, error: err.message });
      });

    return true;
  });

  // ===== MAIN COLLECTION FUNCTION =====
  async function collectAll(platform) {
    const code = await extractCode(platform);
    const title = extractTitle(platform);
    const difficulty = extractDifficulty(platform);
    const stats = extractStats(platform);
    const language = detectLanguage(code);

    console.log("[AC Sync] Results:", {
      codeLen: code.length,
      title,
      difficulty,
      language,
      runtime: stats.runtime,
      memory: stats.memory,
    });

    const result = {
      platform,
      problemTitle: title,
      difficulty,
      tags: [],
      language,
      code: code.trim(),
      accepted: true,
      submissionId: location.pathname.split("/").pop() || "",
      stats,
      problemUrl: location.href,
      notes: "",
    };

    // Store to local storage so popup can read it even if live message fails
    if (result.code.length > 10) {
      try {
        await chrome.storage.local.set({ lastCapturedCode: result });
        console.log(
          "[AC Sync] Stored captured code to local storage, length:",
          result.code.length,
        );
      } catch (e) {
        console.warn("[AC Sync] Failed to store captured code:", e);
      }
    }

    return result;
  }

  // ===== CODE EXTRACTION =====
  async function extractCode(platform) {
    console.log("[AC Sync] Extracting code for platform:", platform);
    console.log("[AC Sync] Current URL:", location.href);

    // Completely independent extraction for each platform
    if (platform === "leetcode") {
      return extractLeetCodeCodeWithRetry();
    }
    if (platform === "gfg") {
      return extractGfgCode("");
    }
    if (platform === "codeforces") {
      return extractCodeforcesCode("");
    }

    return "";
  }

  // ===== LEETCODE-SPECIFIC CODE EXTRACTION =====
  async function extractLeetCodeCodeWithRetry() {
    const MAX_ATTEMPTS = 12;
    const DELAY_MS = 400;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const code = extractLeetCodeCode("");
      if (code.length > 30) {
        console.log(
          "[AC Sync] LeetCode: Code captured on attempt",
          attempt,
          "length:",
          code.length,
        );
        return code;
      }
      console.log(
        "[AC Sync] LeetCode: Attempt",
        attempt,
        "code length:",
        code.length,
        "- retrying in",
        DELAY_MS,
        "ms",
      );
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    console.warn("[AC Sync] LeetCode: All", MAX_ATTEMPTS, "attempts failed");
    return "";
  }

  function extractLeetCodeCode(currentBest) {
    let code = "";
    let foundVia = "";
    console.log("[AC Sync] LeetCode: Extracting code from", location.pathname);

    // Helper: extract text from a Monaco editor's view-lines, preserving line order
    function getMonacoCode(container) {
      if (!container) return "";
      // Try .view-lines first (grouped by line)
      const viewLines = container.querySelector(".view-lines");
      const lineContainer = viewLines || container;
      const lines = Array.from(lineContainer.querySelectorAll(".view-line"))
        .map((el) => (el.textContent || "").replace(/\u00a0/g, " "))
        .filter((l) => l.trim().length > 0);
      if (lines.length > 3) return lines.join("\n");
      return "";
    }

    // 1. Target the CODE Monaco editor specifically
    //    LeetCode new UI has multiple .monaco-editor instances.
    //    The code editor is inside specific containers.
    const codeEditorContainers = [
      // New UI: code panel on submission page
      "[class*='code'] .monaco-editor",
      "[class*='Code'] .monaco-editor",
      // Submission detail panel
      "[class*='submission'] .monaco-editor",
      "[class*='Submission'] .monaco-editor",
      // Split panel editor
      "[class*='split'] .monaco-editor .editor-container",
      // Right panel (code is usually on the right)
      ".flex:last-child .monaco-editor",
      // Generic fallback
      ".monaco-editor",
    ];
    for (const sel of codeEditorContainers) {
      const editors = document.querySelectorAll(sel);
      for (const editor of editors) {
        const extracted = getMonacoCode(editor);
        if (
          extracted.length > 30 &&
          extracted.length > code.length &&
          looksLikeCode(extracted)
        ) {
          code = extracted;
          foundVia = sel;
          console.log(
            "[AC Sync] LeetCode: Found code via",
            sel,
            "lines:",
            extracted.split("\n").length,
            "length:",
            extracted.length,
          );
          break;
        }
      }
      if (code.length > 30) break;
    }

    // 2. LeetCode data-e2e code block (submission pages)
    if (code.length < 50) {
      const e2eCode = document.querySelector("[data-e2e-locator='code']");
      if (e2eCode) {
        const text = (e2eCode.textContent || "").trim();
        if (text.length > 30 && looksLikeCode(text)) {
          code = text;
          foundVia = "[data-e2e-locator='code']";
          console.log(
            "[AC Sync] LeetCode: Found code via data-e2e-locator, length:",
            text.length,
          );
        }
      }
    }

    // 3. ACE editor (sometimes used by LeetCode)
    if (code.length < 50) {
      const aceLines = Array.from(document.querySelectorAll(".ace_line"))
        .map((el) => (el.textContent || "").replace(/\u00a0/g, " "))
        .filter(Boolean);
      if (aceLines.length > 3) {
        const joined = aceLines.join("\n");
        if (joined.length > code.length && looksLikeCode(joined)) {
          code = joined;
          foundVia = ".ace_line";
          console.log(
            "[AC Sync] LeetCode: Found code via .ace_line, lines:",
            aceLines.length,
          );
        }
      }
    }

    // 4. LeetCode-specific selectors
    if (code.length < 50) {
      const lcSelectors = [
        ".submission-code",
        ".code-view",
        ".ace_editor",
        ".code-editor",
        ".editor-area",
        "[class*='CodeMirror']",
        "[class*='editor-container']",
        "[class*='code-block']",
      ];
      for (const sel of lcSelectors) {
        const els = document.querySelectorAll(sel);
        console.log(
          "[AC Sync] LeetCode: Checking selector",
          sel,
          "- found",
          els.length,
          "elements",
        );
        for (const el of els) {
          const text = el.textContent || "";
          if (
            text.length > 50 &&
            text.length > code.length &&
            looksLikeCode(text)
          ) {
            code = text;
            foundVia = sel;
            console.log(
              "[AC Sync] LeetCode: Found code via",
              sel,
              "length:",
              text.length,
            );
            break;
          }
        }
        if (code.length >= 50) break;
      }
    }

    // 5. Textarea (some LeetCode pages use hidden textareas)
    if (code.length < 50) {
      const textareas = document.querySelectorAll("textarea");
      for (const ta of textareas) {
        const val = ta.value || "";
        if (val.length > 30 && val.length > code.length && looksLikeCode(val)) {
          code = val;
          foundVia = "textarea";
          console.log(
            "[AC Sync] LeetCode: Found code in textarea, length:",
            val.length,
          );
          break;
        }
      }
    }

    // 6. Pre/code blocks (submission pages) — prefer pre code over standalone pre/code
    if (code.length < 50) {
      const preCodeBlocks = document.querySelectorAll("pre code, pre, code");
      for (const block of preCodeBlocks) {
        const text = block.textContent || "";
        if (
          text.length > 50 &&
          text.length > code.length &&
          looksLikeCode(text)
        ) {
          code = text;
          foundVia =
            block.tagName +
            (block.parentElement?.tagName
              ? " > " + block.parentElement.tagName
              : "");
          console.log(
            "[AC Sync] LeetCode: Found code in pre/code block, length:",
            text.length,
          );
          break;
        }
      }
    }

    // 7. Submission panel code
    if (code.length < 30) {
      const panelSelectors = [
        "[class*='submission'] pre",
        "[class*='submission'] code",
        "[class*='detail'] pre",
        "[class*='detail'] code",
        "[class*='answer'] pre",
        "[class*='answer'] code",
      ];
      for (const sel of panelSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent || "";
          if (
            text.length > 30 &&
            text.length > code.length &&
            looksLikeCode(text)
          ) {
            code = text;
            foundVia = sel;
            console.log(
              "[AC Sync] LeetCode: Found code via submission panel",
              sel,
              "length:",
              text.length,
            );
            break;
          }
        }
      }
    }

    // 8. Body pattern fallback
    if (code.length < 30) {
      const bodyText = document.body?.innerText || "";
      const patterns = [
        /class\s+\w+\s*\{[\s\S]{50,5000}?\n\}/,
        /#include[\s\S]{50,5000}?(?=\n\n|$)/,
        /def\s+\w+\s*\([\s\S]{50,5000}?\n\n/,
        /using\s+namespace[\s\S]{50,5000}/,
      ];
      for (const pat of patterns) {
        const m = bodyText.match(pat);
        if (m && m[0].length > 50) {
          code = m[0];
          foundVia = "body-pattern";
          console.log(
            "[AC Sync] LeetCode: Found code via body pattern, length:",
            m[0].length,
          );
          break;
        }
      }
    }

    if (code.length > 0) {
      console.log(
        "[AC Sync] LeetCode: Extraction complete via",
        foundVia,
        "code length:",
        code.length,
      );
    } else {
      console.warn(
        "[AC Sync] LeetCode: No code found. Run window.ACSyncDebugCode() for diagnostics.",
      );
    }
    return code;
  }

  // ===== GFG-SPECIFIC CODE EXTRACTION =====
  function extractGfgCode(currentBest) {
    let code = "";

    console.log("[AC Sync] GFG: Starting GFG-specific extraction");

    // GFG uses ACE editor - try getting lines directly from document root
    const allAceLines = document.querySelectorAll(".ace_line");
    console.log(
      "[AC Sync] GFG: Found",
      allAceLines.length,
      ".ace_line elements",
    );
    if (allAceLines.length > 3) {
      const lines = Array.from(allAceLines)
        .map((el) => (el.textContent || "").replace(/\u00a0/g, " "))
        .filter(Boolean);
      if (lines.length > 3) {
        const joined = lines.join("\n");
        if (joined.length > code.length && looksLikeCode(joined)) {
          code = joined;
          console.log(
            "[AC Sync] GFG: Found code via all .ace_line elements, lines:",
            lines.length,
          );
        }
      }
    }

    // Try within ACE editor container
    const aceEditor = document.querySelector(".ace_editor");
    if (aceEditor && code.length < 50) {
      const lines = Array.from(aceEditor.querySelectorAll(".ace_line"))
        .map((el) => (el.textContent || "").replace(/\u00a0/g, " "))
        .filter(Boolean);
      if (lines.length > 3) {
        const joined = lines.join("\n");
        if (joined.length > code.length && looksLikeCode(joined)) {
          code = joined;
          console.log(
            "[AC Sync] GFG: Found code in .ace_editor container, lines:",
            lines.length,
          );
        }
      }
    }

    // Try GFG-specific selectors - expanded list
    const gfgSelectors = [
      // Editor selectors
      ".editor-area",
      ".code-editor",
      "#editor",
      ".ace_content",
      ".ace_text-layer",
      ".ace_scroller",
      ".ace_layer.ace_text-layer",
      "[class*='ace_editor']",
      "[id*='editor']",
      ".problems_table_editor",
      ".problem-statement + div pre",
      ".problemPage_editor",
      "div[role='code']",
      ".outputBody pre",
      // Submission/My Submissions page selectors
      ".submission-code",
      ".user-code",
      ".code-snippet",
      ".code-block",
      ".solution-code",
      ".my-submissions pre",
      ".submissions-table pre",
      ".submissions pre",
      "td pre",
      "table pre",
      ".dataTable pre",
      ".table pre",
      ".table-code",
      ".code-cell",
      "[class*='submission'] pre",
      "[class*='code'] pre",
      // Generic pre/code that looks like code
      "pre",
      "code",
    ];

    for (const sel of gfgSelectors) {
      if (code.length >= 50) break;
      const els = document.querySelectorAll(sel);
      console.log(
        "[AC Sync] GFG: Checking selector",
        sel,
        "- found",
        els.length,
        "elements",
      );
      for (const el of els) {
        const text = el.textContent || "";
        if (
          text.length > 50 &&
          text.length > code.length &&
          looksLikeCode(text)
        ) {
          code = text;
          console.log(
            "[AC Sync] GFG: Found code via",
            sel,
            "length:",
            text.length,
          );
          break;
        }
      }
    }

    // Try GFG submission/my submissions page - look for largest code block
    if (code.length < 50) {
      const submissionSelectors = [
        ".table td pre",
        ".dataTable pre",
        ".problem-solution pre",
        ".submissions pre",
        ".my-submissions pre",
        ".submission-code",
        ".user-code",
        "td code",
        ".submissions-table pre",
      ];

      let bestCode = "";
      let bestLength = 0;

      for (const sel of submissionSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          console.log(
            "[AC Sync] GFG: Checking submission selector",
            sel,
            "- found",
            els.length,
          );
        }
        for (const el of els) {
          const text = el.textContent || "";
          if (
            text.length > 100 &&
            text.length > bestLength &&
            looksLikeCode(text)
          ) {
            bestCode = text;
            bestLength = text.length;
            console.log(
              "[AC Sync] GFG: Found candidate code via",
              sel,
              "length:",
              text.length,
            );
          }
        }
      }

      if (bestCode.length > code.length) {
        code = bestCode;
        console.log(
          "[AC Sync] GFG: Using best submission code, length:",
          code.length,
        );
      }
    }

    // Try getting code from GFG's code display section
    if (code.length < 50) {
      const codeDisplaySelectors = [
        ".code-display",
        ".problem-code",
        ".solution-code",
        ".outputWindow",
        ".view-code",
        ".code-snippet",
      ];

      for (const sel of codeDisplaySelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent || "";
          if (
            text.length > 50 &&
            text.length > code.length &&
            looksLikeCode(text)
          ) {
            code = text;
            console.log(
              "[AC Sync] GFG: Found code in code-display section via",
              sel,
            );
            break;
          }
        }
      }
    }

    // Try GFG's result page code
    if (code.length < 50) {
      const resultSelectors = [
        ".result pre",
        ".output pre",
        ".outputBody pre",
        ".run-code pre",
        ".compile-result pre",
      ];

      for (const sel of resultSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent || "";
          if (
            text.length > 50 &&
            text.length > code.length &&
            looksLikeCode(text)
          ) {
            code = text;
            console.log("[AC Sync] GFG: Found code in result via", sel);
            break;
          }
        }
      }
    }

    // Smart detection: find the largest pre/code block that looks like code
    // This is often the solution code on submission pages
    if (code.length < 50) {
      console.log(
        "[AC Sync] GFG: Attempting smart largest-code-block detection",
      );

      let bestElement = null;
      let bestLength = 0;

      // Check all pre elements
      const allPres = document.querySelectorAll("pre");
      for (const pre of allPres) {
        const text = pre.textContent || "";
        // Must be substantial and look like code
        if (text.length > 100 && text.length < 20000 && looksLikeCode(text)) {
          if (text.length > bestLength) {
            bestLength = text.length;
            bestElement = pre;
          }
        }
      }

      // Check all code elements if no good pre found
      if (!bestElement) {
        const allCodes = document.querySelectorAll("code");
        for (const cd of allCodes) {
          const text = cd.textContent || "";
          if (text.length > 100 && text.length < 20000 && looksLikeCode(text)) {
            if (text.length > bestLength) {
              bestLength = text.length;
              bestElement = cd;
            }
          }
        }
      }

      if (bestElement) {
        code = bestElement.textContent || "";
        console.log(
          "[AC Sync] GFG: Found code via largest block detection, length:",
          code.length,
        );
      }
    }

    // Final fallback: any div with substantial code-like content
    if (code.length < 50) {
      const allDivs = document.querySelectorAll("div");
      for (const div of allDivs) {
        const text = div.textContent || "";
        if (text.length > 200 && text.length < 10000 && looksLikeCode(text)) {
          // Check it contains typical code patterns
          if ((text.match(/\n/g) || []).length > 3) {
            code = text;
            console.log("[AC Sync] GFG: Found code in generic div");
            break;
          }
        }
      }
    }

    console.log(
      "[AC Sync] GFG: Final code length:",
      code.length,
      "newlines:",
      (code.match(/\n/g) || []).length,
    );
    return code;
  }

  // ===== CODEFORCES-SPECIFIC CODE EXTRACTION =====
  function extractCodeforcesCode(currentBest) {
    let code = "";
    console.log(
      "[AC Sync] Codeforces: Starting Codeforces-specific extraction",
    );

    // 1. Primary Codeforces selector
    const cfSelectors = [
      "#program-source-text",
      ".program-source",
      ".submission-source",
      ".source-code",
      "#program-source",
      ".source",
    ];
    for (const sel of cfSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent || "";
        if (text.length > 30 && text.length > code.length) {
          code = text;
          console.log(
            "[AC Sync] Codeforces: Found code via",
            sel,
            "length:",
            text.length,
          );
          break;
        }
      }
    }

    // 2. Pre/code blocks (Codeforces uses pre for code display)
    if (code.length < 50) {
      const preCodeBlocks = document.querySelectorAll("pre, code");
      for (const block of preCodeBlocks) {
        const text = block.textContent || "";
        if (
          text.length > 50 &&
          text.length > code.length &&
          looksLikeCode(text)
        ) {
          code = text;
          console.log(
            "[AC Sync] Codeforces: Found code in pre/code block, length:",
            text.length,
          );
          break;
        }
      }
    }

    // 3. Textarea (some Codeforces pages)
    if (code.length < 50) {
      const textareas = document.querySelectorAll("textarea");
      for (const ta of textareas) {
        const val = ta.value || "";
        if (val.length > 30 && val.length > code.length && looksLikeCode(val)) {
          code = val;
          console.log(
            "[AC Sync] Codeforces: Found code in textarea, length:",
            val.length,
          );
          break;
        }
      }
    }

    // 4. Try to get code from innerHTML of pre elements (preserves newlines better)
    if (code.length < 50 || (code.match(/\n/g) || []).length < 3) {
      const preBlocks = document.querySelectorAll("pre");
      for (const pre of preBlocks) {
        // Try to get text with newlines preserved
        const html = pre.innerHTML || "";
        // Convert HTML breaks and divs to newlines
        const withNewlines = html
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<div[^>]*>/gi, "")
          .replace(/<\/div>/gi, "\n")
          .replace(/<[^>]+>/g, "");

        const text = pre.textContent || "";
        // Use the one with more newlines
        const htmlNewlines = (withNewlines.match(/\n/g) || []).length;
        const textNewlines = (text.match(/\n/g) || []).length;

        if (text.length > 50 && looksLikeCode(text)) {
          if (htmlNewlines > textNewlines && htmlNewlines > 3) {
            code = withNewlines;
            console.log(
              "[AC Sync] Codeforces: Found code via innerHTML with",
              htmlNewlines,
              "newlines",
            );
          } else if (text.length > code.length) {
            code = text;
            console.log(
              "[AC Sync] Codeforces: Found code via textContent with",
              textNewlines,
              "newlines",
            );
          }
          break;
        }
      }
    }

    // 5. Body pattern fallback
    if (code.length < 30) {
      const bodyText = document.body?.innerText || "";
      const patterns = [
        /class\s+\w+\s*\{[\s\S]{50,5000}?\n\}/,
        /#include[\s\S]{50,5000}?(?=\n\n|$)/,
        /def\s+\w+\s*\([\s\S]{50,5000}?\n\n/,
        /using\s+namespace[\s\S]{50,5000}/,
      ];
      for (const pat of patterns) {
        const m = bodyText.match(pat);
        if (m && m[0].length > 50) {
          code = m[0];
          console.log(
            "[AC Sync] Codeforces: Found code via body pattern, length:",
            m[0].length,
          );
          break;
        }
      }
    }

    // 6. If code is single-line, try to reflow it immediately
    const newlineCount = (code.match(/\n/g) || []).length;
    if (newlineCount === 0 && code.length > 50) {
      console.log(
        "[AC Sync] Codeforces: Code is single-line, attempting immediate reflow",
      );
      // Simple reflow: add newlines after semicolons and braces
      let reflowed = code
        .replace(/;/g, ";\n")
        .replace(/\{/g, "{\n")
        .replace(/\}/g, "\n}\n")
        .replace(/#include/g, "\n#include")
        .replace(/using namespace/g, "\nusing namespace");

      if ((reflowed.match(/\n/g) || []).length > 3) {
        code = reflowed;
        console.log(
          "[AC Sync] Codeforces: Reflowed code to",
          (code.match(/\n/g) || []).length,
          "lines",
        );
      }
    }

    console.log(
      "[AC Sync] Codeforces: Final code length:",
      code.length,
      "newlines:",
      (code.match(/\n/g) || []).length,
    );
    return code;
  }

  // ===== HELPER: Check if text looks like code =====
  function looksLikeCode(text) {
    if (!text || text.length < 20) return false;
    const codeIndicators = [
      "class ",
      "int ",
      "void ",
      "def ",
      "function ",
      "#include",
      "using namespace",
      "return ",
      "public ",
      "private ",
      "static ",
      "for (",
      "while (",
      "if (",
      "cout",
      "cin",
      "printf",
      "scanf",
      "std::",
      "import ",
      "package ",
    ];
    let matches = 0;
    for (const indicator of codeIndicators) {
      if (text.includes(indicator)) matches++;
    }
    return matches >= 1;
  }

  // ===== TITLE EXTRACTION =====
  function extractTitle(platform) {
    let title = document.title
      .replace(/ - LeetCode$/, "")
      .replace(/ - Codeforces$/, "")
      .replace(/ - GeeksforGeeks$/, "")
      .replace(/ \| LeetCode$/, "")
      .trim();

    if (!title || title.length < 2) title = "Unknown Problem";
    return title;
  }

  // ===== DIFFICULTY EXTRACTION =====
  function extractDifficulty(platform) {
    let difficulty = "Unknown";
    const bodyText = document.body?.innerText || "";
    const bodyHtml = document.body?.innerHTML || "";

    // Strategy 1: Check data attributes and class names
    const diffSelectors = [
      "[data-difficulty]",
      "[class*='text-difficulty-easy']",
      "[class*='text-difficulty-medium']",
      "[class*='text-difficulty-hard']",
      "[class*='difficulty']",
      ".difficulty-label",
      ".problem-difficulty",
    ];

    for (const sel of diffSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const content = (
          el.textContent +
          " " +
          String(el.className || "") +
          " " +
          (el.getAttribute("data-difficulty") || "")
        ).toLowerCase();
        if (content.includes("easy")) {
          difficulty = "Easy";
          break;
        }
        if (content.includes("medium")) {
          difficulty = "Medium";
          break;
        }
        if (content.includes("hard")) {
          difficulty = "Hard";
          break;
        }
      }
    }

    // Strategy 2: Check HTML class patterns
    if (difficulty === "Unknown") {
      if (
        bodyHtml.includes("text-difficulty-easy") ||
        /class[^"]*easy/i.test(bodyHtml)
      )
        difficulty = "Easy";
      else if (
        bodyHtml.includes("text-difficulty-medium") ||
        /class[^"]*medium/i.test(bodyHtml)
      )
        difficulty = "Medium";
      else if (
        bodyHtml.includes("text-difficulty-hard") ||
        /class[^"]*hard/i.test(bodyHtml)
      )
        difficulty = "Hard";
    }

    // Strategy 3: GFG-specific (Basic = Easy, School = Easy)
    if (difficulty === "Unknown" && platform === "gfg") {
      console.log(
        "[AC Sync] GFG: Starting comprehensive GFG difficulty detection",
      );

      // GFG uses various class names and structures - try all possible selectors
      const gfgSelectors = [
        // Common GFG difficulty selectors
        ".difficultyLabel",
        ".difficulty-label",
        ".difficulty_label",
        "[class*='difficultyLabel']",
        "[class*='difficulty-label']",
        "[class*='difficulty_label']",
        // Problem header/info areas
        ".problems_header_description",
        ".problem-header",
        ".problem-info",
        ".problemInfo",
        ".problem_description",
        ".basicInfo",
        // Tab/button selectors
        ".problem-tab",
        ".tab",
        ".difficulty-btn",
        ".btn-difficulty",
        // Generic difficulty/level
        "[class*='difficulty']",
        "[class*='level']",
        "[class*='Level']",
        // Badge/tag selectors
        ".badge",
        ".problem-badge",
        ".difficulty-tag",
        ".tag",
        ".tags-difficulty",
        ".round-fact",
        // Meta/article info
        ".article-meta",
        ".meta",
        ".problem-meta",
        // Header elements
        "h1",
        "h2",
        "h3",
        "h4",
        "header",
        ".page-header",
        // Specific GFG classes (from practice page structure)
        ".practice-problem-difficulty",
        ".problem-difficulty-level",
        ".difficulty-indicator",
        ".level-indicator",
      ];

      for (const sel of gfgSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          console.log(
            "[AC Sync] GFG: Checking difficulty selector",
            sel,
            "- found",
            els.length,
          );
        }
        for (const el of els) {
          const t = (el.textContent || "").toLowerCase().trim();
          const cls = String(el.className || "").toLowerCase();
          const combined = t + " " + cls;

          // Check for Basic/School (mapped to Easy)
          if (combined.includes("basic") || combined.includes("school")) {
            difficulty = "Easy";
            console.log(
              "[AC Sync] GFG: Found difficulty 'Easy' (basic/school) via",
              sel,
              "text:",
              t.substring(0, 50),
            );
            break;
          }
          // Check for Easy
          if (
            combined.includes("easy") &&
            !combined.includes("not easy") &&
            !combined.includes("uneasy")
          ) {
            difficulty = "Easy";
            console.log(
              "[AC Sync] GFG: Found difficulty 'Easy' via",
              sel,
              "text:",
              t.substring(0, 50),
            );
            break;
          }
          // Check for Medium
          if (combined.includes("medium")) {
            difficulty = "Medium";
            console.log(
              "[AC Sync] GFG: Found difficulty 'Medium' via",
              sel,
              "text:",
              t.substring(0, 50),
            );
            break;
          }
          // Check for Hard
          if (
            combined.includes("hard") &&
            !combined.includes("not hard") &&
            !combined.includes("shard")
          ) {
            difficulty = "Hard";
            console.log(
              "[AC Sync] GFG: Found difficulty 'Hard' via",
              sel,
              "text:",
              t.substring(0, 50),
            );
            break;
          }
        }
        if (difficulty !== "Unknown") break;
      }

      // Strategy 3b: Search all elements for text that contains difficulty
      if (difficulty === "Unknown") {
        console.log(
          "[AC Sync] GFG: Searching all elements for difficulty text",
        );
        const allElements = document.querySelectorAll("*");
        for (const el of allElements) {
          // Skip script, style, and hidden elements
          if (
            el.tagName === "SCRIPT" ||
            el.tagName === "STYLE" ||
            el.tagName === "NOSCRIPT"
          )
            continue;

          const text = (el.textContent || "").trim().toLowerCase();
          const cls = String(el.className || "").toLowerCase();

          // Check if element has very short text (likely a badge/label)
          if (text.length <= 10) {
            if (text === "basic" || text === "school" || text === "easy") {
              difficulty = "Easy";
              console.log(
                "[AC Sync] GFG: Found difficulty 'Easy' via element text match, class:",
                cls,
              );
              break;
            }
            if (text === "medium") {
              difficulty = "Medium";
              console.log(
                "[AC Sync] GFG: Found difficulty 'Medium' via element text match, class:",
                cls,
              );
              break;
            }
            if (text === "hard") {
              difficulty = "Hard";
              console.log(
                "[AC Sync] GFG: Found difficulty 'Hard' via element text match, class:",
                cls,
              );
              break;
            }
          }

          // Check class names that might contain difficulty info
          if (cls.includes("easy") && !cls.includes("uneasy")) {
            difficulty = "Easy";
            console.log(
              "[AC Sync] GFG: Found difficulty 'Easy' via class name:",
              cls,
            );
            break;
          }
          if (cls.includes("medium")) {
            difficulty = "Medium";
            console.log(
              "[AC Sync] GFG: Found difficulty 'Medium' via class name:",
              cls,
            );
            break;
          }
          if (
            cls.includes("hard") &&
            !cls.includes("shard") &&
            !cls.includes("hardcoded")
          ) {
            difficulty = "Hard";
            console.log(
              "[AC Sync] GFG: Found difficulty 'Hard' via class name:",
              cls,
            );
            break;
          }
        }
      }

      // Strategy 3c: Look in specific GFG problem page structure areas
      if (difficulty === "Unknown") {
        console.log("[AC Sync] GFG: Checking problem page structure areas");

        // Try to find the problem title area and look around it
        const titleSelectors = [
          "h1",
          ".problem-title",
          ".article-title",
          ".title",
        ];
        for (const sel of titleSelectors) {
          const titleEl = document.querySelector(sel);
          if (titleEl && titleEl.parentElement) {
            // Check siblings and parent's siblings
            const parent = titleEl.parentElement;
            const siblings = parent.querySelectorAll("*");
            for (const sib of siblings) {
              const text = (sib.textContent || "").trim().toLowerCase();
              if (text === "easy" || text === "basic" || text === "school") {
                difficulty = "Easy";
                console.log(
                  "[AC Sync] GFG: Found difficulty 'Easy' near title",
                );
                break;
              }
              if (text === "medium") {
                difficulty = "Medium";
                console.log(
                  "[AC Sync] GFG: Found difficulty 'Medium' near title",
                );
                break;
              }
              if (text === "hard") {
                difficulty = "Hard";
                console.log(
                  "[AC Sync] GFG: Found difficulty 'Hard' near title",
                );
                break;
              }
            }
            if (difficulty !== "Unknown") break;
          }
        }
      }

      // Strategy 3d: AGGRESSIVE - Check all small text elements (buttons, spans, badges)
      if (difficulty === "Unknown") {
        console.log("[AC Sync] GFG: Aggressive search on all small elements");

        // Get all elements and look for ones with very short text
        const allEls = document.querySelectorAll(
          "span, button, a, div, label, strong, b, em, i",
        );
        for (const el of allEls) {
          const text = (el.textContent || "").trim();
          // Only check elements with very short text (1-8 chars) - typical for badges
          if (text.length >= 1 && text.length <= 8) {
            const lower = text.toLowerCase();
            // Strict matching for exact difficulty names
            if (lower === "easy" || lower === "basic" || lower === "school") {
              difficulty = "Easy";
              console.log(
                "[AC Sync] GFG: Found difficulty 'Easy' in small element:",
                el.tagName,
                "class:",
                el.className,
              );
              break;
            }
            if (lower === "medium") {
              difficulty = "Medium";
              console.log(
                "[AC Sync] GFG: Found difficulty 'Medium' in small element:",
                el.tagName,
                "class:",
                el.className,
              );
              break;
            }
            if (lower === "hard") {
              difficulty = "Hard";
              console.log(
                "[AC Sync] GFG: Found difficulty 'Hard' in small element:",
                el.tagName,
                "class:",
                el.className,
              );
              break;
            }
          }
        }
      }

      // Strategy 3e: Check inline styles or data attributes that might indicate difficulty
      if (difficulty === "Unknown") {
        console.log(
          "[AC Sync] GFG: Checking data attributes and inline styles",
        );
        const allEls = document.querySelectorAll(
          "[data-difficulty], [data-level], [class*='easy'], [class*='medium'], [class*='hard']",
        );
        for (const el of allEls) {
          const dataDiff =
            el.getAttribute("data-difficulty") ||
            el.getAttribute("data-level") ||
            "";
          const cls = String(el.className || "").toLowerCase();
          const combined = (dataDiff + " " + cls).toLowerCase();

          if (combined.includes("easy") || combined.includes("basic")) {
            difficulty = "Easy";
            console.log("[AC Sync] GFG: Found 'Easy' via data attr/class");
            break;
          }
          if (combined.includes("medium")) {
            difficulty = "Medium";
            console.log("[AC Sync] GFG: Found 'Medium' via data attr/class");
            break;
          }
          if (combined.includes("hard")) {
            difficulty = "Hard";
            console.log("[AC Sync] GFG: Found 'Hard' via data attr/class");
            break;
          }
        }
      }
    }

    // Strategy 4: Word boundary matching in body text
    if (difficulty === "Unknown") {
      if (/\bEasy\b/.test(bodyText)) difficulty = "Easy";
      else if (/\bMedium\b/.test(bodyText)) difficulty = "Medium";
      else if (/\bHard\b/.test(bodyText)) difficulty = "Hard";
    }

    // Strategy 5: Codeforces-specific rating-based difficulty
    if (difficulty === "Unknown" && platform === "codeforces") {
      console.log(
        "[AC Sync] Codeforces: Attempting rating-based difficulty classification",
      );

      // Extract rating from page text
      // Codeforces shows rating like "*800" or "Rating: 800" or "difficulty: 800"
      const ratingMatch =
        bodyText.match(/\*?(\d{3,4})/) ||
        bodyText.match(/[Rr]ating[:\s]*(\d{3,4})/) ||
        bodyText.match(/[Dd]ifficulty[:\s]*(\d{3,4})/);

      if (ratingMatch) {
        const rating = parseInt(ratingMatch[1]);
        console.log("[AC Sync] Codeforces: Found rating:", rating);

        // Codeforces rating to difficulty mapping
        // 800-1200: Easy (div 2 A/B)
        // 1300-1600: Medium (div 2 C/D, div 1 A/B)
        // 1700+: Hard (div 2 E, div 1 C+)
        if (rating <= 1200) {
          difficulty = "Easy";
          console.log("[AC Sync] Codeforces: Rating", rating, "-> Easy");
        } else if (rating <= 1600) {
          difficulty = "Medium";
          console.log("[AC Sync] Codeforces: Rating", rating, "-> Medium");
        } else {
          difficulty = "Hard";
          console.log("[AC Sync] Codeforces: Rating", rating, "-> Hard");
        }
      } else {
        // Try to find rating in HTML class names or data attributes
        const html = document.body?.innerHTML || "";
        const htmlRatingMatch =
          html.match(/rating["']?\s*[:=]\s*["']?(\d{3,4})/i) ||
          html.match(/difficulty["']?\s*[:=]\s*["']?(\d{3,4})/i);
        if (htmlRatingMatch) {
          const rating = parseInt(htmlRatingMatch[1]);
          console.log("[AC Sync] Codeforces: Found rating in HTML:", rating);
          if (rating <= 1200) difficulty = "Easy";
          else if (rating <= 1600) difficulty = "Medium";
          else difficulty = "Hard";
        }
      }

      // If still unknown, try to infer from problem code
      if (difficulty === "Unknown") {
        const problemCode = location.pathname.match(/\/problem\/(\w)/);
        if (problemCode) {
          const code = problemCode[1].toUpperCase();
          console.log("[AC Sync] Codeforces: Problem code:", code);
          // A, B problems are usually Easy
          // C, D problems are usually Medium
          // E, F problems are usually Hard
          if (code === "A" || code === "B") {
            difficulty = "Easy";
            console.log("[AC Sync] Codeforces: Problem code", code, "-> Easy");
          } else if (code === "C" || code === "D") {
            difficulty = "Medium";
            console.log(
              "[AC Sync] Codeforces: Problem code",
              code,
              "-> Medium",
            );
          } else {
            difficulty = "Hard";
            console.log("[AC Sync] Codeforces: Problem code", code, "-> Hard");
          }
        }
      }
    }

    console.log("[AC Sync] Difficulty:", difficulty);
    return difficulty;
  }

  // ===== STATS EXTRACTION (runtime, memory) =====
  function extractStats(platform) {
    let runtime = "N/A";
    let memory = "N/A";
    const bodyText = document.body?.innerText || "";

    // Try specific elements first
    const runtimeSelectors = [
      "[data-key='runtime']",
      "[data-cy='runtime']",
      ".runtime__value",
      ".runtime-value",
      "[class*='runtime']",
    ];
    for (const sel of runtimeSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const m = (el.textContent || "").match(/(\d+\.?\d*)\s*ms/);
        if (m) {
          runtime = m[0];
          break;
        }
      }
    }

    const memorySelectors = [
      "[data-key='memory']",
      "[data-cy='memory']",
      ".memory__value",
      ".memory-value",
      "[class*='memory']",
    ];
    for (const sel of memorySelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const m = (el.textContent || "").match(/(\d+\.?\d*)\s*(MB|KB|GB)/i);
        if (m) {
          memory = m[0];
          break;
        }
      }
    }

    // Fallback: regex from body text
    if (runtime === "N/A") {
      const m = bodyText.match(/(\d+\.?\d*)\s*ms/);
      if (m) runtime = m[0];
    }
    if (memory === "N/A") {
      const m = bodyText.match(/(\d+\.?\d*)\s*MB/i);
      if (m) memory = m[0];
    }

    return { runtime, memory };
  }

  // ===== LANGUAGE DETECTION =====
  function detectLanguage(code) {
    if (!code) return "C++";
    if (
      code.includes("#include") ||
      code.includes("std::") ||
      code.includes("int main")
    )
      return "C++";
    if (
      code.includes("public class") ||
      code.includes("import java") ||
      code.includes("System.out")
    )
      return "Java";
    if (code.includes("def ") || code.includes("print(")) return "Python";
    if (
      code.includes("function ") ||
      code.includes("const ") ||
      code.includes("let ") ||
      code.includes("console.log")
    )
      return "JavaScript";
    return "C++";
  }

  // ===== AUTO-PUSH: VERDICT WATCHER =====
  function isProblemPage() {
    const path = location.pathname;
    if (platform === "leetcode") {
      // LeetCode: /problems/<slug>/ or /problems/<slug>/submissions/*
      return /\/problems\/[^/]+(\/submissions\/?)?/.test(path);
    }
    if (platform === "codeforces") {
      // Codeforces: /contest/<id>/problem/<code> or /problemset/problem/<id>/<code>
      // Also /contest/<id>/submission/<id> (submission result page)
      // Also /problemset/status and /contest/<id>/status (status pages)
      // Exclude profile pages like /profile/<user>
      const isProblem =
        /\/(contest\/\d+\/problem|contest\/\d+\/submission|problemset\/problem|gym\/\d+\/problem)\//.test(
          path,
        );
      const isStatus = /\/(problemset\/status|contest\/\d+\/status)/.test(path);
      return isProblem || isStatus;
    }
    if (platform === "gfg") {
      // GFG: /problems/<slug> or /practice/problems/<slug>
      // Also /problems/<slug>/submissions (submission result)
      // Exclude profile/user pages
      return (
        /\/(problems|practice\/problems)\/[^/]+/.test(path) &&
        !/\/(user|profile|my-profile)\//.test(path)
      );
    }
    return false;
  }

  function getVerdictText() {
    // LeetCode: result banner
    const lcSelectors = [
      "[data-e2e-locator='submission-result']",
      ".submission-result",
      "[class*='result_'] span",
      "[class*='ResultState']",
      "[class*='status-accepted']",
      "[data-status='accepted']",
      ".success__3Ai7",
      "span.text-green-s",
      "div[class*='accepted']",
    ];
    // Codeforces: verdict in submission table or result
    const cfSelectors = [
      ".verdict-accepted",
      ".verdict_accepted",
      "span.verdict-accepted",
      "td.verdict-accepted",
      "span[submissionverdict='AC']",
      "[data-submission-verdict='AC']",
    ];
    // GFG: result area
    const gfgSelectors = [
      ".result__header",
      "[class*='accepted']",
      ".problem-status-accepted",
      "[class*='status-accepted']",
      ".verdict-accepted",
      "span.accepted",
      "div[class*='Accepted']",
      ".submission-status",
    ];

    const selectors =
      platform === "leetcode"
        ? lcSelectors
        : platform === "codeforces"
          ? cfSelectors
          : gfgSelectors;

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.textContent || "").trim();
        if (text) {
          console.log(
            "[AC Sync] Verdict text found via",
            sel,
            ":",
            text.substring(0, 80),
          );
          return text;
        }
      }
    }
    return "";
  }

  function isAcceptedVerdict(text) {
    const t = text.toLowerCase();
    return (
      t.includes("accepted") &&
      !t.includes("wrong") &&
      !t.includes("time limit") &&
      !t.includes("memory limit") &&
      !t.includes("runtime error") &&
      !t.includes("compilation")
    );
  }

  function watchForAcceptedVerdict() {
    if (!isProblemPage()) {
      console.log("[AC Sync] Not a problem page, skipping verdict watcher");
      return;
    }
    // CF status pages have their own dedicated watcher
    if (platform === "codeforces" && isCFStatusPage()) {
      console.log(
        "[AC Sync] CF status page — skipping general verdict watcher",
      );
      return;
    }

    console.log(
      "[AC Sync] Verdict watcher started — platform:",
      platform,
      "path:",
      location.pathname,
    );

    let pushed = false; // session-level guard
    let retryCount = 0;
    const MAX_RETRIES = 1;

    const observer = new MutationObserver(async () => {
      if (pushed) return;
      const verdictText = getVerdictText();
      if (!verdictText || !isAcceptedVerdict(verdictText)) return;

      console.log("[AC Sync] Accepted detected — verdict:", verdictText);
      console.log("[AC Sync] Waiting 700ms for DOM/editor to settle...");

      // Delay to let platform update DOM/editor asynchronously
      await new Promise((r) => setTimeout(r, 700));

      try {
        const data = await collectAll(platform);
        data.accepted = true;

        // Validate payload before sending
        if (!data.code || data.code.length <= 10 || !data.problemTitle) {
          console.warn(
            "[AC Sync] Auto-push validation failed — code length:",
            data.code?.length,
            "title:",
            data.problemTitle,
          );
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.log(
              "[AC Sync] Retrying collection (attempt",
              retryCount,
              ") in 1.5s...",
            );
            await new Promise((r) => setTimeout(r, 1500));
            // Re-collect after delay
            try {
              const retryData = await collectAll(platform);
              retryData.accepted = true;
              if (
                retryData.code &&
                retryData.code.length > 10 &&
                retryData.problemTitle
              ) {
                console.log(
                  "[AC Sync] Retry succeeded — code length:",
                  retryData.code.length,
                  "title:",
                  retryData.problemTitle,
                );
                chrome.runtime.sendMessage(
                  { type: "AUTO_PUSH_ACCEPTED", payload: retryData },
                  (res) => {
                    if (chrome.runtime.lastError) {
                      console.debug(
                        "[AC Sync] Auto-push message error:",
                        chrome.runtime.lastError.message,
                      );
                    } else {
                      console.log("[AC Sync] Auto-push response:", res);
                    }
                  },
                );
                pushed = true;
                observer.disconnect();
                return;
              }
            } catch (retryErr) {
              console.error("[AC Sync] Retry collection error:", retryErr);
            }
          }
          console.warn(
            "[AC Sync] Max retries reached, giving up auto-push for this page",
          );
          pushed = true;
          observer.disconnect();
          return;
        }

        console.log(
          "[AC Sync] Auto-push payload valid — code length:",
          data.code.length,
          "title:",
          data.problemTitle,
          "difficulty:",
          data.difficulty,
        );

        chrome.runtime.sendMessage(
          { type: "AUTO_PUSH_ACCEPTED", payload: data },
          (res) => {
            if (chrome.runtime.lastError) {
              console.debug(
                "[AC Sync] Auto-push message error:",
                chrome.runtime.lastError.message,
              );
            } else {
              console.log("[AC Sync] Auto-push response:", res);
            }
          },
        );
        console.log("[AC Sync] Auto-push message sent");
        pushed = true;
        observer.disconnect();
      } catch (err) {
        console.error("[AC Sync] Auto-push collection failed:", err);
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          console.log(
            "[AC Sync] Retrying after error (attempt",
            retryCount,
            ") in 1.5s...",
          );
        } else {
          pushed = true;
          observer.disconnect();
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    console.log("[AC Sync] Verdict watcher active on:", location.pathname);
  }

  // ===== CODEFORCES STATUS PAGE WATCHER =====
  function isCFStatusPage() {
    return /\/(problemset\/status|contest\/\d+\/status)/.test(
      location.pathname,
    );
  }

  async function watchForCFStatusAccepted() {
    console.log("[AC Sync] CF status watcher active on:", location.pathname);

    let pushed = false;
    const watcherStartTime = Date.now();

    // Dedup guard: check last pushed submission ID
    const stored = await chrome.storage.local.get([
      "lastAutoPushedCFSubmissionId",
    ]);
    let lastPushedId = stored.lastAutoPushedCFSubmissionId || "";

    // Helper: extract submission ID as the LAST numeric segment from a submission href
    // e.g. /problemset/submission/2225/374016729 -> 374016729
    // e.g. /contest/2225/submission/374016729 -> 374016729
    function parseSubmissionId(href) {
      const parts = href.split("/").filter(Boolean);
      for (let i = parts.length - 1; i >= 0; i--) {
        if (/^\d{6,}$/.test(parts[i])) return parts[i];
      }
      return "";
    }

    // Snapshot baseline: all accepted submission IDs already on the page at startup
    const baselineIds = new Set();
    function snapshotBaseline() {
      const existingCells = document.querySelectorAll(
        "td.verdict-accepted, span.verdict-accepted, .verdict_accepted",
      );
      for (const cell of existingCells) {
        const row = cell.closest("tr");
        if (!row) continue;
        const link = row.querySelector('a[href*="/submission/"]');
        if (!link) continue;
        const href = link.getAttribute("href") || "";
        const sid = parseSubmissionId(href);
        if (sid) baselineIds.add(sid);
      }
      console.log(
        "[AC Sync] CF baseline accepted ids:",
        baselineIds.size,
        Array.from(baselineIds).slice(0, 5).join(","),
      );
    }
    snapshotBaseline();

    // Helper: extract submission ID from an accepted row
    function getSubmissionIdFromRow(row) {
      const link = row.querySelector('a[href*="/submission/"]');
      if (!link) return "";
      const href = link.getAttribute("href") || "";
      const sid = parseSubmissionId(href);
      console.log(
        "[AC Sync] CF raw submission href:",
        href,
        "parsed submission id:",
        sid,
      );
      return sid;
    }

    const observer = new MutationObserver(async () => {
      if (pushed) return;

      // Find accepted rows in the status table
      const acceptedCells = document.querySelectorAll(
        "td.verdict-accepted, span.verdict-accepted, .verdict_accepted",
      );
      if (!acceptedCells.length) return;

      // Collect NEW accepted rows (not in baseline, not already pushed)
      const newRows = [];
      for (const cell of acceptedCells) {
        const row = cell.closest("tr");
        if (!row) continue;
        const submissionId = getSubmissionIdFromRow(row);
        if (!submissionId) continue;

        // Skip baseline rows (already on page when watcher started)
        if (baselineIds.has(submissionId)) {
          console.log(
            "[AC Sync] CF skipping baseline submission id:",
            submissionId,
          );
          continue;
        }

        // Skip already-pushed submission
        if (submissionId === lastPushedId) {
          console.log(
            "[AC Sync] CF skipping already-pushed submission",
            submissionId,
          );
          continue;
        }

        newRows.push({ row, submissionId });
      }

      if (!newRows.length) return;

      // Only push the FIRST (topmost) new accepted row
      const { row, submissionId } = newRows[0];
      console.log(
        "[AC Sync] CF new accepted submission detected:",
        submissionId,
      );

      // Extract problem info from the row
      // CF status rows have a dedicated problem anchor:
      //   /problemset/problem/<contest>/<code> or /contest/<id>/problem/<code>
      // The anchor text is like "1859A - United We Stand"
      const problemLink = row.querySelector(
        'a[href*="/problemset/problem/"], a[href*="/contest/"][href*="/problem/"]',
      );
      let problemTitle = "";
      let problemUrl = "";
      if (problemLink) {
        problemUrl = problemLink.getAttribute("href") || "";
        // Strip contest prefix like "1859A - " from "1859A - United We Stand"
        const rawTitle = problemLink.textContent.trim();
        const dashIdx = rawTitle.indexOf(" - ");
        problemTitle =
          dashIdx >= 0 ? rawTitle.substring(dashIdx + 3).trim() : rawTitle;
        console.log(
          "[AC Sync] CF: Problem link found, raw:",
          rawTitle,
          "cleaned:",
          problemTitle,
          "url:",
          problemUrl,
        );
      } else {
        console.warn("[AC Sync] CF: No problem link found in accepted row");
      }

      // Extract language from the row
      const langCell = row.querySelector("td:not(:first-child)");
      const language = langCell
        ? detectLanguage(langCell.textContent || "")
        : "C++";

      // Extract runtime and memory from the row
      const allTds = Array.from(row.querySelectorAll("td"));
      let runtime = "N/A";
      let memory = "N/A";
      for (let i = 0; i < allTds.length; i++) {
        const tdText = allTds[i].textContent.trim();
        if (/^\d+\s*ms$/.test(tdText)) runtime = tdText;
        if (/^\d+\s*KB$/i.test(tdText) || /^\d+\s*kB$/i.test(tdText))
          memory = tdText;
      }

      // Fetch the submission detail page to get the actual code
      console.log("[AC Sync] CF: Fetching submission detail for", submissionId);
      pushed = true; // Prevent duplicate triggers
      observer.disconnect();

      try {
        const submissionLink = row.querySelector('a[href*="/submission/"]');
        const submissionHref = submissionLink.getAttribute("href") || "";
        const detailUrl = new URL(submissionHref, location.origin).href;
        const resp = await fetch(detailUrl);
        const html = await resp.text();

        // Parse the HTML to extract code
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        let code = "";
        const codeSelectors = [
          "#program-source-text",
          ".program-source",
          ".submission-source",
          "#program-source",
          "pre",
        ];
        for (const sel of codeSelectors) {
          const el = doc.querySelector(sel);
          if (el) {
            const text = el.textContent || "";
            if (text.length > 30 && text.length > code.length) {
              code = text;
              console.log(
                "[AC Sync] CF: Found code via",
                sel,
                "in fetched page, length:",
                text.length,
              );
              break;
            }
          }
        }

        if (!code || code.length < 10) {
          console.warn("[AC Sync] CF: No code found in submission detail page");
          pushed = false; // Allow retry
          return;
        }

        // Build payload
        const payload = {
          platform: "codeforces",
          problemTitle: problemTitle || "Unknown Problem",
          difficulty: "Unknown",
          tags: [],
          language: language,
          code: code.trim(),
          accepted: true,
          submissionId: submissionId,
          stats: { runtime, memory },
          problemUrl: problemUrl
            ? new URL(problemUrl, location.origin).href
            : detailUrl,
          notes: "",
        };

        console.log(
          "[AC Sync] CF auto-push sent, submission id:",
          submissionId,
          "code length:",
          payload.code.length,
        );

        // Store dedup guard
        await chrome.storage.local.set({
          lastAutoPushedCFSubmissionId: submissionId,
        });

        chrome.runtime.sendMessage(
          { type: "AUTO_PUSH_ACCEPTED", payload },
          (res) => {
            if (chrome.runtime.lastError) {
              console.debug(
                "[AC Sync] CF auto-push message error:",
                chrome.runtime.lastError.message,
              );
            } else {
              console.log("[AC Sync] CF auto-push response:", res);
            }
          },
        );
      } catch (err) {
        console.error("[AC Sync] CF status auto-push failed:", err);
        pushed = false; // Allow retry on error
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Start watching
  watchForAcceptedVerdict();

  // Codeforces status page watcher
  if (platform === "codeforces" && isCFStatusPage()) {
    watchForCFStatusAccepted();
  }

  // ===== DEBUG HELPER =====
  window.ACSyncTest = () => collectAll(platform);

  window.ACSyncDebugCode = () => {
    console.log("=== AC Sync Code Diagnostics ===");
    console.log("URL:", location.href);
    console.log(
      "body.innerText length:",
      document.body?.innerText?.length || 0,
    );

    const selectors = [
      "pre",
      "code",
      "pre code",
      "textarea",
      "[class*='monaco']",
      "[class*='view-line']",
      "[class*='view-lines']",
      "[class*='CodeMirror']",
      "[class*='submission']",
      "[class*='code']",
      ".monaco-editor",
      ".ace_line",
      "[data-e2e-locator='code']",
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      console.log(`[${sel}] count: ${els.length}`);
      const limit = Math.min(els.length, 3);
      for (let i = 0; i < limit; i++) {
        const text = els[i].textContent || "";
        const preview = text.substring(0, 120).replace(/\n/g, "\\n");
        console.log(`  [${i}] textLen=${text.length} preview="${preview}"`);
      }
    }

    // Also run the actual extractor
    console.log("--- Running extractLeetCodeCode ---");
    const result = extractLeetCodeCode("");
    console.log(
      "Result length:",
      result.length,
      "first 200 chars:",
      result.substring(0, 200),
    );
    console.log("=== End Diagnostics ===");
    return result;
  };
})();
