# PromptVault — AI Prompt & Snippet Manager

A universal, framework-free Chrome extension (Manifest V3) for saving reusable
text snippets and AI prompts, organizing them in folders with tags, and
inserting them into any focused text field on any website — ChatGPT, Claude,
Gemini, Gmail, GitHub, or anywhere else you type.

No build step. No npm packages. No bundler. Every file here is exactly what
Chrome loads — open `chrome://extensions`, enable Developer Mode, click
**Load unpacked**, and select this folder.

---

## How insertion works

1. **Quick-search overlay** — press `Ctrl+Shift+Space` (`Cmd+Shift+Space` on
   Mac) anywhere on a page. A small search palette opens; arrow keys +
   Enter pick a snippet, Esc closes it. The chosen snippet is inserted at
   the cursor of whatever field you last focused (or copied to the
   clipboard with a toast if nothing was focused).
2. **Typed triggers** (Pro) — type a trigger string like `;fix` inside any
   input, textarea, or contenteditable field and it expands automatically
   into the full snippet, right where you typed it.
3. **Popup "quick insert"** — click the ↵ button next to a snippet in the
   toolbar popup to insert it into the active tab's focused field without
   leaving the popup.

Insertion is implemented with framework-safe techniques: the native
`value` property setter (so React/Vue-controlled inputs like ChatGPT's
composer pick up the change) plus a dispatched `input`/`change` event for
standard fields, and `document.execCommand('insertText', …)` (with a manual
Range-based fallback) for `contenteditable` fields such as Gmail's compose
box.

## Architecture

```
manifest.json         MV3 manifest — popup, options page, background
                       service worker, content script, commands, icons.
background.js          Service worker: seeds example data on install,
                       relays the open-quick-search keyboard command and
                       popup "quick insert" requests to the active tab's
                       content script, maintains the toolbar badge.
content.js / .css      Injected into every top-level page. Tracks the
                       last-focused editable field, renders the
                       shadow-DOM quick-search overlay + variable-fill
                       modal + toast, expands typed triggers, and
                       performs the actual DOM insertion.
popup.html/.js/.css    Toolbar popup (~380px): search, grouped snippet
                       list, add/edit/delete, quick insert, Pro banner.
options.html/.js/.css  Full manage page: folders CRUD, snippet CRUD,
                       tags/trigger fields, JSON import/export, settings,
                       and the Pro upsell section (options.html#pro).
js/store.js            Storage/data layer — CRUD for folders & snippets,
                       full-text search, {{variable}} extraction/fill,
                       JSON export/import, first-run seed data.
js/limits.js           Single source of truth for free-tier limits.
js/pro.js              Pro-status stub (chrome.storage.local flag today,
                       see the ExtensionPay TODO block inside it).
icons/, assets/        Toolbar/store icons (see "Icons" below).
gen_icons.py           Dev-only helper that generated icons/*.png with
                       nothing but the Python stdlib (zlib+struct). Not
                       loaded by the extension; safe to delete.
```

`js/store.js`, `js/limits.js`, and `js/pro.js` are plain scripts (not ES
modules) that each attach one object to the global scope
(`PVStore`, `PVLimits`, `PVPro`). They're loaded via `<script src>` in the
popup/options pages, via `importScripts()` in the background service
worker, and as ordinary content-script files (in that order) — so the same
code runs unmodified in all four contexts without a bundler.

### Data model (`chrome.storage.local`)

```
pv_folders:  [{ id, name, createdAt }]
pv_snippets: [{ id, folderId, title, body, tags: [], trigger, createdAt, updatedAt }]
pv_settings: { theme: 'system' | 'light' | 'dark' }
pv_pro:      boolean
pv_seeded:   boolean   // guards the one-time example-data seed
```

### Permissions rationale

- `storage` — all data lives in `chrome.storage.local`; nothing leaves the
  device.
- `activeTab` + `scripting` — lets the background worker fall back to a
  one-off programmatic injection if a tab's content script hasn't loaded
  yet (e.g. the tab was open before install/update).
- The content script's `matches: ["<all_urls>"]` entry is what actually
  lets PromptVault insert into *any* site's text field — that's the
  feature. There's no separate `host_permissions` array; the manifest
  doesn't request anything beyond that. Chrome will still show the
  standard "read and change data on all sites" install prompt because
  that's inherent to an always-available content script, not something a
  narrower permission set can avoid while keeping the feature.
- No `host_permissions`, no remote code, no `eval`, no CDN/remote fonts or
  assets — every extension page ships its own `Content-Security-Policy`
  meta tag (`default-src 'self'`) satisfied entirely by local files.

## Freemium gating (stub — no real payments yet)

