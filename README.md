# dida-lists

Rokid Glasses (RV101) app that reads the wearer's Dida365 (滴答清单) tasks
directly and shows them on the monochrome green display.

The app talks to the Dida365 Open API from the glasses — no server in the
middle. `lib/secret.js` holds the access token and is filled in by
`inject_token.sh` at build time.
