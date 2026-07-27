/**
 * PromptVault on-demand page UI.
 *
 * This file is NOT a persistent content script — it isn't listed in
 * manifest.json at all. It only ever runs because background.js
 * programmatically injected it via chrome.scripting.executeScript, in
 * direct response to a user action against the extension itself (the
 * "open-quick-search" keyboard command, or a snippet click in the
 * popup). Each of those actions grants the extension temporary
 * activeTab access to the current tab, which is what makes the
 * injection possible — PromptVault never runs on a page the user
 * hasn't just explicitly invoked it on, and never requests
 * host_permissions or a `<all_urls>` content script.
 *
 * Responsibilities, once injected:
 * - Tracks the last-focused editable field (input / textarea / contenteditable).
 * - Renders a shadow-DOM quick-search overlay (opened on request) for
 *   picking a snippet and inserting it at the cursor. Typing a
 *   snippet's "trigger" string in the overlay's search box filters
 *   straight to it (see js/store.js `search`) — there is no always-on,
 *   type-anywhere expansion; that would require a persistent
 *   all-sites content script, which this extension deliberately does
 *   not ship.
 * - Performs robust text insertion into <input>, <textarea>, and
 *   contenteditable elements, including React/Vue-controlled fields.
 *
 * Runs only in the top-level frame it was injected into (executeScript
 * defaults to the main frame), which covers the compose boxes on every
 * major AI chat product, Gmail, and GitHub. Text fields inside
 * cross-origin iframes are a known limitation (documented in README.md).
 */