`js/pro.js` exports `isPro()`, which today just reads the
`pv_pro` boolean out of `chrome.storage.local` (default `false`). It has a
clearly-marked `TODO(payments)` block showing exactly where to initialize
[ExtensionPay](https://extensionpay.com) once you have the library and an
extension id — swap `isPro()`'s body for an `extpay.getUser()` call, start
`extpay.startBackground()` in `background.js`, and point the upgrade CTA at
`extpay.openPaymentPage()`. Everything downstream (`js/limits.js`, the
popup, the options page, the content script) only ever calls `PVPro.isPro()`
and never touches storage directly, so that swap is the *only* file that
needs to change.

Options → Pro tab has a **Developer options** disclosure with a checkbox
that flips `pv_pro` locally, purely for testing the gated UI. Remove it
when real billing lands.

`js/limits.js` centralizes what's enforced when `isPro()` is false:

| Free tier | Limit |
| --- | --- |
| Saved snippets | 25 max (`FREE_MAX_SNIPPETS`) |
| Template `{{variables}}` | Disabled — quick-search shows an "insert as-is or upgrade" prompt; the trigger-expansion path is Pro-only entirely, so no separate gate is needed there |
| Custom typed triggers | Disabled — the trigger field is grayed out in both editors and typed-trigger expansion doesn't run in the content script |
| JSON import / export | Disabled — the Import & Export tab shows an upgrade card instead of the actual controls |

Quick-search (`Ctrl/Cmd+Shift+Space`) always works, even on the free plan —
per spec, that's the one insertion path that's never gated.

Upgrade CTAs (popup banner, options Pro tab, in-page upgrade-hint modal,
"limit reached" dialogs) all currently just open
`options.html#pro`, which is the intended integration point for
`extpay.openPaymentPage()` later.

## Seed data

On first run (popup or options page, whichever opens first), if storage is
completely empty, PromptVault seeds two folders — **Writing** and
**Coding** — with five example prompts (Polish this text, Summarize,
Professional email reply, Explain this code, Fix this bug), each using
`{{variable}}` placeholders and a `;trigger` string, so the extension is
immediately useful instead of empty. Seeding runs once, guarded by the
`pv_seeded` flag.

## Accessibility & robustness

- The quick-search overlay and variable-fill modal are keyboard-navigable
  (`↑`/`↓` to move, `Enter` to choose/submit, `Esc` to close), use
  `role="dialog"`/`aria-modal`, and trap focus inside themselves.
- All overlay/modal/toast UI lives inside a single Shadow DOM host
  (`#promptvault-ui-host`) so host-page CSS can never distort it and it can
  never leak styles onto the host page either.
- Insertion is defensive: if no editable element is focused (or the
  previously-focused one was removed from the DOM), PromptVault falls back
  to copying the snippet to the clipboard and shows a toast explaining
  what happened, instead of throwing.
- No inline event handlers anywhere in HTML (`onclick="…"` etc.) — every
  listener is wired in JS via `addEventListener`, satisfying a strict CSP
  with no `unsafe-inline`.

## Known limitations (v0.1.0)

- The content script (and therefore quick-search, trigger expansion, and
  insertion) only runs in the **top-level frame** of a page, not inside
  iframes. This covers every target site named in the spec (ChatGPT,
  Claude, Gemini, Gmail, GitHub all use top-level compose fields) but
  won't reach a text field embedded in a cross-origin `<iframe>`.
- Typed-trigger detection matches a trailing whitespace-delimited token
  against the whole caret-to-text-node context; it's tuned for short,
  punctuation-prefixed triggers (`;fix`) and may not detect a trigger that
  spans multiple DOM text nodes in an unusually structured rich-text
  editor.
- `js/pro.js` is a local stub — no payment provider is wired up yet (see
  TODO block inside it).

## Before Chrome Web Store submission

1. **Icons** — `icons/icon16.png`, `icon48.png`, `icon128.png` were
   generated programmatically (`gen_icons.py`, pure Python stdlib — no
   Pillow/ImageMagick available in this environment) as a rounded-square
   gradient with a bookmark glyph. They're valid, usable placeholder PNGs,
   but you'll want a designer pass (or at least a nicer glyph/gradient)
   before shipping. `assets/icon.svg` has the same design as an editable
   vector source.
2. **Screenshots** — the Chrome Web Store listing needs 1–5 screenshots
   (1280×800 or 640×400) and optionally a promo tile; none exist yet.
3. **ExtensionPay** — sign up at extensionpay.com, get an extension id,
   vendor `extpay.js` into `js/`, and follow the TODO block in
   `js/pro.js` to wire real billing in place of the `pv_pro` stub.
4. **Privacy policy** — required by the Chrome Web Store for any listing;
   PromptVault stores everything locally and makes no network requests
   today, so a short policy stating that (plus what changes once
   ExtensionPay/cloud sync are added) will be needed at submission time.
5. **Store listing copy** — description, category, and support URL still
   need to be written for the Developer Dashboard (separate from
   `manifest.json`'s short in-extension description).
6. Bump `manifest.json`'s `"version"` per Web Store versioning rules on
   each subsequent submission.

## Local development

No install step. Load unpacked:

1. Visit `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `promptvault/` folder.
4. Pin the toolbar icon, open a page with a text field (or `chrome://newtab`
   with any input focused elsewhere), and try `Ctrl+Shift+Space`.

Reloading after an edit: click the refresh icon on the extension's card in
`chrome://extensions` (content-script changes also require reloading the
target tab).
