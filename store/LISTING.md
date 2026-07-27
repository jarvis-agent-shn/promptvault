# Chrome Web Store listing copy — PromptVault

**Name:** PromptVault — AI Prompt & Snippet Manager

**Category:** Productivity

**Short description (≤132 chars):**
Save your best AI prompts & text snippets once. Insert them into any text box on any site with a keyboard shortcut.

**Detailed description:**

Stop rewriting the same prompts. PromptVault is a fast, private place to keep the
prompts and snippets you reuse every day — and drop them into any text field on
any website in one keystroke.

★ Save once, reuse everywhere
Keep your best ChatGPT / Claude / Gemini prompts, email replies, code review
templates, and canned responses organized in folders with tags and instant search.

★ Insert anywhere
Press Ctrl/Cmd+Shift+Space to open a quick-search overlay and drop a snippet
straight into whatever text box you're in — AI chat composers, Gmail, GitHub,
support tools, forms. Works with normal inputs, textareas, and rich editors.

★ Smart templates
Add {{variables}} to a snippet (like {{topic}} or {{tone}}) and PromptVault asks
you to fill them in as you insert — so one template covers dozens of situations.

★ Quick-search shortcuts
Give a snippet a short trigger like ;fix or ;email and jump straight to it from
the quick-search overlay.

★ Private by design
Everything is stored locally on your device. No accounts, no tracking, no servers,
no data leaves your computer. Export or import your library as JSON any time.

Free plan: up to 25 snippets, folders, search, and quick-insert.
Pro (coming soon): unlimited snippets, template variables, custom quick-search
shortcuts, import/export, and cloud sync.

**Permission justifications (for reviewer):**
- storage: persist the user's snippets/settings locally.
- activeTab + scripting: insert a chosen snippet into the text field on the page
  the user is actively using, only on user action (keyboard shortcut or a popup
  click). No content script, no host_permissions, no background page reading —
  the extension injects its UI into the active tab on demand and only in direct
  response to that user action.

**Privacy policy URL:** https://github.com/jarvis-agent-shn/promptvault/blob/main/store/PRIVACY.md

**Support/homepage URL:** https://github.com/jarvis-agent-shn/promptvault

**Screenshots:** store/screenshots/1-hero.png, 2-manage.png (1280×800)
**Small promo tile:** store/screenshots/promo-440x280.png
