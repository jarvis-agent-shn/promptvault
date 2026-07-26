/**
 * PromptVault background service worker.
 *
 * Responsibilities:
 *  - Seed example data on first install.
 *  - Listen for the "open-quick-search" keyboard command and relay it
 *    to the active tab's content script.
 *  - Answer a couple of small message requests from popup/content that
 *    need extension-level APIs (opening the options page, etc).
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

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-quick-search") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    await sendOrInject(tab.id, { type: "PV_OPEN_QUICK_SEARCH" });
  } catch (e) {
    console.error("[PromptVault] command relay failed", e);
  }
});

/**
 * Sends a message to a tab's content script. If the content script
 * hasn't loaded yet (e.g. page was open before install/update, or is a
 * restricted page that never got it), attempts a one-time programmatic
 * injection via chrome.scripting and retries.
 */
async function sendOrInject(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["js/store.js", "js/limits.js", "js/pro.js", "content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"],
      });
      await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) {
      // Restricted page (chrome://, Web Store, etc.) — nothing we can do.
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
    // Relays a request from the popup to insert a snippet into the
    // currently active tab's focused field.
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }
        await sendOrInject(tab.id, {
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
