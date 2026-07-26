/**
 * PromptVault options/manage page logic. Plain script, depends on
 * PVStore / PVLimits / PVPro globals loaded via <script> tags before
 * this file in options.html.
 */
(function () {
  "use strict";

  const store = window.PVStore;
  const limits = window.PVLimits;
  const pro = window.PVPro;

  const ALL = "__all__";
  const UNSORTED = "__unsorted__";

  const els = {
    tabBtns: Array.from(document.querySelectorAll(".tab-btn")),
    tabPanels: {
      snippets: document.getElementById("tab-snippets"),
      data: document.getElementById("tab-data"),
      settings: document.getElementById("tab-settings"),
      pro: document.getElementById("tab-pro"),
    },

    folderList: document.getElementById("folder-list"),
    btnNewFolder: document.getElementById("btn-new-folder"),

    searchInput: document.getElementById("search-input"),
    btnNewSnippet: document.getElementById("btn-new-snippet"),
    usageBanner: document.getElementById("usage-banner"),
    snippetTbody: document.getElementById("snippet-tbody"),
    snippetEmpty: document.getElementById("snippet-empty"),

    dataLocked: document.getElementById("data-locked"),
    dataUnlocked: document.getElementById("data-unlocked"),
    btnDataUpgrade: document.getElementById("btn-data-upgrade"),
    btnExport: document.getElementById("btn-export"),
    importFile: document.getElementById("import-file"),
    btnImport: document.getElementById("btn-import"),

    themeSelect: document.getElementById("theme-select"),
    btnOpenShortcuts: document.getElementById("btn-open-shortcuts"),
    btnReset: document.getElementById("btn-reset"),

    proStatusCard: document.getElementById("pro-status-card"),
    btnUpgradeMain: document.getElementById("btn-upgrade-main"),
    devProToggle: document.getElementById("dev-pro-toggle"),

    editDialog: document.getElementById("edit-dialog"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogClose: document.getElementById("dialog-close"),
    form: document.getElementById("snippet-form"),
    fTitle: document.getElementById("f-title"),
    fFolder: document.getElementById("f-folder"),
    fTags: document.getElementById("f-tags"),
    fBody: document.getElementById("f-body"),
    varHint: document.getElementById("var-hint"),
    fTrigger: document.getElementById("f-trigger"),
    triggerHint: document.getElementById("trigger-hint"),
    triggerProBadge: document.getElementById("trigger-pro-badge"),
    btnDelete: document.getElementById("btn-delete"),
    btnCancel: document.getElementById("btn-cancel"),

    limitDialog: document.getElementById("limit-dialog"),
    limitMax: document.getElementById("limit-max"),
    btnLimitClose: document.getElementById("btn-limit-close"),
    btnLimitUpgrade: document.getElementById("btn-limit-upgrade"),

    toast: document.getElementById("toast"),
  };

  let selectedFolder = ALL;
  let currentEditId = null;
  let isProCached = false;
  let toastTimer = null;

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------

  function selectTab(name) {
    els.tabBtns.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    Object.entries(els.tabPanels).forEach(([key, panel]) => {
      panel.classList.toggle("hidden", key !== name);
    });
    if (name === "data") refreshDataTab();
    if (name === "pro") refreshProTab();
  }

  els.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => selectTab(btn.dataset.tab));
  });

  // ---------------------------------------------------------------------
  // Folders sidebar
  // ---------------------------------------------------------------------

  async function renderFolders() {
    const [folders, snippets] = await Promise.all([store.getFolders(), store.getSnippets()]);
    els.folderList.innerHTML = "";

    const countFor = (id) =>
      id === ALL
        ? snippets.length
        : id === UNSORTED
        ? snippets.filter((s) => !s.folderId).length
        : snippets.filter((s) => s.folderId === id).length;

    const allItem = makeFolderItem(ALL, "All snippets", countFor(ALL), false);
    els.folderList.appendChild(allItem);

    folders
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((f) => {
        els.folderList.appendChild(makeFolderItem(f.id, f.name, countFor(f.id), true, f));
      });

    els.folderList.appendChild(makeFolderItem(UNSORTED, "Unsorted", countFor(UNSORTED), false));
  }

  function makeFolderItem(id, name, count, editable, folderObj) {
    const li = document.createElement("li");
    li.className = "folder-item" + (selectedFolder === id ? " active" : "");

    const label = document.createElement("span");
    label.className = "folder-item-name";
    label.textContent = name;
    li.appendChild(label);

    const countEl = document.createElement("span");
    countEl.className = "folder-item-count";
    countEl.textContent = String(count);
    li.appendChild(countEl);

    if (editable) {
      const actions = document.createElement("span");
      actions.className = "folder-item-actions";
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.textContent = "✎";
      renameBtn.title = "Rename folder";
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        renameFolder(folderObj);
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.textContent = "🗑";
      deleteBtn.title = "Delete folder";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFolder(folderObj);
      });
      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);
      li.appendChild(actions);
    }

    li.addEventListener("click", () => {
      selectedFolder = id;
      renderFolders();
      renderSnippets();
    });
    return li;
  }

  els.btnNewFolder.addEventListener("click", async () => {
    const name = prompt("New folder name:");
    if (!name || !name.trim()) return;
    await store.saveFolder({ name: name.trim() });
    await renderFolders();
    showToast("Folder created");
  });

  async function renameFolder(folder) {
    const name = prompt("Rename folder:", folder.name);
    if (!name || !name.trim() || name.trim() === folder.name) return;
    await store.saveFolder({ id: folder.id, name: name.trim() });
    await renderFolders();
    showToast("Folder renamed");
  }

  async function removeFolder(folder) {
    const ok = confirm(
      `Delete folder "${folder.name}"? Snippets inside will be moved to Unsorted (not deleted).`
    );
    if (!ok) return;
    await store.deleteFolder(folder.id, { deleteSnippets: false });
    if (selectedFolder === folder.id) selectedFolder = ALL;
    await renderFolders();
    await renderSnippets();
    showToast("Folder deleted");
  }

  // ---------------------------------------------------------------------
  // Snippet table
  // ---------------------------------------------------------------------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  async function renderSnippets() {
    const query = els.searchInput.value.trim();
    const [allSnippets, folders, limitStatus] = await Promise.all([
      store.search(query),
      store.getFolders(),
      limits.getSnippetLimitStatus(),
    ]);
    isProCached = limitStatus.pro;
    const folderMap = new Map(folders.map((f) => [f.id, f.name]));

    els.usageBanner.textContent = isProCached
      ? "Pro plan — unlimited snippets."
      : `${limitStatus.count} / ${limitStatus.limit} snippets used on the free plan.`;
    els.usageBanner.classList.toggle("warn", !isProCached && limitStatus.reached);

    let snippets = allSnippets;
    if (selectedFolder === UNSORTED) {
      snippets = snippets.filter((s) => !s.folderId);
    } else if (selectedFolder !== ALL) {
      snippets = snippets.filter((s) => s.folderId === selectedFolder);
    }
    snippets = snippets.slice().sort((a, b) => a.title.localeCompare(b.title));

    els.snippetTbody.innerHTML = "";
    els.snippetEmpty.classList.toggle("hidden", snippets.length > 0);

    snippets.forEach((s) => {
      const tr = document.createElement("tr");

      const tdTitle = document.createElement("td");
      const titleDiv = document.createElement("div");
      titleDiv.className = "cell-title";
      titleDiv.textContent = s.title;
      const previewDiv = document.createElement("div");
      previewDiv.className = "cell-preview";
      previewDiv.textContent = s.body.replace(/\s+/g, " ").slice(0, 100);
      tdTitle.appendChild(titleDiv);
      tdTitle.appendChild(previewDiv);

      const tdFolder = document.createElement("td");
      tdFolder.textContent = folderMap.get(s.folderId) || "Unsorted";

      const tdTags = document.createElement("td");
      (s.tags || []).forEach((t) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = t;
        tdTags.appendChild(chip);
      });

      const tdTrigger = document.createElement("td");
      if (s.trigger) {
        const chip = document.createElement("span");
        chip.className = "chip chip-trigger";
        chip.textContent = s.trigger;
        tdTrigger.appendChild(chip);
      }

      const tdUpdated = document.createElement("td");
      tdUpdated.textContent = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "";

      const tdActions = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "row-actions";
      const editBtn = document.createElement("button");
      editBtn.className = "row-btn";
      editBtn.type = "button";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openEdit(s.id));
      const delBtn = document.createElement("button");
      delBtn.className = "row-btn";
      delBtn.type = "button";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => removeSnippet(s.id));
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      tdActions.appendChild(actions);

      tr.appendChild(tdTitle);
      tr.appendChild(tdFolder);
      tr.appendChild(tdTags);
      tr.appendChild(tdTrigger);
      tr.appendChild(tdUpdated);
      tr.appendChild(tdActions);
      els.snippetTbody.appendChild(tr);
    });
  }

  async function removeSnippet(id) {
    if (!confirm("Delete this snippet? This can't be undone.")) return;
    await store.deleteSnippet(id);
    await renderFolders();
    await renderSnippets();
  }

  let searchDebounce = null;
  els.searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderSnippets, 100);
  });

  // ---------------------------------------------------------------------
  // Snippet edit dialog
  // ---------------------------------------------------------------------

  async function populateFolderSelect(selectedFolderId) {
    const folders = await store.getFolders();
    els.fFolder.innerHTML = "";
    const unsorted = document.createElement("option");
    unsorted.value = "";
    unsorted.textContent = "Unsorted";
    els.fFolder.appendChild(unsorted);
    folders.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      els.fFolder.appendChild(opt);
    });
    const newOpt = document.createElement("option");
    newOpt.value = "__new__";
    newOpt.textContent = "+ New folder…";
    els.fFolder.appendChild(newOpt);
    els.fFolder.value = selectedFolderId || "";
  }

  els.fFolder.addEventListener("change", async () => {
    if (els.fFolder.value !== "__new__") return;
    const name = prompt("New folder name:");
    if (!name || !name.trim()) {
      els.fFolder.value = "";
      return;
    }
    const folder = await store.saveFolder({ name: name.trim() });
    await populateFolderSelect(folder.id);
    await renderFolders();
  });

  function updateVarHint() {
    const hasVars = store.extractVariables(els.fBody.value).length > 0;
    els.varHint.classList.toggle("hidden", !(hasVars && !isProCached));
  }
  els.fBody.addEventListener("input", updateVarHint);

  async function refreshGatingUi() {
    const isPro = await pro.isPro();
    els.triggerProBadge.classList.toggle("hidden", isPro);
    els.triggerHint.classList.toggle("hidden", isPro);
    els.fTrigger.disabled = !isPro;
    updateVarHint();
  }

  function openDialog(dialogEl) {
    dialogEl.classList.remove("hidden");
  }
  function closeDialog(dialogEl) {
    dialogEl.classList.add("hidden");
  }

  async function openAdd() {
    const canAdd = await limits.canAddSnippet();
    if (!canAdd) {
      const status = await limits.getSnippetLimitStatus();
      els.limitMax.textContent = String(status.limit);
      openDialog(els.limitDialog);
      return;
    }
    currentEditId = null;
    els.dialogTitle.textContent = "New snippet";
    els.form.reset();
    els.btnDelete.classList.add("hidden");
    const defaultFolder = selectedFolder !== ALL && selectedFolder !== UNSORTED ? selectedFolder : null;
    await populateFolderSelect(defaultFolder);
    await refreshGatingUi();
    openDialog(els.editDialog);
    setTimeout(() => els.fTitle.focus(), 0);
  }

  async function openEdit(id) {
    const snippet = await store.getSnippet(id);
    if (!snippet) return;
    currentEditId = id;
    els.dialogTitle.textContent = "Edit snippet";
    els.fTitle.value = snippet.title;
    els.fBody.value = snippet.body;
    els.fTags.value = (snippet.tags || []).join(", ");
    els.fTrigger.value = snippet.trigger || "";
    els.btnDelete.classList.remove("hidden");
    await populateFolderSelect(snippet.folderId);
    await refreshGatingUi();
    openDialog(els.editDialog);
    setTimeout(() => els.fTitle.focus(), 0);
  }

  els.btnNewSnippet.addEventListener("click", openAdd);
  els.dialogClose.addEventListener("click", () => closeDialog(els.editDialog));
  els.btnCancel.addEventListener("click", () => closeDialog(els.editDialog));
  els.editDialog.addEventListener("mousedown", (e) => {
    if (e.target === els.editDialog) closeDialog(els.editDialog);
  });

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = els.fTitle.value.trim();
    const body = els.fBody.value.trim();
    if (!title || !body) return;

    const folderValue = els.fFolder.value;
    const folderId = folderValue && folderValue !== "__new__" ? folderValue : null;
    const tags = els.fTags.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const isPro = await pro.isPro();
    const trigger = isPro ? els.fTrigger.value.trim() || null : null;

    const snippet = { id: currentEditId, folderId, title, body, tags, trigger };

    if (!currentEditId) {
      const canAdd = await limits.canAddSnippet();
      if (!canAdd) {
        const status = await limits.getSnippetLimitStatus();
        els.limitMax.textContent = String(status.limit);
        closeDialog(els.editDialog);
        openDialog(els.limitDialog);
        return;
      }
      delete snippet.id;
    }

    await store.saveSnippet(snippet);
    closeDialog(els.editDialog);
    await renderFolders();
    await renderSnippets();
    showToast("Saved");
  });

  els.btnDelete.addEventListener("click", async () => {
    if (!currentEditId) return;
    if (!confirm("Delete this snippet? This can't be undone.")) return;
    await store.deleteSnippet(currentEditId);
    closeDialog(els.editDialog);
    await renderFolders();
    await renderSnippets();
  });

  els.btnLimitClose.addEventListener("click", () => closeDialog(els.limitDialog));
  els.btnLimitUpgrade.addEventListener("click", () => {
    closeDialog(els.limitDialog);
    selectTab("pro");
  });

  // ---------------------------------------------------------------------
  // Import & Export tab
  // ---------------------------------------------------------------------

  async function refreshDataTab() {
    const isPro = await pro.isPro();
    els.dataLocked.classList.toggle("hidden", isPro);
    els.dataUnlocked.classList.toggle("hidden", !isPro);
  }

  els.btnDataUpgrade.addEventListener("click", () => selectTab("pro"));

  els.btnExport.addEventListener("click", async () => {
    const allowed = await limits.canUseFeature(limits.FEATURES.IMPORT_EXPORT);
    if (!allowed) {
      selectTab("pro");
      return;
    }
    const json = await store.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `promptvault-export-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast("Exported");
  });

  els.importFile.addEventListener("change", () => {
    els.btnImport.disabled = !els.importFile.files || !els.importFile.files.length;
  });

  els.btnImport.addEventListener("click", async () => {
    const allowed = await limits.canUseFeature(limits.FEATURES.IMPORT_EXPORT);
    if (!allowed) {
      selectTab("pro");
      return;
    }
    const file = els.importFile.files && els.importFile.files[0];
    if (!file) return;
    const mode = document.querySelector('input[name="import-mode"]:checked').value;
    if (mode === "replace" && !confirm("This replaces ALL existing folders and snippets. Continue?")) {
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await store.importData(data, { mode });
      showToast(`Imported ${result.snippetsAdded} snippets, ${result.foldersAdded} folders`);
      els.importFile.value = "";
      els.btnImport.disabled = true;
      await renderFolders();
      await renderSnippets();
    } catch (err) {
      showToast("Import failed: " + (err && err.message ? err.message : "invalid file"));
    }
  });

  // ---------------------------------------------------------------------
  // Settings tab
  // ---------------------------------------------------------------------

  async function initSettings() {
    const settings = await store.getSettings();
    els.themeSelect.value = settings.theme || "system";
  }

  els.themeSelect.addEventListener("change", async () => {
    await store.saveSettings({ theme: els.themeSelect.value });
    showToast("Theme preference saved");
  });

  els.btnOpenShortcuts.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  els.btnReset.addEventListener("click", async () => {
    if (!confirm("Delete ALL folders and snippets? This cannot be undone.")) return;
    await Promise.all([
      store.saveSettings({}), // no-op, keeps settings key untouched
    ]);
    await chrome.storage.local.set({ pv_folders: [], pv_snippets: [] });
    selectedFolder = ALL;
    await renderFolders();
    await renderSnippets();
    showToast("All data cleared");
  });

  // ---------------------------------------------------------------------
  // Pro tab
  // ---------------------------------------------------------------------

  async function refreshProTab() {
    const isPro = await pro.isPro();
    els.proStatusCard.textContent = isPro
      ? "You're on PromptVault Pro. Thank you for supporting the project!"
      : "You're on the free plan. Upgrade any time to unlock everything below.";
    els.btnUpgradeMain.classList.toggle("hidden", isPro);
    els.devProToggle.checked = isPro;
  }

  els.btnUpgradeMain.addEventListener("click", () => {
    // TODO(payments): replace with extpay.openPaymentPage() once
    // ExtensionPay is wired up (see js/pro.js). For now this section
    // *is* the upgrade destination, so just surface the dev toggle.
    showToast("Payments aren't wired up yet — use the developer toggle below to test Pro features.");
  });

  els.devProToggle.addEventListener("change", async () => {
    await pro.setProDev(els.devProToggle.checked);
    showToast(els.devProToggle.checked ? "Pro enabled (dev/testing)" : "Pro disabled");
    await refreshProTab();
    await renderSnippets();
    await refreshDataTab();
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  (async function init() {
    try {
      await store.seedIfEmpty();
    } catch (e) {
      console.error("[PromptVault] seed failed", e);
    }
    await renderFolders();
    await renderSnippets();
    await initSettings();

    const hash = (location.hash || "").replace("#", "");
    if (hash && els.tabPanels[hash]) {
      selectTab(hash);
    } else {
      selectTab("snippets");
    }
  })();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.pv_snippets || changes.pv_folders) {
      renderFolders();
      renderSnippets();
    }
    if (changes.pv_pro) {
      refreshProTab();
      refreshDataTab();
      renderSnippets();
    }
  });
})();
