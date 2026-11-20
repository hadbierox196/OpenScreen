# Firebase setup (one time, free Spark plan, about 10 minutes)

The app stays local-first: nothing is uploaded until someone presses **Create team**, **Join** or **Sync**.
When the lead finishes a project, its data is deleted from Firebase.

1. https://console.firebase.google.com > **Add project** (Analytics not needed).
2. **Build > Firestore Database > Create database** (production mode, any region near your team).
3. **Build > Authentication > Get started > Sign-in method > Anonymous > Enable.**
   (Reviewers never create accounts; each browser gets an anonymous id.)
4. **Firestore > Rules**: paste the contents of `firebase/firestore.rules` and **Publish**.
5. **Project settings > General > Your apps > Web (`</>`)**: register an app, copy the config values.
6. Copy `.env.example` to `.env` and fill in the four values, then `npm run build` and deploy `dist/`
   (Vercel, Netlify, GitHub Pages...). On Vercel/Netlify set the same four `VITE_FIREBASE_*` variables in the project settings.
7. **Authentication > Settings > Authorized domains**: add the domain you deployed to.

## How it works
- Lead: import and dedupe locally > **Team > Create team & upload** > share the invite link (`https://your.app/#team=<id>.<key>`).
- Reviewer: open the link, type a name, join. The records download once; everything after is local.
- **Sync now** uploads your changed decisions and downloads your teammates' (only what changed since last time).
- Lead: **Finish & remove from server** does a last sync, downloads `screened.csv` (all reviewers), deletes all team data and leaves a ~100-byte "finished" marker so late reviewers see a clear message.

## Data on the server (per team)
`teams/{id}` settings, `members/*`, `project/c*` (records without raw text, about 600 KB per document), `dec/{uid}_{bucket}` (each reviewer's decisions, 16 buckets) and `dec/{uid}_res` (conflict resolutions).

## Limits and notes
- Free-plan quotas (check the Firebase pricing page, they can change): about 1 GiB stored, 50k reads and 20k writes per day. A team of a few reviewers uses a tiny fraction. Security rules add roughly one extra read per request.
- **The lead's rights live in the lead's browser** (an anonymous account). Keep that browser's data, and do not use "clear site data". Opening the invite on another device joins as a normal reviewer.
- Anyone holding the invite link can join and read the project. Share it only with your team. Removing one person is not supported; finish the project instead.
- The Firebase config values are public by design. Security comes from the rules, not from hiding them. Anyone can sign in anonymously to your Firebase project, so a determined stranger could create teams and use up your free quota; if that worries you, turn on **App Check**.
- Rules were written carefully but not run against the emulator here. Test with two browsers (lead and reviewer) before real use, and try the Firebase **Rules playground**.
