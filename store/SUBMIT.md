# One-time Chrome Web Store listing — copy-paste sheet

Item is already created & package uploaded via API (id: cpldakcfpeaiodhmnclopofjfgkipfnf).
Go to https://chrome.google.com/webstore/devconsole → click the PromptVault item.
Fill the tabs below, then click **Submit for review**. (Future package updates are automated via API.)

## Store listing tab
- **Language:** English (United States)
- **Category:** Productivity
- **Store icon:** upload `icon128.png` (128×128)
- **Screenshots:** upload `1-hero.png`, `2-manage.png`, and `3-features.png` (1280×800)
- **Small promo tile (optional):** upload `promo-440x280.png`
- **Summary (short):**
  Save your best AI prompts & text snippets once. Insert them into any text box on any site with a keyboard shortcut.
- **Description (paste):**
  Stop rewriting the same prompts. PromptVault is a fast, private place to keep the prompts and snippets you reuse every day — and drop them into any text field on any website in one keystroke.

  ★ Save once, reuse everywhere — keep your best ChatGPT / Claude / Gemini prompts, email replies, code-review templates, and canned responses organized in folders with tags and instant search.
  ★ Insert anywhere — press Ctrl/Cmd+Shift+Space to open a quick-search overlay and drop a snippet straight into whatever text box you're in: AI chat composers, Gmail, GitHub, support tools, forms. Works with normal inputs, textareas, and rich editors.
  ★ Smart templates — add {{variables}} to a snippet and PromptVault asks you to fill them in as you insert, so one template covers dozens of situations.
  ★ Typed triggers — give a snippet a trigger like ;fix or ;email and expand it inline as you type.
  ★ Private by design — everything is stored locally on your device. No accounts, no tracking, no servers. Export or import your library as JSON any time.

  Free: up to 25 snippets, folders, search, quick-insert. Pro (coming soon): unlimited snippets, template variables, custom triggers, import/export, cloud sync.

## Privacy practices tab
- **Single purpose:**
  PromptVault lets users save reusable text snippets and insert them into a text field on any website via a keyboard shortcut.
- **Permission justifications:**
  - storage: Stores the user's snippets, folders, and settings locally on their device.
  - activeTab: Inserts a chosen snippet into the text field of the tab the user is actively using, only when the user triggers an insertion.
  - scripting: Injects the insertion UI/logic into the active tab, only on user command (keyboard shortcut or popup click), to place the chosen snippet into the focused text field.
  - NOTE: v0.2.0 uses NO host_permissions and NO content script — access is limited to the active tab at the moment you invoke the extension (activeTab). This avoids the broad-permission review delay and the scary install warning.
- **Are you using remote code?** No, I am not using remote code.
- **Data usage:** Do NOT check any data-collection categories (the extension collects nothing). Then check the two certification boxes affirming compliance with the Developer Program Policies and that you don't sell data.
- **Privacy policy URL:**
  https://github.com/jarvis-agent-shn/promptvault/blob/main/store/PRIVACY.md

## Account / Settings tab
- Set the **publisher contact email** and click **verify** (Google sends a confirmation email — click the link).

## Then
- Click **Submit for review**. Review is typically a few hours to ~2 days. I'll monitor status via API and tell you the moment it goes live.
