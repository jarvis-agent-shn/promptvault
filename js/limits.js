/**
 * PromptVault freemium limits — the single source of truth for what
 * free vs. Pro users can do. Exposed as `globalThis.PVLimits`.
 *
 * Depends on PVPro (js/pro.js) and PVStore (js/store.js) being loaded
 * first in every context that uses this file (background, content,
 * popup, options — see manifest.json / <script> ordering).
 */
(function (global) {
  "use strict";

  const FREE_MAX_SNIPPETS = 25;

  const FEATURES = {
    VARIABLES: "variables",
    CUSTOM_TRIGGERS: "customTriggers",
    IMPORT_EXPORT: "importExport",
  };

  const UPGRADE_COPY = {
    title: "Upgrade to PromptVault Pro",
    body:
      "Pro unlocks unlimited snippets, {{template}} variables, custom typed " +
      "triggers, JSON import/export, and (coming soon) cloud sync across " +
      "devices.",
  };

  async function getSnippetLimitStatus() {
    const pro = await global.PVPro.isPro();
    if (pro) {
      return { pro: true, limit: Infinity, count: null, reached: false };
    }
    const count = await global.PVStore.countSnippets();
    return {
      pro: false,
      limit: FREE_MAX_SNIPPETS,
      count,
      reached: count >= FREE_MAX_SNIPPETS,
    };
  }

  /** Can the user save one more snippet (creating a NEW snippet, not
   *  editing an existing one)? */
  async function canAddSnippet() {
    const status = await getSnippetLimitStatus();
    return status.pro || status.count < status.limit;
  }

  async function canUseFeature(feature) {
    const pro = await global.PVPro.isPro();
    if (pro) return true;
    switch (feature) {
      case FEATURES.VARIABLES:
      case FEATURES.CUSTOM_TRIGGERS:
      case FEATURES.IMPORT_EXPORT:
        return false;
      default:
        return true;
    }
  }

  global.PVLimits = {
    FREE_MAX_SNIPPETS,
    FEATURES,
    UPGRADE_COPY,
    getSnippetLimitStatus,
    canAddSnippet,
    canUseFeature,
  };
})(typeof self !== "undefined" ? self : this);
