// Collects every tab group across every window, in tab order.

async function collect() {
  const windows = await chrome.windows.getAll({ populate: false });
  const groups = [];

  for (const win of windows) {
    const [tabs, winGroups] = await Promise.all([
      chrome.tabs.query({ windowId: win.id }),
      chrome.tabGroups.query({ windowId: win.id }),
    ]);

    const byId = new Map(winGroups.map((g) => [g.id, g]));

    for (const tab of tabs) {
      if (tab.groupId === chrome.tabs.TAB_GROUP_ID_NONE) continue;
      const meta = byId.get(tab.groupId);
      if (!meta) continue;
      let entry = groups.find((g) => g.id === tab.groupId);
      if (!entry) {
        entry = {
          id: tab.groupId,
          windowId: win.id,
          title: meta.title,
          color: meta.color,
          index: meta.index,
          tabs: [],
        };
        groups.push(entry);
      }
      entry.tabs.push({ url: tab.url, title: tab.title, pinned: tab.pinned });
    }
  }

  groups.sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  return groups;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
}

function toMarkdown(groups) {
  const out = [`# Tab groups`, ``, `Exported ${new Date().toISOString()}.`, ``];
  groups.forEach((g, i) => {
    out.push(`## ${i + 1}. ${g.title || "Untitled"} (${g.color})`, ``);
    for (const t of g.tabs) out.push(`- ${t.url}`);
    out.push(``);
  });
  return out.join("\n");
}

function filename() {
  const d = new Date().toISOString().slice(0, 10);
  return `tab-groups-${d}.md`;
}

function download(md) {
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  return chrome.downloads.download({ url, filename: filename(), saveAs: true })
    .then(() => URL.revokeObjectURL(url));
}

// --- UI ---

const $ = (id) => document.getElementById(id);
let all = [];
const selected = new Set();

function render() {
  $("groups").replaceChildren();
  all.forEach((g) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selected.has(g.id);
    box.addEventListener("change", () => {
      box.checked ? selected.add(g.id) : selected.delete(g.id);
    });
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = g.color;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = g.title || "Untitled";
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = g.tabs.length;
    label.append(box, sw, name, count);
    $("groups").append(label);
  });
  const urls = all.reduce((n, g) => n + g.tabs.length, 0);
  $("total").textContent = `(${all.length} groups, ${urls} tabs)`;
}

function status(msg) {
  $("status").textContent = msg;
}

function chosen() {
  return all.filter((g) => selected.has(g.id));
}

$("all").addEventListener("click", () => {
  all.forEach((g) => selected.add(g.id));
  render();
});

$("none").addEventListener("click", () => {
  selected.clear();
  render();
});

$("export").addEventListener("click", async () => {
  const groups = chosen();
  if (!groups.length) return status("Select at least one group.");
  await download(toMarkdown(groups));
  status(`Exported ${groups.length} groups.`);
});

$("copy").addEventListener("click", async () => {
  const groups = chosen();
  if (!groups.length) return status("Select at least one group.");
  await navigator.clipboard.writeText(toMarkdown(groups));
  status("Copied to clipboard.");
});

(async () => {
  all = await collect();
  all.forEach((g) => selected.add(g.id));
  render();
  status("");
})();
