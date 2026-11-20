# Google Sheet backend (works on Android / iOS / any browser)

One-time setup by the lead reviewer (about 3 minutes, no coding):

1. Create a new Google Sheet. **Extensions > Apps Script**, replace the contents with `Code.gs`.
2. Select `setup` in the toolbar and press **Run**; approve the permissions. The log shows your **token** (also under the new **OpenScreen** menu in the sheet).
3. **Deploy > New deployment > Web app**: *Execute as: Me*, *Who has access: Anyone*. Copy the **/exec URL**.
4. Send reviewers the URL + token. In OpenScreen: **Team > Live: Google Sheet > Connect**.
5. The lead imports records, creates the work plan, and presses **Publish project**. Others connect and join automatically.

Results: sheet **Decisions** (one clean row per record x reviewer) and **Summary** (one row per record, a column per reviewer, Final, Status).
Download CSV via *File > Download > Comma-separated values* on either tab.

Security: anyone holding URL + token can read and write the project, so share them only with your team. To rotate the token, delete the `TOKEN` script property and run `setup` again.
