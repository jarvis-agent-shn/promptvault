/**
 * PromptVault data layer.
 *
 * Plain script (NOT an ES module) so it can be loaded via <script src>,
 * on-demand injection via chrome.scripting.executeScript, and
 * importScripts() from the background service worker, all sharing the
 * same global namespace: `globalThis.PVStore`.
 *
 * Storage shape (chrome.storage.local):
 *   pv_folders:  Folder[]
 *   pv_snippets: Snippet[]
 *   pv_settings: Settings
 *   pv_seeded:   boolean
 *
 * Folder:   { id, name, createdAt }
 * Snippet:  { id, folderId, title, body, tags: string[], trigger: string|null,
 *             createdAt, updatedAt }
 * Settings: { theme: 'system' }
 */
(function (global) {
  "use strict";

  const KEYS = {
    FOLDERS: "pv_folders",
    SNIPPETS: "pv_snippets",
    SETTINGS: "pv_settings",
    SEEDED: "pv_seeded",
  };

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          const err = chrome.runtime.lastError;
          if (err) reject(err);
          else resolve(result);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(obj, () => {
          const err = chrome.runtime.lastError;
          if (err) reject(err);
          else resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function genId() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
    );
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ---------- Folders ----------

  async function getFolders() {
    const { [KEYS.FOLDERS]: folders } = await storageGet(KEYS.FOLDERS);
    return Array.isArray(folders) ? folders : [];
  }

  async function saveFolder(folder) {
    const folders = await getFolders();
    if (folder.id) {
      const idx = folders.findIndex((f) => f.id === folder.id);
      if (idx >= 0) {
        folders[idx] = { ...folders[idx], ...folder };
      } else {
        folders.push(folder);
      }
    } else {
      folder.id = genId();
      folder.createdAt = nowIso();
      folders.push(folder);
    }
    await storageSet({ [KEYS.FOLDERS]: folders });
    return folder;
  }

  async function deleteFolder(folderId, { deleteSnippets = false } = {}) {
    const [folders, snippets] = await Promise.all([getFolders(), getSnippets()]);
    const nextFolders = folders.filter((f) => f.id !== folderId);
    let nextSnippets;
    if (deleteSnippets) {
      nextSnippets = snippets.filter((s) => s.folderId !== folderId);
    } else {
      // Move orphaned snippets to "Unsorted" (folderId = null)
      nextSnippets = snippets.map((s) =>
        s.folderId === folderId ? { ...s, folderId: null } : s
      );
    }
    await storageSet({
      [KEYS.FOLDERS]: nextFolders,
      [KEYS.SNIPPETS]: nextSnippets,
    });
  }

  // ---------- Snippets ----------

  async function getSnippets() {
    const { [KEYS.SNIPPETS]: snippets } = await storageGet(KEYS.SNIPPETS);
    return Array.isArray(snippets) ? snippets : [];
  }

  async function getSnippet(id) {
    const snippets = await getSnippets();
    return snippets.find((s) => s.id === id) || null;
  }

  async function saveSnippet(snippet) {
    const snippets = await getSnippets();
    if (snippet.id) {
      const idx = snippets.findIndex((s) => s.id === snippet.id);
      if (idx >= 0) {
        snippets[idx] = {
          ...snippets[idx],
          ...snippet,
          updatedAt: nowIso(),
        };
      } else {
        snippets.push({ ...snippet, updatedAt: nowIso() });
      }
    } else {
      snippet.id = genId();
      snippet.createdAt = nowIso();
      snippet.updatedAt = snippet.createdAt;
      if (!Array.isArray(snippet.tags)) snippet.tags = [];
      snippets.push(snippet);
    }
    await storageSet({ [KEYS.SNIPPETS]: snippets });
    return snippet;
  }

  async function deleteSnippet(id) {
    const snippets = await getSnippets();
    const next = snippets.filter((s) => s.id !== id);
    await storageSet({ [KEYS.SNIPPETS]: next });
  }

  async function countSnippets() {
    const snippets = await getSnippets();
    return snippets.length;
  }

  // ---------- Search ----------

  async function search(query, { folderId = null } = {}) {
    const snippets = await getSnippets();
    let results = snippets;
    if (folderId) {
      results = results.filter((s) => s.folderId === folderId);
    }
    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      results = results.filter((s) => {
        const hay = [
          s.title || "",
          s.body || "",
          (s.tags || []).join(" "),
          s.trigger || "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return results;
  }

  // ---------- Variables ----------

  const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

  function extractVariables(body) {
    const names = [];
    const seen = new Set();
    let m;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(body || ""))) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        names.push(m[1]);
      }
    }
    return names;
  }

  function fillVariables(body, values) {
    return (body || "").replace(VAR_RE, (match, name) => {
      const v = values && values[name];
      return v !== undefined && v !== null && v !== "" ? v : match;
    });
  }

  // ---------- Settings ----------

  async function getSettings() {
    const { [KEYS.SETTINGS]: settings } = await storageGet(KEYS.SETTINGS);
    return settings || { theme: "system" };
  }

  async function saveSettings(settings) {
    const current = await getSettings();
    const next = { ...current, ...settings };
    await storageSet({ [KEYS.SETTINGS]: next });
    return next;
  }

  // ---------- Export / Import ----------

  async function exportData() {
    const [folders, snippets, settings] = await Promise.all([
      getFolders(),
      getSnippets(),
      getSettings(),
    ]);
    return {
      version: 1,
      exportedAt: nowIso(),
      folders,
      snippets,
      settings,
    };
  }

  async function exportJson() {
    const data = await exportData();
    return JSON.stringify(data, null, 2);
  }

  function validateImportShape(data) {
    if (!data || typeof data !== "object") return "Invalid file: not an object.";
    if (!Array.isArray(data.folders)) return "Invalid file: missing 'folders' array.";
    if (!Array.isArray(data.snippets)) return "Invalid file: missing 'snippets' array.";
    return null;
  }

  /**
   * Imports data. mode: 'merge' (default, keeps existing + adds new ids)
   * or 'replace' (overwrites everything).
   */
  async function importData(data, { mode = "merge" } = {}) {
    const err = validateImportShape(data);
    if (err) throw new Error(err);

    if (mode === "replace") {
      await storageSet({
        [KEYS.FOLDERS]: data.folders,
        [KEYS.SNIPPETS]: data.snippets,
        [KEYS.SETTINGS]: data.settings || { theme: "system" },
      });
      return { foldersAdded: data.folders.length, snippetsAdded: data.snippets.length };
    }

    // merge mode: dedupe by id, imported wins on conflict
    const [existingFolders, existingSnippets] = await Promise.all([
      getFolders(),
      getSnippets(),
    ]);
    const folderMap = new Map(existingFolders.map((f) => [f.id, f]));
    for (const f of data.folders) folderMap.set(f.id, f);
    const snippetMap = new Map(existingSnippets.map((s) => [s.id, s]));
    for (const s of data.snippets) snippetMap.set(s.id, s);

    const mergedFolders = Array.from(folderMap.values());
    const mergedSnippets = Array.from(snippetMap.values());

    await storageSet({
      [KEYS.FOLDERS]: mergedFolders,
      [KEYS.SNIPPETS]: mergedSnippets,
    });
    return {
      foldersAdded: data.folders.length,
      snippetsAdded: data.snippets.length,
    };
  }

  // ---------- Seed data ----------

  async function seedIfEmpty() {
    const { [KEYS.SEEDED]: seeded } = await storageGet(KEYS.SEEDED);
    if (seeded) return false;

    const [folders, snippets] = await Promise.all([getFolders(), getSnippets()]);
    if (folders.length > 0 || snippets.length > 0) {
      await storageSet({ [KEYS.SEEDED]: true });
      return false;
    }

    const writingId = genId();
    const codingId = genId();
    const ts = nowIso();

    const seedFolders = [
      { id: writingId, name: "Writing", createdAt: ts },
      { id: codingId, name: "Coding", createdAt: ts },
    ];

    const seedSnippets = [
      {
        id: genId(),
        folderId: writingId,
        title: "Polish this text",
        body:
          "Please improve the clarity, grammar, and flow of the following text while keeping its original meaning and tone:\n\n{{text}}",
        tags: ["editing", "writing"],
        trigger: ";polish",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: genId(),
        folderId: writingId,
        title: "Summarize",
        body:
          "Summarize the following in {{length}} bullet points, focused on the key takeaways:\n\n{{text}}",
        tags: ["summary"],
        trigger: ";sum",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: genId(),
        folderId: writingId,
        title: "Professional email reply",
        body:
          "Write a polite, professional email reply to the message below. Tone: {{tone}}.\n\nOriginal message:\n{{text}}",
        tags: ["email"],
        trigger: ";email",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: genId(),
        folderId: codingId,
        title: "Explain this code",
        body:
          "Explain what the following code does, step by step, as if teaching a junior developer:\n\n```\n{{code}}\n```",
        tags: ["explain", "code review"],
        trigger: ";explain",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: genId(),
        folderId: codingId,
        title: "Fix this bug",
        body:
          "The following code has a bug: {{issue}}. Identify the root cause and provide a corrected version with a brief explanation:\n\n```\n{{code}}\n```",
        tags: ["debugging"],
        trigger: ";fix",
        createdAt: ts,
        updatedAt: ts,
      },
    ];

    await storageSet({
      [KEYS.FOLDERS]: seedFolders,
      [KEYS.SNIPPETS]: seedSnippets,
      [KEYS.SEEDED]: true,
    });
    return true;
  }

  global.PVStore = {
    KEYS,
    genId,
    getFolders,
    saveFolder,
    deleteFolder,
    getSnippets,
    getSnippet,
    saveSnippet,
    deleteSnippet,
    countSnippets,
    search,
    extractVariables,
    fillVariables,
    getSettings,
    saveSettings,
    exportData,
    exportJson,
    importData,
    seedIfEmpty,
  };
})(typeof self !== "undefined" ? self : this);
