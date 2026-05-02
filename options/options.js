const $ = (id) => document.getElementById(id);

document.getElementById("save").addEventListener("click", save);
document
  .getElementById("loginGithub")
  .addEventListener("click", loginWithGithub);
document.getElementById("logoutGithub").addEventListener("click", logoutGithub);
load();

async function loginWithGithub() {
  chrome.runtime.sendMessage({ type: "GITHUB_OAUTH_LOGIN" }, (res) => {
    if (chrome.runtime.lastError) {
      console.error(
        "[AC Sync] OAuth login message failed:",
        chrome.runtime.lastError,
      );
      $("authStatus").textContent =
        "Login failed: " + chrome.runtime.lastError.message;
      return;
    }
    if (res && res.ok) {
      updateAuthStatus("connected");
      load();
    } else {
      console.error("[AC Sync] OAuth login failed:", res?.error);
      $("authStatus").textContent =
        "Login failed: " + (res?.error || "unknown");
    }
  });
}

async function logoutGithub() {
  await chrome.storage.sync.remove("githubToken");
  $("token").value = "";
  updateAuthStatus("");
}

function updateAuthStatus(token) {
  const connected = !!token && token !== "";
  $("authStatus").textContent = connected
    ? "✓ Connected to GitHub"
    : "Not connected";
  $("authStatus").style.color = connected ? "#4ade80" : "#94a3b8";
  $("loginGithub").style.display = connected ? "none" : "inline-block";
  $("logoutGithub").style.display = connected ? "inline-block" : "none";
}

async function load() {
  const s = await chrome.storage.sync.get([
    "githubToken",
    "defaultRepo",
    "defaultBranch",
    "platformFolders",
    "commitMessageTemplate",
    "allowWip",
    "autoPushEnabled",
    "darkMode",
  ]);
  $("token").value = s.githubToken || "";
  $("repo").value = s.defaultRepo || "";
  $("branch").value = s.defaultBranch || "main";
  $("folderLC").value = s.platformFolders?.leetcode || "LeetCode";
  $("folderCF").value = s.platformFolders?.codeforces || "CodeForces";
  $("folderGFG").value = s.platformFolders?.gfg || "GeeksForGeeks";
  $("commitTemplate").value =
    s.commitMessageTemplate || "feat({platform}): solve {problem} [{language}]";
  $("allowWip").checked = s.allowWip ?? true;
  $("autoPushEnabled").checked = s.autoPushEnabled ?? false;
  $("darkMode").checked = s.darkMode ?? true;
  updateAuthStatus(s.githubToken);
}

async function save() {
  await chrome.storage.sync.set({
    githubToken: $("token").value.trim(),
    defaultRepo: $("repo").value.trim(),
    defaultBranch: $("branch").value.trim() || "main",
    platformFolders: {
      leetcode: $("folderLC").value.trim() || "LeetCode",
      codeforces: $("folderCF").value.trim() || "CodeForces",
      gfg: $("folderGFG").value.trim() || "GeeksForGeeks",
    },
    commitMessageTemplate:
      $("commitTemplate").value.trim() ||
      "feat({platform}): solve {problem} [{language}]",
    allowWip: $("allowWip").checked,
    autoPushEnabled: $("autoPushEnabled").checked,
    darkMode: $("darkMode").checked,
  });
  $("status").textContent = "Saved successfully.";
  setTimeout(() => {
    $("status").textContent = "";
  }, 1700);
}
