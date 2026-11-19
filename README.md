# JANUS

STEM that works without the internet. Downloadable content packs, lessons at
two reading levels, simulations, quizzes, problem sets, progress tracking and a
local tutor — all of it running on the device, after one visit while connected.

**[Try it → anantamracing.com/hackathon/janus/app/](https://anantamracing.com/hackathon/janus/app/)**
— open it once online, then turn your connection off and keep using it.

An independent project, supported and showcased by
[Anantam Hackathon](https://hackathon.anantamracing.com/).

---

## The premise

Learning tools that assume a connection fail the students who need them most.
Three assumptions JANUS refuses to make:

- **Connections are continuous.** They are bursty. So the app syncs
  opportunistically and is fully usable in the gaps.
- **Data is free.** It has a price. So content is downloaded in explicit packs
  whose byte sizes are shown before you commit, not streamed per page view.
- **Devices are personal and large.** They are shared and small. So progress is
  per-profile on-device and the layout works on a phone.

## The local tutor is not an AI model, and says so

This is the claim most likely to be misread, so it is stated in the source
itself, at the top of `js/tutor.js`:

> Not an AI model: it is intent matching plus BM25 retrieval over the knowledge
> base installed on this device.

Concretely: nine regex intents (`simpler`, `hindi`, `step N`, `harder`,
`easier`, `quiz`, `problem`, `define`, `help`) in front of a **BM25** index
built over the installed lessons. Every answer links to the lesson it came
from, and a weak retrieval match says it is weak rather than bluffing. There is
no model weight anywhere in the repository and no inference call to anywhere.

It handles some real messiness: `resultOfStep()` pulls the numeric answer out
of a worked solution line by taking the first number after the last `=`, and it
parses Unicode superscripts, so `4.265 × 10¹³` reads back as a float.

## Hindi coverage, stated as a number

The content manifest publishes exactly how far the translation got:

```json
"hindi": { "fullLessons": 4, "totalLessons": 16, "titlesAndSummaries": 16 }
```

**4 of 16 lessons are fully translated**; all 16 have translated titles and
summaries. The app shows that distinction in the interface rather than
advertising "Hindi support" and letting a student discover the gap. That number
is read from the manifest, so it cannot drift away from the content.

## What is actually in the knowledge base

| | |
|---|---|
| Subjects | physics, chemistry, mathematics, engineering |
| Lessons | 16, each at two reading levels |
| Simulations | 6 |
| Pack sizes | 46–63 KB of JSON per subject, shown before download |

## How offline works

```
first visit (online)
   ↓  sw.js installs, precaching the shell file by file
       a single missing file does not abort the install
   ↓  you choose content packs; their URLs are sent to the
       service worker as CACHE_URLS and stored in janus-content-v1
offline
   ↓  shell + packs served from cache; navigation falls back to
       app/index.html, so a deep link still opens the app
   ↓  progress, notes and quiz results go to IndexedDB
reconnect
   ↓  sync when you can — not on a schedule
```

Three versioned caches — `janus-shell-v1.0.0`, `janus-content-v1`,
`janus-fonts-v1`. On activate, any `janus-*` cache not in the current set is
deleted and open clients are claimed. **Web fonts are cached too**, by
intercepting `fonts.googleapis.com` and `fonts.gstatic.com` in the `fetch`
handler — without that, an offline-first app would still render in a fallback
font the moment the connection dropped.

Packs can be removed again (`UNCACHE_URLS`), because a student on a shared
16 GB phone needs the space back.

## Stack

Plain HTML, CSS and ES modules. No build step, no npm dependencies, no backend.
Storage is IndexedDB for content and progress, `localStorage` for settings. The
only outbound requests are web fonts, and those are cached by the service
worker on first load.

## Getting started

Paths in this project are **root-relative to `/hackathon/janus/`** — not an
oversight. A service worker's `scope` and a web app manifest's `start_url` and
`id` must match the path the app is actually served from, and changing them to
be root-agnostic would break installability and the offline scope at the same
time. So a bare clone needs to be served at that path:

```bash
git clone https://github.com/DDXPlayz/janus.git
cd janus
./serve.sh        # http://localhost:4321/hackathon/janus/
```

`serve.sh` builds a throwaway symlink tree that puts the repo at
`/hackathon/janus/` and serves it, so the service worker scope, the manifest
and every link resolve exactly as they do in production. Verified: the landing
page, the app, the docs, the stylesheet, the manifest and `sw.js` all return
200 through it.

## Project structure

```
index.html              landing page
app/index.html          the learning environment
docs/index.html         documentation, including the offline-behaviour notes
sw.js                   service worker: 3 versioned caches, nav fallback
manifest.webmanifest    installable PWA, scope /hackathon/janus/
content/
  manifest.json         catalogue, pack sizes, the Hindi coverage numbers
  physics.json  chemistry.json  mathematics.json  engineering.json
js/
  tutor.js              intent matching + BM25 retrieval (not a model)
  retrieval.js          tokeniser, stemmer, BM25 index
  net.js                service-worker registration, online/offline state
  packs.js              pack install/remove, byte accounting
  sync.js               opportunistic sync
  db.js                 IndexedDB
  progress.js  content.js  sims.js  settings.js
  views-learn.js  views-manage.js  ui.js  illustrations.js  landing.js  app.js
janus.css
```

## Status & verification

**Status:** live and working. Stable; not under active development.

| Claim | How it was checked |
|---|---|
| Live at the URL above | HTTP 200, checked 2026-11-19 |
| The tutor is not an AI model | verified by inspection — BM25 + regex intents, **zero** model files or inference calls |
| Hindi numbers are accurate | read from `content/manifest.json`: 4 / 16 full, 16 / 16 titles |
| 16 lessons, 6 simulations, 4 subjects | counted from the manifest |
| Fonts are cached for offline use | verified — `fetch` handler intercepts both Google Fonts hosts |
| Serves correctly from a bare clone | **run** — all 8 key paths return 200 via `serve.sh` |

**Not verified:** actual offline behaviour on a real device after a real
connection drop (the caching logic is verified by inspection, not by a field
test); PWA installability on iOS; the pedagogical accuracy of the lesson
content; whether the Hindi translations are idiomatic.

## Credits

Written by **Dhruva Goyal**. No third-party code is included.

## Licence

[MIT](LICENSE).
