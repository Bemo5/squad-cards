# Firebase setup

Until this is done the app runs in **demo mode**: it works, but everything lives
in one browser and a link shows nobody else anything. About 5 minutes.

## 1. Create the project

console.firebase.google.com > **Add project** > name it `squad-cards`.
Google Analytics: **off**.

> Use a new project, not Filmroom's. Publishing rules replaces a project's whole
> ruleset, so sharing one would break Filmroom the first time you publish these.

## 2. Firestore

**Build > Firestore Database > Create database.**
Mode: **production**. Location: `europe-west1` or `europe-west3` (can't be
changed later).

## 3. Google sign-in

**Build > Authentication > Get started > Sign-in method > Google > Enable**, pick
your support email, save.

Then **Authentication > Settings > Authorized domains > Add domain** and add
`bemo5.github.io` (or wherever the site ends up). Without this the sign-in popup
fails with `auth/unauthorized-domain`. `localhost` is there by default.

## 4. Rules

**Firestore Database > Rules**: replace everything with `firestore.rules` from
this folder, then **Publish**. These are what keep hidden cards hidden until the
reveal and stop friends from editing more than you allowed.

## 5. Paste the config

**Project settings** (gear) > **General** > **Your apps** > the `</>` icon >
register a web app called `squad-cards` (no hosting). Copy the `firebaseConfig`
values into `js/config.js`.

These values are public by design (they ship inside every web page). The rules
are the protection.

## 6. Check it

Open the site, sign in, make a deck. Open the deck link in a private window:
before you reveal it you should see the countdown, not the cards.

Note: decks made in demo mode stay in that browser. They don't move to Firebase.
