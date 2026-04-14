# kathai

> *kathai* (கதை / കഥ) — Tamil and Malayalam for **"story"**.

A quiet, minimalist EPUB reader that reads books aloud — entirely on-device, entirely in the browser.

No accounts. No cloud. No ads. No tracking. Upload a book, and it stays on your device. Tap listen, and the narration is synthesized locally by a small neural TTS model running in your browser tab. Works offline after the first visit.

---

## Vision

The modern web is loud. Reading shouldn't be. **Kathai** aims to feel like a small, well-worn paperback — warm paper tones, serif type, thin rules, nothing that blinks or pulses or asks for your attention. You open it, you read, you close it. The interface gets out of the way.

The technical ambition is just as minimal: **no backend**. Everything — parsing, storage, narration — happens in your browser. Your library is yours alone; there is no server that could ever see what you read.

### Why this exists

- **Accessibility**: on-device TTS means books you already own become audiobooks, without subscriptions and without sending your reading habits anywhere.
- **Offline-first**: a long flight, a train through a dead zone, a reading nook with bad Wi-Fi — kathai keeps working.
- **Privacy by construction**: the privacy story isn't a promise on a settings page. There is simply no server to talk to.
- **Learning vehicle**: an excuse to get hands dirty with Bun, Svelte 5, Web Workers, ONNX Runtime Web, Web Audio, and PWA primitives in one small, opinionated project.

### Design principles

1. **E-ink, not glass.** Warm paper background, ink-dark text, serif body, thin rules, small caps for chrome. Avoid hard blacks and pure whites. Avoid color except for rare emphasis.
2. **As few controls as possible.** Upload, read, listen, next, previous. Nothing else on the surface. Settings hide until asked.
3. **Mobile-first, always.** 44px touch targets, safe-area insets, fluid type, no hover-dependent affordances.
4. **Offline by default.** If a feature needs the network, it's either optional or deferred.
5. **Boring tech beats clever tech.** IndexedDB over a wrapper; plain Svelte stores over a state library; vanilla Web Audio over a framework.

---

## Stack

| Layer        | Choice                | Why                                                |
| ------------ | --------------------- | -------------------------------------------------- |
| Package mgr  | **Bun**               | Fast installs, native TS, simple scripts           |
| Bundler      | **Vite**              | Instant HMR, mature Svelte plugin                  |
| UI           | **Svelte 5**          | Small bundles, runes, great mobile perf            |
| EPUB parser  | **epub.js**           | Battle-tested, handles the quirks                  |
| Storage      | **IndexedDB**         | Large blobs, persistent, no dependency             |
| TTS (Ph. 2)  | **onnxruntime-web**   | Run KittenTTS in a Worker, on-device               |
| Audio (Ph.2) | **Web Audio API**     | Buffer queueing, playback rate, seek               |
| Offline (P3) | **Service Worker**    | PWA install, asset + model caching                 |

---

## Milestones

### Phase 1 — Foundation *(current)*
Get a book on screen and keep it there across reloads.

- [x] Scaffold Bun + Vite + Svelte 5 + TypeScript
- [x] Path aliases (`$lib`, `$stores`, `$components`)
- [x] `IndexedDB` helper (`src/lib/db.ts`)
- [x] EPUB parser wrapper (`src/lib/epub-loader.ts`)
- [x] Sentence chunker (`src/lib/text-chunker.ts`) — ready for Phase 2
- [x] `books` Svelte store with progress persistence
- [x] `Library` component — upload, list, delete
- [x] `Reader` component — chapter view, prev/next, saved position
- [x] E-ink / paperback visual system (warm paper, serif, thin rules)
- [ ] Verified end-to-end with a real EPUB from Project Gutenberg

**Definition of done:** upload an EPUB → it appears on the shelf → open it → read chapters → refresh → it's still there, at the chapter you left.

### Phase 2.1 — Discover (Project Gutenberg)
Remove the blank-shelf blocker. 75,000 free books, one tap away.

- [x] Gutendex-backed search (`src/lib/gutenberg.ts`) — no API key, CORS-friendly
- [x] `Discover` component — italic search field, popular-first on open, dashed-rule results
- [x] Direct EPUB fetch from Gutenberg mirrors, parsed in-browser, saved to the shelf
- [x] `gutenberg-<id>` deterministic IDs (re-importing the same book is a no-op)
- [ ] Language filter / subject facets
- [ ] Offline-friendly "recently browsed" cache

### Phase 2 — Narration
Make the book read itself.

