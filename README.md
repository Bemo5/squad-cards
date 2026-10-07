# Squad Cards

FIFA Ultimate Team style cards for a friend group, done as an end-of-year thing.
You're the commissioner: you make a deck, add your friends, invent the stats,
and send one link. Friends open a pack, see the squad, and save their card as
an image.

Plain HTML/CSS/JS, no build step. GitHub Pages for the site, Firebase
(Firestore + Google sign-in) for shared data. See `FIREBASE-SETUP.md`; until
then it runs in demo mode in one browser.

## Everything is config

Each deck holds its own:

- **Stats**: code, name, and "higher is worse" (shows the real number but pulls
  the overall down, for things like lateness). Six fits best, up to eight.
- **Roles**: the code under the rating (CAP, DRV...). Each role weights the
  stats differently, so the overall is a weighted average.
- **Tiers**: overall thresholds that pick the skin (gold 75+, silver 65+,
  bronze). A skin set on a player by hand (Team of the Year, Icon) wins.
- **Skins and flags**: palettes in `js/card.js` (`SKINS`, `FLAGS`). Add an
  entry there and it shows up in every menu.

## Who can do what

| Role | Can |
| --- | --- |
| Anyone with the link | See the cards once revealed. No sign-in. |
| Viewer | Signed in; shows up in Manage > People so you can promote them. |
| Suggester | Proposes stat changes; they wait in your inbox. |
| Editor | Changes stat values directly. Every change is in History and can be undone. |
| The friend on a card | Changes that card's name and photo, if you link them to it. |
| Commissioner | Everything else: players, stats, roles, tiers, reveal, editions. |

Enforced by `firestore.rules`, not just hidden in the UI.

## The year cycle

1. Make the deck. It starts hidden: friends see a countdown.
2. Add players, photos (the background is cut out in the browser), stats.
3. Manage > Edition > **Reveal the cards**. Everyone's first visit opens a pack,
   lowest card first, with a walkout for the best one.
4. Next year: **Start the next edition**. Same setup and friends, and every card
   shows how much it moved.

## Running locally

```
node serve.cjs              # http://127.0.0.1:8125
node tools/smoke.cjs        # end-to-end check in demo mode (needs the server)
node tools/photo-check.cjs  # runs the real photo cut-out (needs internet)
```

Photos are stored as small webp data URLs in Firestore (no Firebase Storage,
which needs a paid plan). The cut-out model (~80 MB, `isnet_fp16`) downloads
from a CDN the first time someone adds a photo, then the browser caches it.

---

## For AI assistants working on this repo

Read this section before changing anything. It covers what the code does
and why it was built this way. The reasons matter: several of these choices
look odd until you know them.

### What this is (and isn't)

- Not a football app. The "stats" are jokes about the friends: Banter, Lateness,
  Rizz, Loyalty, Replies in the group chat, Cooking. The app copies the *look*
  and *ritual* of FUT cards (pack opening, walkout, TOTY skin), not football.
- ~10 friends, one commissioner (the repo owner). Two people are building it.
- **Everything is deck data, nothing is hardcoded to this friend group.** Stats,
  roles, per-role weights, tiers, skins and flags are all configurable. Don't
  bake names, stat codes or counts into the code. `deckTemplate()` in
  `js/overall.js` is only a starting point.

### Stack and constraints

- Vanilla ES modules, **no build step, no npm, no framework**. Firebase SDK
  10.12.0 is imported straight from `gstatic.com`; the background-removal
  library from jsdelivr. Keep it that way: GitHub Pages serves the folder as-is.
- `serve.cjs` and `tools/*.cjs` are Node scripts for local dev/testing only.
  They aren't part of the site.
