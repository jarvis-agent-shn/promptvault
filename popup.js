/**
 * PromptVault popup logic. Plain script, depends on PVStore / PVLimits /
 * PVPro globals loaded via <script> tags before this file in popup.html.
 */
(function () {
  "use strict";

  const store = window.PVStore;
  const limits = window.PVLimits;
  const pro = window.PVPro;

  const els = {
    viewList: document.getElementById("view-list"),
    viewEdit: document.getElementById("view-edit"),
    viewLimit: document.getElementById("view-limit"),
    searchInput: document.getElementById("search-input"),
    snippetList: document.getElementById("snippet-list"),
    emptyState: document.getElementById("empty-state"),
    usageText: document.getElementById("usage-text"),
    proBanner: document.getElementById("pro-banner"),

    btnManage: document.getElementById("btn-manage"),
    btnAdd: document.getElementById("btn-add"),
    btnAddEmpty: document.getElementById("btn-add-empty"),
    btnUpgradeBanner: document.getElementById("btn-upgrade-banner"),

    btnBack: document.getElementById("btn-back"),
    editTitle: document.getElementById("edit-title"),
    form: document.getElementById("snippet-form"),
    fTitle: document.getElementById("f-title"),
    fFolder: document.getElementById("f-folder"),
    fBody: document.getElementById("f-body"),
    varHint: document.getElementById("var-hint"),
    fTags: document.getElementById("f-tags"),
    fTrigger: document.getElementById("f-trigger"),
    triggerHint: document.getElementById("trigger-hint"),
    triggerProBadge: document.getElementById("trigger-pro-badge"),
    btnDelete: document.getElementById("btn-delete"),
    btnCancel: document.getElementById("btn-cancel"),
    btnSave: document.getElementById("btn-save"),

    limitMax: document.getElementById("limit-max"),
    btnLimitBack: document.getElementById("btn-limit-back"),
    btnLimitUpgrade: document.getElementById("btn-limit-upgrade"),

    toast: document.getElementById("toast"),
  };

  let currentEditId = null; // null = creating new
  let isProCached = false;
  let toastTimer = null;

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2000);
  }

  function showView(name) {
    els.viewList.classList.toggle("hidden", name !== "list");
    els.viewEdit.classList.toggle("hidden", name !== "edit");
    els.viewLimit.classList.toggle("hidden", name !== "limit");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------------------------------------------------------------------
  // List rendering
  // ---------------------------------------------------------------------

  async function renderList(query) {
    const [snippets, folders, limitStatus] = await Promise.all([
      store.search(query || ""),
      store.getFolders(),
      limits.getSnippetLimitStatus(),
    ]);
    isProCached = limitStatus.pro;

    els.proBanner.classList.toggle("hidden", isProCached);
    els.usageText.textContent = isProCached
      ? "Pro — unlimited snippets"
      : `${limitStatus.count}/${limitStatus.limit} snippets used`;

    const folderMap = new Map(folders.map((f) => [f.id, f.name]));
    const grouped = new Map(); // folderName -> snippets[]
    const sorted = [...snippets].sort((a, b) => a.title.localeCompare(b.title));
    sorted.forEach((s) => {
      const folderName = folderMap.get(s.folderId) || "Unsorted";
      if (!grouped.has(folderName)) grouped.set(folderName, []);
      grouped.get(folderName).push(s);
    });

    els.snippetList.innerHTML = "";
    const folderNames = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));

    if (!snippets.length) {
      els.emptyState.classList.toggle("hidden", !!query);
      els.snippetList.classList.toggle("hidden", !!query);
      if (query) {
        const none = document.createElement("div");
        none.className = "empty-state";
        none.textContent = "No matching snippets.";
        els.snippetList.classList.remove("hidden");
        els.snippetList.appendChild(none);
      }
      return;
    }
    els.emptyState.classList.add("hidden");
    els.snippetList.classList.remove("hidden");

    folderNames.forEach((folderName) => {
      const heading = document.createElement("div");
      heading.className = "folder-heading";
      heading.textContent = folderName;
      els.snippetList.appendChild(heading);

      grouped.get(folderName).forEach((snippet) => {
        els.snippetList.appendChild(renderRow(snippet));
      });
    });
  }

  function renderRow(snippet) {
    const row = document.createElement("div");
    row.className = "snippet-row";

    const main = document.createElement("div");
    main.className = "snippet-main";
    main.setAttribute("role", "button");
    main.tabIndex = 0;

    const title = document.createElement("div");
    title.className = "snippet-title";
    title.textContent = snippet.title;

    const preview = document.createElement("div");
    preview.className = "snippet-preview";
    preview.textContent = snippet.body.replace(/\s+/g, " ").slice(0, 80);

    main.appendChild(title);
    main.appendChild(preview);

    if ((snippet.tags && snippet.tags.length) || snippet.trigger) {
      const tagsWrap = document.createElement("div");
      tagsWrap.className = "snippet-tags";
      (snippet.tags || []).forEach((t) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = t;
        tagsWrap.appendChild(chip);
      });
      if (snippet.trigger) {
        const chip = document.createElement("span");
        chip.className = "chip chip-trigger";
        chip.textContent = snippet.trigger;
        tagsWrap.appendChild(chip);
      }
      main.appendChild(tagsWrap);
    }

    main.addEventListener("click", () => openEdit(snippet.id));
    main.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openEdit(snippet.id);
    });

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const insertBtn = document.createElement("button");
    insertBtn.className = "row-btn row-insert";
    insertBtn.type = "button";
    insertBtn.title = "Insert into active tab";
    insertBtn.setAttribute("aria-label", "Insert into active tab");
    insertBtn.textContent = "↵";
    insertBtn.addEventListener("click", () => quickInsert(snippet));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "row-btn";
    deleteBtn.type = "button";
    deleteBtn.title = "Delete";
    deleteBtn.setAttribute("aria-label", "Delete snippet");
    deleteBtn.textContent = "🗑";
    deleteBtn.addEventListener("click", () => deleteSnippet(snippet.id));

    actions.appendChild(insertBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(main);
    row.appendChild(actions);
    return row;
  }

  async function quickInsert(snippet) {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "PV_QUICK_INSERT_ACTIVE_TAB",
        snippet,
      });
      if (resp && resp.ok) {
        showToast("Inserted");
        setTimeout(() => window.close(), 350);
      } else {
        showToast("Couldn't reach this page. Try clicking into a text field first.");
      }
    } catch (e) {
      showToast("Couldn't reach this page.");
    }
  }

  async function deleteSnippet(id) {
    if (!confirm("Delete this snippet? This can't be undone.")) return;
    await store.deleteSnippet(id);
    await renderList(els.searchInput.value);
  }

  // ---------------------------------------------------------------------
  // Edit / add form
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
  });

  async function refreshGatingUi() {
    const isPro = await pro.isPro();
    els.triggerProBadge.classList.toggle("hidden", isPro);
    els.triggerHint.classList.toggle("hidden", isPro);
    els.fTrigger.disabled = !isPro;
    updateVarHint();
  }

  function updateVarHint() {
    const hasVars = store.extractVariables(els.fBody.value).length > 0;
    els.varHint.classList.toggle("hidden", !(hasVars && !isProCached));
  }

  async function openAdd() {
    const canAdd = await limits.canAddSnippet();
    if (!canAdd) {
      const status = await limits.getSnippetLimitStatus();
      els.limitMax.textContent = String(status.limit);
      showView("limit");
      return;
    }
    currentEditId = null;
    els.editTitle.textContent = "New snippet";
    els.form.reset();
    els.btnDelete.classList.add("hidden");
    await populateFolderSelect(null);
    await refreshGatingUi();
    showView("edit");
    setTimeout(() => els.fTitle.focus(), 0);
  }

  async function openEdit(id) {
    const snippet = await store.getSnippet(id);
    if (!snippet) return;
    currentEditId = id;
    els.editTitle.textContent = "Edit snippet";
    els.fTitle.value = snippet.title;
    els.fBody.value = snippet.body;
    els.fTags.value = (snippet.tags || []).join(", ");
    els.fTrigger.value = snippet.trigger || "";
    els.btnDelete.classList.remove("hidden");
    await populateFolderSelect(snippet.folderId);
    await refreshGatingUi();
    showView("edit");
    setTimeout(() => els.fTitle.focus(), 0);
  }

  els.fBody.addEventListener("input", updateVarHint);

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

    const snippet = {
      id: currentEditId,
      folderId,
      title,
      body,
      tags,
      trigger,
    };

    if (!currentEditId) {
      const canAdd = await limits.canAddSnippet();
      if (!canAdd) {
        const status = await limits.getSnippetLimitStatus();
        els.limitMax.textContent = String(status.limit);
        showView("limit");
        return;
      }
      delete snippet.id;
    }

    await store.saveSnippet(snippet);
    showView("list");
    await renderList(els.searchInput.value);
    showToast("Saved");
  });

  els.btnDelete.addEventListener("click", async () => {
    if (!currentEditId) return;
    if (!confirm("Delete this snippet? This can't be undone.")) return;
    await store.deleteSnippet(currentEditId);
    showView("list");
    await renderList(els.searchInput.value);
  });

  els.btnCancel.addEventListener("click", () => showView("list"));
  els.btnBack.addEventListener("click", () => showView("list"));

  // ---------------------------------------------------------------------
  // Top-level wiring
  // ---------------------------------------------------------------------

  els.btnAdd.addEventListener("click", openAdd);
  els.btnAddEmpty.addEventListener("click", openAdd);

  els.btnManage.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  function openUpgrade() {
    pro.openUpgradePage();
  }
  els.btnUpgradeBanner.addEventListener("click", openUpgrade);
  els.btnLimitUpgrade.addEventListener("click", openUpgrade);
  els.btnLimitBack.addEventListener("click", () => showView("list"));

  let searchDebounce = null;
  els.searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => renderList(els.searchInput.value), 80);
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
    await renderList("");
    setTimeout(() => els.searchInput.focus(), 0);
  })();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.pv_snippets || changes.pv_folders || changes.pv_pro)) {
      renderList(els.searchInput.value);
    }
  });
})();