(function () {
  "use strict";

  if (window.top !== window) return; // top frame only, see header comment
  if (window.__promptVaultContentLoaded) return; // avoid double-injection
  window.__promptVaultContentLoaded = true;

  const store = self.PVStore;
  const pro = self.PVPro;

  // ---------------------------------------------------------------------
  // Editable-field helpers
  // ---------------------------------------------------------------------

  const TEXT_INPUT_TYPES = new Set([
    "text", "search", "email", "url", "tel", "password", "number", "",
  ]);

  function isStandardField(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return TEXT_INPUT_TYPES.has(type) && !el.disabled && !el.readOnly;
    }
    return false;
  }

  function isContentEditableField(el) {
    return !!el && el.nodeType === 1 && el.isContentEditable === true;
  }

  function isEditableElement(el) {
    return isStandardField(el) || isContentEditableField(el);
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function fireInputEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function insertIntoStandardField(el, text, start, end) {
    el.focus();
    const s = start != null ? start : el.selectionStart != null ? el.selectionStart : el.value.length;
    const e = end != null ? end : el.selectionEnd != null ? el.selectionEnd : el.value.length;
    const before = el.value.slice(0, s);
    const after = el.value.slice(e);
    setNativeValue(el, before + text + after);
    const pos = s + text.length;
    try {
      el.setSelectionRange(pos, pos);
    } catch (err) {
      /* some input types don't support selection ranges */
    }
    fireInputEvents(el);
  }

  function insertIntoContentEditable(el, text, range) {
    el.focus();
    const sel = window.getSelection();
    if (range) {
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    let handled = false;
    try {
      handled = document.execCommand && document.execCommand("insertText", false, text);
    } catch (err) {
      handled = false;
    }
    if (!handled) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      const node = document.createTextNode(text);
      r.insertNode(node);
      r.setStartAfter(node);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** Copies text via a transient offscreen textarea (no clipboardWrite
   *  permission required, works from a user-gesture event chain). */
  function copyToClipboard(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.left = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) return true;
    } catch (err) {
      /* fall through */
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Focus tracking
  // ---------------------------------------------------------------------

  const state = {
    lastEditable: null, // last focused editable element (persists after blur)
    lastRange: null, // last selection Range within a contenteditable target
    overlayOpen: false,
  };

  function withinUi(node) {
    return !!(uiHost && node && uiHost.contains(node));
  }

  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (withinUi(el)) return;
      if (isEditableElement(el)) {
        state.lastEditable = el;
        state.lastRange = null;
      }
    },
    true
  );

  document.addEventListener("selectionchange", () => {
    const active = document.activeElement;
    if (!active || active !== state.lastEditable) return;
    if (!isContentEditableField(active)) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && active.contains(sel.anchorNode)) {
      state.lastRange = sel.getRangeAt(0).cloneRange();
    }
  });

  // ---------------------------------------------------------------------
  // Shadow-DOM UI host (overlay + variable modal + toast)
  //
  // Note: there is no typed-trigger auto-expansion here. That would
  // require watching every keystroke on every page via a persistent,
  // all-sites content script — exactly what this extension gives up to
  // avoid the broad host-permission warning. A snippet's "trigger"
  // string still matters: it's indexed by js/store.js's search(), so
  // typing it into the quick-search box below (e.g. ";fix") instantly
  // filters down to that snippet.
  // ---------------------------------------------------------------------

  let uiHost = null;
  let shadow = null;

  function ensureUiHost() {
    if (uiHost) return shadow;
    uiHost = document.createElement("div");
    uiHost.id = "promptvault-ui-host";
    uiHost.style.all = "initial";
    document.documentElement.appendChild(uiHost);
    shadow = uiHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = UI_STYLES;
    shadow.appendChild(style);
    return shadow;
  }

  const UI_STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .pv-backdrop {
      position: fixed; inset: 0; z-index: 2147483000;
      background: rgba(15, 15, 25, 0.35);
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 12vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .pv-panel {
      width: min(560px, 92vw);
      max-height: 60vh;
      background: #ffffff;
      color: #1a1a2e;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06);
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    @media (prefers-color-scheme: dark) {
      .pv-panel { background: #1e1e2d; color: #eceef5; box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08); }
      .pv-input { color: #eceef5 !important; }
      .pv-item:hover, .pv-item.pv-active { background: #2a2a40 !important; }
      .pv-folder-label { color: #9d9dc0 !important; }
      .pv-footer { border-top-color: #333350 !important; color: #8c8cb0 !important; }
      .pv-search-wrap { border-bottom-color: #333350 !important; }
      .pv-empty { color: #8c8cb0 !important; }
      .pv-modal-field input, .pv-modal-field textarea { background: #14141f !important; color: #eceef5 !important; border-color: #333350 !important; }
      .pv-btn.pv-secondary { background: #2a2a40 !important; color: #eceef5 !important; }
      .pv-toast { background: #1e1e2d !important; color: #eceef5 !important; }
    }
    .pv-search-wrap {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; border-bottom: 1px solid #e6e6ef;
    }
    .pv-search-icon { width: 18px; height: 18px; flex: 0 0 auto; opacity: 0.6; }
    .pv-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 15px; color: #1a1a2e;
    }
    .pv-list { overflow-y: auto; padding: 6px; }
    .pv-folder-label {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
      color: #7a7a9a; padding: 8px 10px 4px;
      font-weight: 600;
    }
    .pv-item {
      display: flex; flex-direction: column; gap: 2px;
      padding: 8px 10px; border-radius: 8px; cursor: pointer;
    }
    .pv-item:hover, .pv-item.pv-active { background: #f0f0fa; }
    .pv-item-title { font-size: 14px; font-weight: 600; }
    .pv-item-body { font-size: 12px; opacity: 0.65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pv-item-meta { font-size: 11px; opacity: 0.5; margin-top: 2px; }
    .pv-empty { padding: 24px 14px; text-align: center; color: #7a7a9a; font-size: 13px; }
    .pv-footer {
      display: flex; gap: 14px; padding: 8px 14px; border-top: 1px solid #e6e6ef;
      font-size: 11px; color: #7a7a9a;
    }
    .pv-kbd {
      display: inline-block; padding: 1px 5px; border-radius: 4px;
      background: rgba(120,120,150,0.15); font-family: monospace; margin-right: 3px;
    }
    .pv-modal-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .pv-modal-title { font-size: 15px; font-weight: 700; }
    .pv-modal-hint { font-size: 12.5px; opacity: 0.75; line-height: 1.4; }
    .pv-modal-field { display: flex; flex-direction: column; gap: 4px; }
    .pv-modal-field label { font-size: 12px; font-weight: 600; opacity: 0.8; }
    .pv-modal-field input, .pv-modal-field textarea {
      font-family: inherit; font-size: 13.5px; padding: 7px 9px;
      border: 1px solid #d8d8e6; border-radius: 7px; outline: none; background: #fafafe;
    }
    .pv-modal-field input:focus, .pv-modal-field textarea:focus { border-color: #6366f1; }
    .pv-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    .pv-btn {
      font-family: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px;
      border-radius: 8px; border: none; cursor: pointer;
    }
    .pv-btn.pv-primary { background: #6366f1; color: #fff; }
    .pv-btn.pv-primary:hover { background: #5254d6; }
    .pv-btn.pv-secondary { background: #f0f0fa; color: #33334d; }
    .pv-btn.pv-secondary:hover { background: #e2e2f2; }
    .pv-upgrade-badge {
      display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
      background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
      padding: 2px 6px; border-radius: 5px; margin-left: 6px; vertical-align: middle;
    }
    .pv-toast {
      position: fixed; z-index: 2147483000; left: 50%; bottom: 32px; transform: translateX(-50%);
      background: #1a1a2e; color: #fff; padding: 10px 16px; border-radius: 9px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      opacity: 0; transition: opacity 0.15s ease;
    }
    .pv-toast.pv-show { opacity: 1; }
  `;

  // ---------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------

  let toastTimer = null;
  function showToast(message) {
    const root = ensureUiHost();
    let toast = root.querySelector(".pv-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "pv-toast";
      root.appendChild(toast);
    }
    toast.textContent = message;
    requestAnimationFrame(() => toast.classList.add("pv-show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("pv-show"), 2200);
  }

  // ---------------------------------------------------------------------
  // Variable-fill modal (used when inserting a snippet from quick-search)
  // ---------------------------------------------------------------------

  function openVariableModal(snippet, { onSubmit, onCancel }) {
    const root = ensureUiHost();
    const backdrop = document.createElement("div");
    backdrop.className = "pv-backdrop";

    const panel = document.createElement("div");
    panel.className = "pv-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    const body = document.createElement("div");
    body.className = "pv-modal-body";

    const title = document.createElement("div");
    title.className = "pv-modal-title";
    title.textContent = `Fill in: ${snippet.title}`;
    body.appendChild(title);

    const vars = store.extractVariables(snippet.body);
    const inputs = {};
    vars.forEach((name) => {
      const field = document.createElement("div");
      field.className = "pv-modal-field";
      const label = document.createElement("label");
      label.textContent = name;
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = `Value for ${name}`;
      field.appendChild(label);
      field.appendChild(input);
      body.appendChild(field);
      inputs[name] = input;
    });

    const actions = document.createElement("div");
    actions.className = "pv-modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pv-btn pv-secondary";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    const submitBtn = document.createElement("button");
    submitBtn.className = "pv-btn pv-primary";
    submitBtn.type = "button";
    submitBtn.textContent = "Insert";
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    body.appendChild(actions);

    panel.appendChild(body);
    backdrop.appendChild(panel);
    root.appendChild(backdrop);

    const firstInput = vars.length ? inputs[vars[0]] : submitBtn;
    setTimeout(() => firstInput && firstInput.focus(), 0);

    function close() {
      backdrop.remove();
      document.removeEventListener("keydown", onKeydown, true);
    }
    function submit() {
      const values = {};
      vars.forEach((name) => (values[name] = inputs[name].value));
      const filled = store.fillVariables(snippet.body, values);
      close();
      onSubmit && onSubmit(filled);
    }
    function cancel() {
      close();
      onCancel && onCancel();
    }
    function onKeydown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "Enter" && (e.target.tagName === "INPUT")) {
        e.preventDefault();
        submit();
      }
    }
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) cancel();
    });
    cancelBtn.addEventListener("click", cancel);
    submitBtn.addEventListener("click", submit);
    document.addEventListener("keydown", onKeydown, true);
  }

  function openUpgradeHintModal(snippet, rawText) {
    const root = ensureUiHost();
    const backdrop = document.createElement("div");
    backdrop.className = "pv-backdrop";
    const panel = document.createElement("div");
    panel.className = "pv-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const body = document.createElement("div");
    body.className = "pv-modal-body";

    const title = document.createElement("div");
    title.className = "pv-modal-title";
    title.textContent = "Template variables are a Pro feature";
    body.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "pv-modal-hint";
    hint.textContent =
      `"${snippet.title}" contains {{variables}}. Upgrade to Pro to fill them in with a quick form, ` +
      "or insert the snippet as-is with the placeholders left in place.";
    body.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "pv-modal-actions";
    const insertBtn = document.createElement("button");
    insertBtn.className = "pv-btn pv-secondary";
    insertBtn.type = "button";
    insertBtn.textContent = "Insert as-is";
    const upgradeBtn = document.createElement("button");
    upgradeBtn.className = "pv-btn pv-primary";
    upgradeBtn.type = "button";
    upgradeBtn.textContent = "Upgrade to Pro";
    actions.appendChild(insertBtn);
    actions.appendChild(upgradeBtn);
    body.appendChild(actions);

    panel.appendChild(body);
    backdrop.appendChild(panel);
    root.appendChild(backdrop);

    function close() {
      backdrop.remove();
    }
    insertBtn.addEventListener("click", () => {
      close();
      insertResolvedText(rawText, snippet.title);
    });
    upgradeBtn.addEventListener("click", () => {
      close();
      chrome.runtime.sendMessage({ type: "PV_OPEN_OPTIONS", section: "pro" });
    });
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
  }

  // ---------------------------------------------------------------------
  // Insertion into the last-known editable target (with clipboard fallback)
  // ---------------------------------------------------------------------

  function insertResolvedText(text, label) {
    const el = state.lastEditable;
    if (el && document.contains(el) && isStandardField(el)) {
      insertIntoStandardField(el, text);
      showToast(`Inserted "${label}"`);
      return;
    }
    if (el && document.contains(el) && isContentEditableField(el)) {
      insertIntoContentEditable(el, text, state.lastRange);
      showToast(`Inserted "${label}"`);
      return;
    }
    const copied = copyToClipboard(text);
    showToast(
      copied
        ? "No active text field found — copied to clipboard instead"
        : "No active text field found and clipboard copy failed"
    );
  }

  async function insertSnippet(snippet) {
    const vars = store.extractVariables(snippet.body);
    if (!vars.length) {
      insertResolvedText(snippet.body, snippet.title);
      return;
    }
    const isPro = await pro.isPro();
    if (!isPro) {
      openUpgradeHintModal(snippet, snippet.body);
      return;
    }
    openVariableModal(snippet, {
      onSubmit: (filled) => insertResolvedText(filled, snippet.title),
    });
  }

  // ---------------------------------------------------------------------
  // Quick-search overlay
  // ---------------------------------------------------------------------

  let overlayEls = null;

  function closeOverlay() {
    if (!overlayEls) return;
    overlayEls.backdrop.remove();
    document.removeEventListener("keydown", overlayEls.onKeydown, true);
    overlayEls = null;
    state.overlayOpen = false;
  }

  async function openOverlay() {
    if (state.overlayOpen) {
      closeOverlay();
      return;
    }
    const root = ensureUiHost();
    state.overlayOpen = true;

    const backdrop = document.createElement("div");
    backdrop.className = "pv-backdrop";
    const panel = document.createElement("div");
    panel.className = "pv-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "PromptVault quick search");

    const searchWrap = document.createElement("div");
    searchWrap.className = "pv-search-wrap";
    const icon = document.createElement("span");
    icon.textContent = "🔎";
    icon.className = "pv-search-icon";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "pv-input";
    input.placeholder = "Search PromptVault snippets…";
    input.setAttribute("aria-label", "Search snippets");
    searchWrap.appendChild(icon);
    searchWrap.appendChild(input);

    const list = document.createElement("div");
    list.className = "pv-list";
    list.setAttribute("role", "listbox");

    const footer = document.createElement("div");
    footer.className = "pv-footer";
    footer.innerHTML =
      '<span><span class="pv-kbd">↑↓</span>Navigate</span>' +
      '<span><span class="pv-kbd">Enter</span>Insert</span>' +
      '<span><span class="pv-kbd">Esc</span>Close</span>';

    panel.appendChild(searchWrap);
    panel.appendChild(list);
    panel.appendChild(footer);
    backdrop.appendChild(panel);
    root.appendChild(backdrop);

    let results = [];
    let activeIndex = 0;

    async function runSearch(query) {
      const [snippets, folders] = await Promise.all([store.search(query), store.getFolders()]);
      const folderMap = new Map(folders.map((f) => [f.id, f.name]));
      results = snippets;
      renderList(snippets, folderMap);
    }

    function renderList(snippets, folderMap) {
      list.innerHTML = "";
      activeIndex = 0;
      if (!snippets.length) {
        const empty = document.createElement("div");
        empty.className = "pv-empty";
        empty.textContent = "No snippets found.";
        list.appendChild(empty);
        return;
      }
      let lastFolder = Symbol();
      const grouped = [...snippets].sort((a, b) => {
        const fa = folderMap.get(a.folderId) || "Unsorted";
        const fb = folderMap.get(b.folderId) || "Unsorted";
        return fa.localeCompare(fb) || a.title.localeCompare(b.title);
      });
      grouped.forEach((snippet, i) => {
        const folderName = folderMap.get(snippet.folderId) || "Unsorted";
        if (folderName !== lastFolder) {
          const label = document.createElement("div");
          label.className = "pv-folder-label";
          label.textContent = folderName;
          list.appendChild(label);
          lastFolder = folderName;
        }
        const item = document.createElement("div");
        item.className = "pv-item";
        item.setAttribute("role", "option");
        item.dataset.index = String(i);
        const t = document.createElement("div");
        t.className = "pv-item-title";
        t.textContent = snippet.title;
        const b = document.createElement("div");
        b.className = "pv-item-body";
        b.textContent = snippet.body.replace(/\s+/g, " ").slice(0, 90);
        item.appendChild(t);
        item.appendChild(b);
        if (snippet.trigger) {
          const meta = document.createElement("div");
          meta.className = "pv-item-meta";
          meta.textContent = snippet.trigger;
          item.appendChild(meta);
        }
        item.addEventListener("mouseenter", () => setActive(i));
        item.addEventListener("click", () => choose(i));
        list.appendChild(item);
      });
      updateActiveHighlight();
    }

    function setActive(i) {
      activeIndex = Math.max(0, Math.min(results.length - 1, i));
      updateActiveHighlight();
    }

    function updateActiveHighlight() {
      const items = list.querySelectorAll(".pv-item");
      items.forEach((el) => el.classList.remove("pv-active"));
      const el = list.querySelector(`.pv-item[data-index="${activeIndex}"]`);
      if (el) {
        el.classList.add("pv-active");
        el.scrollIntoView({ block: "nearest" });
      }
    }

    function choose(i) {
      const snippet = results[i];
      if (!snippet) return;
      closeOverlay();
      insertSnippet(snippet);
    }

    function onKeydown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeOverlay();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(activeIndex + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(activeIndex - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(activeIndex);
      }
    }

    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) closeOverlay();
    });
    input.addEventListener("input", () => runSearch(input.value));
    document.addEventListener("keydown", onKeydown, true);

    overlayEls = { backdrop, input, onKeydown };
    await runSearch("");
    setTimeout(() => input.focus(), 0);
  }

  // ---------------------------------------------------------------------
  // Messages from background (command relay + popup quick-insert)
  // ---------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "PV_OPEN_QUICK_SEARCH") {
      openOverlay();
      sendResponse({ ok: true });
    } else if (message.type === "PV_INSERT_SNIPPET" && message.snippet) {
      insertSnippet(message.snippet).then(() => sendResponse({ ok: true }));
      return true;
    } else if (message.type === "PV_INSERT_TEXT" && typeof message.text === "string") {
      insertResolvedText(message.text, message.label || "snippet");
      sendResponse({ ok: true });
    }
  });
})();
