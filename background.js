/**
 * PromptVault background service worker.
 *
 * PromptVault ships NO persistent content script and requests NO
 * host_permissions — the manifest only asks for "storage", "activeTab",
 * and "scripting". Every bit of on-page UI (the quick-search overlay,
 * the insertion logic) is injected into the active tab on demand, via
 * chrome.scripting.executeScript, and only in direct response to a user
 * action against the extension itself. Those actions are the two entry
 * points below:
 *
 *  1. The "open-quick-search" keyboard command (chrome.commands),
 *     handled here, which injects the overlay UI into the active tab
 *     and asks it to open.
 *  2. A snippet click in the popup ("Insert into active tab"), relayed
 *     here via the PV_QUICK_INSERT_ACTIVE_TAB message, which injects
 *     the same UI (idempotently) and asks it to insert one snippet.
 *
 * Both of those user gestures grant the extension temporary activeTab
 * access to the current tab, which is what chrome.scripting.executeScript
 * relies on — there's no standing access to any page at any other time.
 *
 * Other responsibilities:
 *  - Seed example data on first install.
 *  - Answer a couple of small message requests from popup/injected UI
 *    that need extension-level APIs (opening the options page, etc).
 *  - Keep the action badge in sync with free-tier snippet usage.
 */
importScripts("js/store.js", "js/limits.js", "js/pro.js");

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await self.PVStore.seedIfEmpty();
  } catch (e) {
    console.error("[PromptVault] seed failed", e);
  }
  if (details.reason === "install") {
    updateBadge();
  }
});

// Entry point #1: keyboard command. Firing this command is itself the
// user gesture that grants activeTab, so we can inject on demand here.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-quick-search") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    await injectAndMessage(tab.id, { type: "PV_OPEN_QUICK_SEARCH" });
  } catch (e) {
    console.error("[PromptVault] command relay failed", e);
  }
});

/**
 * Ensures the on-demand overlay/insertion UI is present in a tab, then
 * sends it a message. This is the ONLY place PromptVault ever touches a
 * page's content — it only runs from the two user-gesture entry points
 * above (command) and below (popup quick-insert), both of which carry
 * activeTab access for the current tab.
 *
 * Since there is no persistent content script, the happy path is
 * "inject, then message" on first use per tab per session. If the UI
 * script was already injected earlier in this tab/session (e.g. a
 * previous quick-search in the same tab), it's still listening, so we
 * try messaging first and only (re-)inject on failure — this also
 * naturally no-ops the injected script's own idempotency guard instead
 * of doing redundant work.
 */
async function injectAndMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["js/store.js", "js/pro.js", "content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"],
      });
      await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) {
      // Restricted page (chrome://, Web Store, etc.), or the user
      // invoked us without a live activeTab grant — nothing we can do.
      console.warn("[PromptVault] could not reach tab", tabId, e2 && e2.message);
    }
  }
}

// Keep the toolbar badge showing remaining free snippets (subtle nudge,
// not nagware). Cleared entirely once Pro is active.
async function updateBadge() {
  try {
    const status = await self.PVLimits.getSnippetLimitStatus();
    if (status.pro) {
      chrome.action.setBadgeText({ text: "" });
      return;
    }
    const remaining = Math.max(0, status.limit - status.count);
    if (remaining <= 5) {
      chrome.action.setBadgeText({ text: String(remaining) });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  } catch (e) {
    // non-fatal
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.pv_snippets || changes.pv_pro) {
    updateBadge();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "PV_OPEN_OPTIONS") {
    if (message.section) {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html") + "#" + message.section });
    } else {
      chrome.runtime.openOptionsPage();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "PV_UPDATE_BADGE") {
    updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "PV_QUICK_INSERT_ACTIVE_TAB") {
    // Entry point #2: a snippet click in the popup. The popup being open
    // (and this message being sent from it) is the user gesture that
    // carries activeTab access for the current tab.
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }
        await injectAndMessage(tab.id, {
          type: "PV_INSERT_SNIPPET",
          snippet: message.snippet,
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }
});
