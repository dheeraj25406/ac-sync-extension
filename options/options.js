const $ = (id) => document.getElementById(id);

document.getElementById("save").addEventListener("click", save);
load();

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
