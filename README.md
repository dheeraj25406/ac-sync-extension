# CodeSync Classy (Chrome Extension)

Classy, privacy-first Chrome extension that auto-pushes coding submissions from:
- LeetCode
- Codeforces
- GeeksForGeeks

No backend server. Your GitHub token stays in Chrome local/sync storage.

## Features

- Manifest V3 architecture.
- Auto-detects accepted/failed verdicts from page changes.
- Manual fallback with `Push Now (Current Tab)`.
- GitHub push with retry and clear error handling.
- Custom commit message template and folder template.
- Optional platform-specific repositories.
- WIP mode (push failed/partial attempts too).
- Popup analytics: total, weekly/monthly solved, mini contribution graph.
- Toast notifications and dark-themed UI.

## Folder Strategy

Default path template:
`{platform}/{difficulty}/{problem}.{ext}`

Examples:
- `LeetCode/Easy/Two-Sum.py`
- `Codeforces/1500/Kefa-and-Company.cpp`
- `GeeksForGeeks/Medium/Find-Triplets.cpp`

## Setup

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `cp-git-sync-extension` folder.
5. Open extension popup:
   - Add GitHub fine-grained token.
   - Add repo (`owner/name`) and branch.
   - Enable desired platforms.
6. Solve on LeetCode/Codeforces/GFG and submit.

## Security

- Uses GitHub REST API directly from extension service worker.
- No third-party server storage.
- Minimal core permissions:
  - `storage`
  - `activeTab`
  - `scripting`
- Host permissions are only for supported platforms + GitHub API.

## Known Caveats

- Competitive sites frequently change DOM. Manual push is included as a reliable backup.
- Monaco/editor extraction can vary by page layout and submission view.
- Bulk historical backfill is not fully implemented yet (next upgrade item).

## Next Upgrade Ideas

- Batch export/backfill older submissions per platform.
- Better network-level verdict detection hooks for each platform.
- AI commit notes (premium), richer analytics, and sync diagnostics panel.