- Firebase **Spark (free) plan**, so no Cloud Functions and no Storage. That's
  why photos are webp data URLs in their own `photos/{pid}` collection (kept
  separate so loading the deck list doesn't pull every image), and why every
  permission check lives in `firestore.rules`.

### File map

| File | Role |
| --- | --- |
| `index.html` | Shell: top bar + `<main id="app">`. Loads `js/app.js`. |
| `js/app.js` | Hash router and every screen (home, deck, card, editor, manage tabs, reveal/pack). `ACTIONS` holds the click handlers. |
| `js/store.js` | All reads/writes. Schema documented at the top. `watchDeck()` is the single live view a screen renders from. |
| `js/db.js` | Two adapters with the same API: Firebase, and a localStorage **demo mode** used while `js/config.js` still says `PASTE_ME`. |
| `js/overall.js` | Pure functions: overall rating, tier, skin, the default deck template. |
| `js/card.js` | The card, as one SVG string per player. `SKINS` and `FLAGS` live here. |
| `js/photo.js` | Photo upload: background removal in the browser, crop to the subject, webp. |
| `js/export.js` | Card → PNG (fonts embedded) and the share sheet. |
| `js/ui.js` | `esc`, `$`, dialogs, `ago()`. |
| `js/config.js` | Firebase web config (public by design). Still `PASTE_ME`. |
| `firestore.rules` | The real permission model. |
| `tools/smoke.cjs` | End-to-end test in demo mode through Chrome DevTools Protocol (`tools/cdp.cjs`). Screenshots go to `tools/shots/` (gitignored). |

### Data model (Firestore)

```
decks/{d}             name, year, crest, flag, stats[], roles[], tiers[],
                      revealed, ownerUid, ownerName, prevDeckId
  players/{p}         name, role, stats{KEY: 1-99}, skin, tag, flag,
                      photoPos, linkedUid, prevOvr, ovrOverride
  photos/{p}          data (webp data URL)
  members/{uid}       name, email, role: viewer | suggester | editor
  suggestions/{s}     pid, key, from, to, note, byUid, byName, status
  history/{h}         pid, pname, key, from, to, kind, byUid, byName, at
```

A stat is `{key, name, invert?}`. A role is `{code, name, weights{KEY: n}}`.
A tier is `{name, min, skin}`.

### Rules of the game (the decisions behind the code)

- **Overall** = weighted average of the stats using the player's role weights
  (default weight 1, weight 0 drops the stat). An `invert` stat counts as
  `100 - value`, so the card shows the raw 90 Lateness but it lowers the
  overall. Clamped 1–99. `ovrOverride` beats everything.
- **Skin**: a skin picked on the player by hand (TOTY, Icon) beats the tier
  skin.
- **Permissions**: non-commissioners can only ever change **stat values**.
  Stat definitions, weights, tiers, players and the reveal are
  commissioner-only. The owner chose this on purpose; don't widen it without
  asking them.
  - Editors: only `stats` + `updatedAt` on a player, and each change writes a
    `history` row that can be undone.
  - Suggesters: create `pending` suggestions; the commissioner accepts or
    rejects them from the Inbox.
  - The friend linked to a card (`linkedUid`) may change that card's name, photo
    and photo position. Nothing else.
  - Signed-in visitors register themselves as `viewer` (`ensureMember`) so the
    commissioner can find and promote them.
- **Hidden until reveal**: while `revealed == false`, the rules block reading
  players, photos and history unless you're a suggester or above. `watchDeck()`
  mirrors this: it re-subscribes when your role or the reveal flag changes.
  Otherwise the listeners would just hit permission errors.
- **New edition** copies config, players and photos into a new deck and stores
  each player's old overall as `prevOvr` so cards show the year-on-year change.
  The deck doc is written in its own batch **before** the players, because
  rules `get()` sees the database as it was before the batch.
- If you change who can write what, change `firestore.rules` **and** the UI
  together. The UI hiding a button is not a security boundary.

### Card look

The card is meant to look very close to a real FUT card. Earlier versions with
a flat gradient and a blob silhouette looked fake. What made it work was
a metallic rare finish, a ray pattern, an embossed double border, heavy type
(Barlow 800, bundled in `assets/fonts/`), and a real cut-out photo. Keep those
when you touch `js/card.js`. The background-removal model is `isnet_fp16`
because `quint8` left speckles around the cut-out.

### Status (as of 2026-10-07)

- v1 is built and `node tools/smoke.cjs` passes in demo mode.
- **Firebase isn't set up yet.** `js/config.js` is still `PASTE_ME`, so the app
  only runs in demo mode (`FIREBASE-SETUP.md` has the steps).
- `firestore.rules` is written but **has never been run** against the
  emulator or a real project. Treat it as untested.
- Not deployed to GitHub Pages yet. The repo is private, and Pages on a
  private repo needs a paid GitHub plan, so deployment is still undecided.

### Working conventions

- Don't add UI nobody asked for (banners, toasts, onboarding strips). Behaviour
  changes stay invisible unless the owner wants them shown.
- Escape all user text with `esc()` before it goes into HTML. Screens are
  built from template strings.
- Forms on the manage/editor pages are built once per route, then only
  refreshed (`builtKey` in `app.js`), so a live Firestore update doesn't wipe
  what someone is typing. Keep that in mind when adding fields.
- Run the smoke test after changes: `node serve.cjs` in one terminal,
  `node tools/smoke.cjs` in another (needs Chrome installed).