- [x] `TTSEngine` interface (`src/lib/tts.ts`) — pluggable engine backend
- [x] `WebSpeechEngine` — ships first, uses the OS's native on-device TTS
- [x] `player` store — play / pause / stop / prev / next / rate
- [x] `Player` component — minimal italic controls under the chapter
- [x] Active-sentence highlight in the reader (paper-edge wash)
- [x] Chapter-change cancels narration
- [x] Speed control (0.75× / 1× / 1.25× / 1.5×)
- [x] Auto-advance to next chapter when current finishes
- [x] Auto-scroll the active sentence into view
- [ ] Voice picker (expose `listVoices()` in settings)
- [ ] *Phase 2.5 — KittenTTS ONNX engine behind the same interface*
  - [ ] Model download + IndexedDB cache
  - [ ] `synthesizer.worker.ts` — ONNX inference off main thread
  - [ ] Prefetch queue: synthesize next 2 chunks while current plays
  - [ ] Web Audio API playback
  - [ ] Transparent fallback to `WebSpeechEngine` if ONNX fails

**Definition of done:** tap *listen* → the chapter starts playing within ~1s → pause/resume works → speed control works → switching chapters restarts narration.

### Phase 3 — Polish & offline
Make it installable and genuinely portable.

- [x] `manifest.webmanifest` + SVG icon (paper/ink aesthetic, maskable)
- [x] Service Worker via `vite-plugin-pwa` (Workbox) — app shell precache
- [x] Runtime caching: Gutendex `StaleWhileRevalidate`, Gutenberg EPUBs `CacheFirst`
- [x] iOS `apple-mobile-web-app-capable` + theme-color (light/dark)
- [ ] Settings panel (theme, voice, speed, font size, justification on/off)
- [ ] Persistent storage permission request
- [ ] Storage quota indicator
- [ ] Install-prompt UX (soft affordance, not a banner)
- [ ] Performance pass: code-split Player, lazy chapter parsing
- [ ] Real-device testing: iPhone 12+, Pixel 5+
- [ ] Accessibility pass: keyboard nav, screen reader labels, focus states

**Definition of done:** install to home screen → launch offline → read and listen to a previously-downloaded book with no network.

### Post-MVP (maybe, someday)
- Bookmarks & highlights
- Full-text search across the library
- MOBI / PDF import
- Per-book reading stats
- Optional Tamil / Malayalam UI localization (nod to the name)
- Shareable book collections via signed URL — *only if it can stay zero-backend*

---

## Non-goals

- **No accounts, ever.** No sign-in, no sync, no server.
- **No DRM.** Kathai will never try to open DRM-protected files.
- **No telemetry.** No analytics, no crash reporting that leaves the device.
- **No reading social graph.** This is a quiet room.
- **No AI summarization / chatbot / "ask the book".** Out of scope, by design.

---

## Develop

```bash
bun install
bun run dev
```

Open http://localhost:5173. Grab a free EPUB from [Project Gutenberg](https://www.gutenberg.org/) to test.

```bash
bun run check    # typecheck
bun run build    # production bundle
bun run preview  # preview the production bundle
```

## Layout

```
src/
├── components/
│   ├── Library.svelte      # shelf: upload, list, delete
│   ├── Reader.svelte       # chapter view + navigation + active-sentence highlight
│   ├── Player.svelte       # narration controls (play/pause/prev/next/rate)
│   └── Discover.svelte     # Project Gutenberg search & import
├── stores/
│   ├── books.ts            # library + current-book state, progress persistence
│   └── player.ts           # narration state machine (idle/playing/paused)
├── lib/
│   ├── db.ts               # IndexedDB helpers
│   ├── epub-loader.ts      # epub.js wrapper → { metadata, chapters }
│   ├── text-chunker.ts     # sentence-aware chunking (feeds the player)
│   ├── tts.ts              # TTSEngine interface + WebSpeechEngine impl
│   └── gutenberg.ts        # Gutendex search + direct EPUB download
├── styles/
│   └── global.css          # paper/ink design tokens
├── App.svelte              # shelf ↔ reader routing
└── main.ts
```

## Progress

**Current status:** Phases 1, 2, 2.1, and 3 core all shipped. Today kathai is: a mobile-first, installable PWA that can upload EPUBs or pull any of Project Gutenberg's 75k free books, read them aloud via the OS's native TTS with auto-advance between chapters and active-sentence tracking, and keep working offline after first load. Remaining: Phase 2.5 (KittenTTS ONNX engine for higher-quality voices) and Phase 3 polish (Settings panel, real-device testing, a11y pass).
