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
node serve.cjs            # http://127.0.0.1:8125
node tools/smoke.cjs      # end-to-end check in demo mode (needs the server)
node tools/photo-check.cjs  # runs the real photo cut-out (needs internet)
```

Photos are stored as small webp data URLs in Firestore (no Firebase Storage,
which needs a paid plan). The cut-out model (~80 MB, `isnet_fp16`) downloads
from a CDN the first time someone adds a photo, then the browser caches it.
