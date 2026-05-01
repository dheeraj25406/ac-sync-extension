Changelog - quick fixes

- 2026-04-11: Disabled automatic push from content script.
  - Content script no longer sends MANUAL_PUSH automatically when a verdict appears.
  - Detected submissions are saved to `chrome.storage.local.submissions` and a toast prompts the user to open the extension and push manually.
- 2026-04-11: Improved LeetCode runtime & memory extraction.
  - Added robust selector and text-based fallbacks to capture runtime (ms) and memory (MB) values.
- Syntax-checked modified JS files.

Notes / How to test

1. Load unpacked extension in Chrome/Edge via chrome://extensions (Developer mode).
2. Open a LeetCode problem and submit; when verdict appears the extension will show a toast "Accepted: <problem>. Open extension to push." and will NOT push automatically.
3. Click the extension popup and press "Push to GitHub!" to perform a manual push (requires GitHub token and repo configured in Settings).

If anything else misbehaves, re-open the extension popup console (right-click popup -> Inspect) and the page console on LeetCode to see helpful logs.
