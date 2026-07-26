/**
 * PromptVault Pro status module.
 *
 * Plain script exposing `globalThis.PVPro`. Today this is a local stub:
 * Pro status lives entirely in chrome.storage.local under the "pv_pro"
 * boolean key, toggled by a dev helper in the options page. No network
 * calls, no payment provider, nothing remote — safe for Chrome Web
 * Store review as-is.
 *
 * ---------------------------------------------------------------------
 * TODO(payments): wire up ExtensionPay (https://extensionpay.com) here
 * once the library and extension id are available. The intended shape,
 * left in place so future-you can drop it straight in:
 *
 *   // 1. Add extpay.js to the extension (vendor file, no bundler needed)
 *   //    and list it as a <script src="js/extpay.js"> in popup.html /
 *   //    options.html, plus `importScripts('js/extpay.js')` in
 *   //    background.js.
 *   //
 *   // 2. In background.js:
 *   //      const extpay = ExtPay('promptvault'); // your extension id
 *   //      extpay.startBackground();
 *   //
 *   // 3. Replace the body of isPro() below with:
 *   //      const extpay = ExtPay('promptvault');
 *   //      const user = await extpay.getUser();
 *   //      const pro = !!(user && user.paid);
 *   //      await setProCache(pro); // keep local cache in sync
 *   //      return pro;
 *   //
 *   // 4. Replace openUpgradePage() with `extpay.openPaymentPage()`,
 *   //    falling back to the in-extension options Pro section if
 *   //    ExtensionPay is unreachable.
 *   //
 *   // 5. Keep `pv_pro` as an offline cache so gating still works
 *   //    instantly while the network call resolves.
 * ---------------------------------------------------------------------
 */
(function (global) {
  "use strict";

  const PRO_KEY = "pv_pro";

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Resolves to true if the user currently has Pro unlocked. */
  async function isPro() {
    try {
      const { [PRO_KEY]: pro } = await storageGet(PRO_KEY);
      return pro === true;
    } catch (e) {
      return false;
    }
  }

  /** Dev helper: force-set the pro flag. Used by the options page's
   *  "Developer: toggle Pro (testing only)" control. Remove once real
   *  billing (ExtensionPay) is wired up. */
  async function setProDev(value) {
    await storageSet({ [PRO_KEY]: value === true });
    return value === true;
  }

  /** Opens the options page, scrolled to the Pro upgrade section. */
  function openUpgradePage() {
    const url = chrome.runtime.getURL("options.html") + "#pro";
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
    } else {
      chrome.runtime.openOptionsPage
        ? chrome.runtime.openOptionsPage()
        : window.open(url, "_blank");
    }
  }

  global.PVPro = {
    isPro,
    setProDev,
    openUpgradePage,
  };
})(typeof self !== "undefined" ? self : this);
