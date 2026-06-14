# Longway Implementation Plan

- [x] Configure Worker vars, D1 binding, cron, and dependencies
- [x] Add D1 migrations for cars, daily cycles, ride offers, requests, and events
- [x] Implement tested carpool domain rules and rendering helpers
- [x] Implement Discord interaction verification and routing
- [x] Implement slash commands: register, edit, delete, start board
- [x] Implement board, ride card, request, manage, cancel flows
- [x] Add command registration script and setup docs
- [x] Run tests, typecheck, and strict code quality review

## Review

- Implemented Discord HTTP interactions Worker with D1-backed carpool state.
- Added 6 PM to 7 AM IST offer/request window, with cron at 6 PM board creation and 7 AM close.
- Added ride setup lifecycle with `creating -> active/failed` so failed setup does not block retries.
- Added partial uniqueness for active direction requests and active/creating offers only.
- Added best-effort Discord projection refresh and notifications after committed DB mutations.
- Verification: `npm test`, `npm run typecheck`, `npm run cf-typegen`, final SQL syntax validation, and thermo-nuclear blocker review passed.
- Weekend window update: new offers/requests stay open from Friday 6:00 PM IST through Monday 7:00 AM IST on a single Friday cycle board.
- Production fix: ride offers now create standalone public threads instead of message-attached threads, avoiding Discord error `160004` after the first ride.
- Public release prep: README now includes end-to-end setup for new deploys, and the unused `TIMEZONE` binding was removed from runtime config.
- Public release hardening: Discord app/channel bindings were removed from `wrangler.jsonc` and documented as deployment checklist items instead.
- Remaining risk: `npm audit --omit=dev` reports `esbuild` through Wrangler; safe audit fix is unavailable without a breaking Wrangler downgrade.
