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

PromptVault ships **no persistent content script** and requests **no
host_permissions** — the manifest only lists `storage`, `activeTab`, and
`scripting`. All on-page UI is injected into the active tab **on demand**,
via `chrome.scripting.executeScript`, and only in direct response to one
of two user actions against the extension itself:

1. **Quick-search overlay** — press `Ctrl+Shift+Space` (`Cmd+Shift+Space` on
   Mac) anywhere on a page. Firing that keyboard command is the user
   gesture that grants the extension temporary `activeTab` access to the
   current tab; `background.js` uses it to inject the overlay UI
   (`content.js` + `content.css`) into that tab and open it. A small
   search palette appears; arrow keys + Enter pick a snippet, Esc closes
   it. The chosen snippet is inserted at the cursor of whatever field you
   last focused in that tab (or copied to the clipboard with a toast if
   nothing was focused). Typing a snippet's **quick-search shortcut**
   (e.g. `;fix`) into the search box filters straight to it — see
   "Quick-search shortcuts" below.
2. **Popup "quick insert"** — click the ↵ button next to a snippet in the
   toolbar popup. Opening the popup and clicking inside it is itself a
   user gesture against the extension, so `background.js` injects the
   same on-demand UI into the active tab (if it isn't already there) and
   asks it to insert that one snippet, without leaving the popup.

There is **no always-on, type-anywhere trigger expansion**. That would
require watching every keystroke on every page via a persistent,
all-sites content script — exactly the broad access this extension
deliberately gives up in exchange for a narrower install-time permission
prompt. See "Quick-search shortcuts" below for what a snippet's trigger
string does instead.

Insertion is implemented with framework-safe techniques: the native
`value` property setter (so React/Vue-controlled inputs like ChatGPT's
composer pick up the change) plus a dispatched `input`/`change` event for
standard fields, and `document.execCommand('insertText', …)` (with a manual
Range-based fallback) for `contenteditable` fields such as Gmail's compose
box.

### Quick-search shortcuts

Each snippet can have an optional short string (e.g. `;fix`, `;email`) —
labeled **"Quick-search shortcut"** in the popup/options editor. It is
**not** auto-expanded as you type anywhere; it's indexed by
`js/store.js`'s `search()`, so typing it into the quick-search overlay's
search box instantly filters the list down to that snippet. On the free
plan every snippet can be found by title, body, or tag; custom shortcut
strings are a Pro perk (see Freemium gating below), but quick-search
itself is always free.

## Architecture

```
manifest.json         MV3 manifest — popup, options page, background
                       service worker, commands, icons. No content_scripts
                       block and no host_permissions.
background.js          Service worker: seeds example data on install,
                       handles the open-quick-search keyboard command and
                       popup "quick insert" requests by programmatically
                       injecting content.js/.css into the active tab
                       (chrome.scripting) and messaging it — the only two
                       places PromptVault ever touches a page.
content.js / .css      NOT a content script — injected into the active
                       tab on demand (see background.js). Tracks the
                       last-focused editable field, renders the
                       shadow-DOM quick-search overlay + variable-fill
                       modal + toast, and performs the actual DOM
                       insertion. No typed-trigger auto-expansion.
popup.html/.js/.css    Toolbar popup (~380px): search, grouped snippet
                       list, add/edit/delete, quick insert, Pro banner.
options.html/.js/.css  Full manage page: folders CRUD, snippet CRUD,
                       tags/quick-search-shortcut fields, JSON
                       import/export, settings, and the Pro upsell
                       section (options.html#pro).
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
(`PVStore`, `PVLimits`, `PVPro`). `js/store.js` and `js/pro.js` are loaded
via `<script src>` in the popup/options pages, via `importScripts()` in
the background service worker, and via `chrome.scripting.executeScript`'s
`files` option when background.js injects them into a tab on demand
alongside `content.js` — so the same code runs unmodified in every
context without a bundler. `js/limits.js` is only needed in the
background worker and the popup/options pages (snippet-limit gating),
so it isn't part of the on-demand injection.

### Data model (`chrome.storage.local`)

```
pv_folders:  [{ id, name, createdAt }]
pv_snippets: [{ id, folderId, title, body, tags: [], trigger, createdAt, updatedAt }]
pv_settings: { theme: 'system' | 'light' | 'dark' }
pv_pro:      boolean
pv_seeded:   boolean   // guards the one-time example-data seed
```

### Permissions rationale

`manifest.json`'s `"permissions"` array is exactly
`["storage", "activeTab", "scripting"]` — no `host_permissions`, no
`content_scripts` block, no `<all_urls>` anywhere. That's a deliberate
trade: PromptVault gives up always-on, type-anywhere trigger expansion
so it never triggers Chrome's "read and change all your data on all
websites" install warning.

- `storage` — all data lives in `chrome.storage.local`; nothing leaves the
  device.
- `activeTab` — grants temporary access to whatever tab is active *only*
  in direct response to a user gesture against the extension: firing the
  `open-quick-search` keyboard command, or interacting with the popup.
  It expires when that interaction ends; PromptVault has no standing
  access to any tab at any other time.
- `scripting` — lets `background.js` call
  `chrome.scripting.executeScript`/`insertCSS` to inject the quick-search
  overlay and insertion logic (`content.js` + `content.css`) into the
  active tab, using the `activeTab` grant above. This only ever runs from
  the two entry points documented at the top of `background.js`.
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
popup, the options page, the on-demand injected UI) only ever calls
`PVPro.isPro()` and never touches storage directly, so that swap is the
*only* file that needs to change.

Options → Pro tab has a **Developer options** disclosure with a checkbox
that flips `pv_pro` locally, purely for testing the gated UI. Remove it
when real billing lands.

`js/limits.js` centralizes what's enforced when `isPro()` is false:

| Free tier | Limit |
| --- | --- |
| Saved snippets | 25 max (`FREE_MAX_SNIPPETS`) |
| Template `{{variables}}` | Disabled — quick-search shows an "insert as-is or upgrade" prompt |
| Custom quick-search shortcuts | Disabled — the shortcut field is grayed out in both editors; quick-search itself still finds every snippet by title/body/tag |
| JSON import / export | Disabled — the Import & Export tab shows an upgrade card instead of the actual controls |

Quick-search (`Ctrl/Cmd+Shift+Space`) always works, even on the free plan —
per spec, that's the one insertion path that's never gated. There is no
typed-trigger auto-expansion on any plan (see "How insertion works" above).

Upgrade CTAs (popup banner, options Pro tab, in-page upgrade-hint modal,
"limit reached" dialogs) all currently just open
`options.html#pro`, which is the intended integration point for
`extpay.openPaymentPage()` later.

## Seed data

On first run (popup or options page, whichever opens first), if storage is
completely empty, PromptVault seeds two folders — **Writing** and
**Coding** — with five example prompts (Polish this text, Summarize,
Professional email reply, Explain this code, Fix this bug), each using
`{{variable}}` placeholders and a `;shortcut` quick-search string, so the
extension is immediately useful instead of empty. Seeding runs once,
guarded by the `pv_seeded` flag.

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

## Known limitations (v0.2.0)

- The on-demand injected UI (and therefore quick-search and insertion)
  only runs in the **top-level frame** of a page, not inside iframes
  (`chrome.scripting.executeScript` targets the main frame by default).
  This covers every target site named in the spec (ChatGPT, Claude,
  Gemini, Gmail, GitHub all use top-level compose fields) but won't reach
  a text field embedded in a cross-origin `<iframe>`.
- There is no always-on, type-anywhere trigger expansion, by design (see
  "How insertion works" above) — that would require a persistent,
  all-sites content script, which is exactly the broad permission this
  extension avoids. A snippet's quick-search shortcut only works as a
  filter inside the quick-search overlay.
- Because there's no persistent content script, the very first
  quick-search or quick-insert in a given tab/session pays a small,
  one-time injection cost (`chrome.scripting.executeScript` +
  `insertCSS`) before the overlay appears; subsequent invocations in the
  same tab reuse the already-injected UI until the tab navigates away or
  is closed.
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
`chrome://extensions`. Because `content.js`/`content.css` are injected
on demand rather than as a persistent content script, a tab that already
received them earlier in the session keeps running the old copy until
you reload that tab (or navigate away and back) — reload the target tab
too after editing `content.js`, `content.css`, `js/store.js`, or
`js/pro.js`.
