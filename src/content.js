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
    const code = extractCode(platform);
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

    return {
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
  }

  // ===== CODE EXTRACTION =====
  function extractCode(platform) {
    console.log("[AC Sync] Extracting code for platform:", platform);

    // Completely independent extraction for each platform
    if (platform === "leetcode") {
      return extractLeetCodeCode("");
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
  function extractLeetCodeCode(currentBest) {
    let code = "";
    console.log("[AC Sync] LeetCode: Starting LeetCode-specific extraction");

    // 1. Monaco .view-line (primary LeetCode editor)
    const monacoLines = Array.from(document.querySelectorAll(".view-line"))
      .map((el) => el.textContent)
      .filter(Boolean);
    if (monacoLines.length > 3) {
      const joined = monacoLines.join("\n");
      if (joined.length > code.length) {
        code = joined;
        console.log(
          "[AC Sync] LeetCode: Found code via .view-line, lines:",
          monacoLines.length,
        );
      }
    }

    // 2. Monaco editor container
    if (code.length < 50) {
      const monacoEditor = document.querySelector(".monaco-editor");
      if (monacoEditor) {
        const lines = Array.from(monacoEditor.querySelectorAll(".view-line"))
          .map((el) => el.textContent)
          .filter(Boolean);
        if (lines.length > 3) {
          const joined = lines.join("\n");
          if (joined.length > code.length) {
            code = joined;
            console.log(
              "[AC Sync] LeetCode: Found code in .monaco-editor container, lines:",
              lines.length,
            );
          }
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
        "[data-e2e-locator='code']",
        ".submission-code",
        ".code-view",
        ".ace_editor",
        ".code-editor",
        ".editor-area",
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
          console.log(
            "[AC Sync] LeetCode: Found code in textarea, length:",
            val.length,
          );
          break;
        }
      }
    }

    // 6. Pre/code blocks (submission pages)
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
            "[AC Sync] LeetCode: Found code in pre/code block, length:",
            text.length,
          );
          break;
        }
      }
    }

    // 7. Body pattern fallback
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
            "[AC Sync] LeetCode: Found code via body pattern, length:",
            m[0].length,
          );
          break;
        }
      }
    }

    console.log("[AC Sync] LeetCode: Final code length:", code.length);
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
      // Exclude profile pages like /profile/<user>
      return /\/(contest\/\d+\/problem|contest\/\d+\/submission|problemset\/problem|gym\/\d+\/problem)\//.test(
        path,
      );
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

  // Start watching
  watchForAcceptedVerdict();

  // ===== DEBUG HELPER =====
  window.ACSyncTest = () => collectAll(platform);
})();
