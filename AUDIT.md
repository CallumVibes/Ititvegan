# Audit — IsItVegan

Date: 2026-10-18. Covers `src/`, `tests/`, `static/`, build config.

Caveat up front: `npm` has no registry access in this sandbox, so `svelte-check`, `vitest` and `vite build` have **not** been run. Everything below is from reading the code and reasoning about runtime behaviour. The first CI run is still the real verification.

---

## Bugs fixed

### 1. Offline scan wiped a known product and asked for money — serious

`lookup.ts`. `fetchClaims` never rejects: `collect()` resolves after a timeout whether or not any relay answered. So the `catch` was dead code, and an offline device always fell through to the "nothing on file" branch.

Result: scan a product you'd scanned before, with no signal, and the cached verdict got replaced by "Nobody has scanned this product yet" plus a £1 contribute prompt — for a product already in the database. Wrong answer and a false charge prompt, in a supermarket, which is the exact situation the app exists for.

Fixed by tracking `hadCache` and returning early rather than downgrading a good answer to an empty one.

### 2. Key restore silently did nothing

`backup.ts` wrote the new key to localStorage, but `nostr.ts` caches the key in a module-level `_sk`. Nothing cleared it. The function returned the restored npub (computed locally, so it looked right) while every subsequent event was still signed with the **old** key.

A contributor restoring on a new device would have published under an identity they thought they'd replaced, silently, until a page reload. Fixed with a new `setIdentity()` that writes storage and the cache together.

### 3. ZXing kept decoding forever on iOS

`scanner.ts`. `decodeFromVideoElement` returns a controls handle that was being dropped, so stopping the scanner killed the camera track but left ZXing's decode loop running against a dead stream — invisible, permanent CPU burn on the one platform where ZXing is the only option and battery is already the cost of using it. Now captured and stopped, including the race where stop happens during setup.

### 4. Detection ran at 60fps

Same file. `requestAnimationFrame` called `detector.detect()` every frame. Barcodes don't move 60 times a second. Throttled to ~12fps — meaningfully less heat in the hand.

### 5. Double-publishing from the offline queue

`contribute.ts`. The layout fires `flushQueue()` on both `online` and `visibilitychange`, which routinely land together. Two passes raced the same queue. Added a re-entrancy guard.

### 6. PWA install would have failed

`static/icons/` did not exist, while the manifest referenced three files in it. Install prompts fail or show a blank icon when manifest icons 404. Generated the set (192, 512, maskable 512, apple-touch, favicon) and pointed `app.html` at the right ones.

### 7. `User-Agent` header was theatre

`openfoodfacts.ts` set a `User-Agent` on `fetch`. It's a forbidden header name — browsers drop it silently. Moved identification into the query string, which OFF also accepts.

### 8. `onMount(start)` broke the cleanup contract

`+page.svelte`. `onMount` treats a returned value as its cleanup function; an async function returns a Promise. Wrapped it.

---

## Dead code removed

| Symbol | File | Why |
|---|---|---|
| `verify()` | `blossom.ts` | No callers. Would have re-downloaded the image to check its hash. |
| `searchProducts()` | `nostr.ts` | No callers — no search UI exists. |
| `fetchMyClaims()` | `nostr.ts` | No callers — no "my contributions" screen. |
| `setKeyStore()` | `nostr.ts` | Became unreachable once restore went through `setIdentity`. Its doc comment still promised Capacitor Secure Storage, which left with the native wrapper. |

`block()`/`unblock()` in `cache.ts` were **kept** despite having no UI — see below.

---

## Still outstanding

### Dishonest surfaces

~~**The blocklist has no way in.**~~ **Fixed.** `ClaimList.svelte` now lists every contributor on the product screen with a Hide control, with undo. Blocking re-resolves locally from `accepted + rejected` rather than refetching, so it is instant and works with no signal — which matters, because the moment you want to silence a bad contributor is the moment you are looking at their claim. Hiding is per-device only: a pseudonymous crowd-sourced dataset with a crowd-operated delete button is a dataset one angry person can empty.

~~**`resolution.rejected` is computed and thrown away.**~~ **Partly fixed.** The hidden count is now shown on the contributors row. Individual rejection reasons stay internal.

### Missing for a polished release — all now done

- ~~No error boundary.~~ `+error.svelte` added, distinguishing a 404 from a crash. The error message is shown rather than hidden: nothing is logged anywhere, so the person reporting it is the only source of detail.
- ~~No empty state on Settings.~~ Free readers now get a short explanation of what contributing is, instead of a Status/Public key table full of blanks describing something they never asked for.
- ~~No "update available" prompt.~~ Added, driven by SvelteKit's `updated` store — which also needed `version.pollInterval` in the config, without which the store never fires and the prompt would have been dead code. Suppressed on the scanner, where a banner would push the full-bleed stage off screen.
- ~~History never prunes.~~ Capped at 1000 products, trimming oldest-first down to 900. Hysteretic on purpose: pruning to the cap would make every subsequent scan trigger another prune. The reasoning is that an unbounded IndexedDB eventually gets the whole origin evicted, losing the contributor key too — a trimmed cache is one relay query from coming back, a lost key is not.
- ~~No robots.txt or Open Graph tags.~~ Both added, with a generated 1200×630 card.
- ~~Barcode checksum rejects valid codes.~~ Split by source: camera reads still require mod-10, since a misread silently looking up the wrong product is worse than asking again; typed codes need only the right length, since in-store and own-brand items legitimately fail the checksum.

### Known-weak by design, flagged again

The £1 gate is still client-side only. `consensus.ts` is doing all the real anti-spam work, and its heuristics (link detection, flood counts, one-claim-per-key) are shallow — they stop lazy spam, not a patient adversary. Relay-side `payment_required` remains the only thing that actually makes spam cost money.

---

## Verified sound

- Barcode check digit maths is correct for EAN-8, EAN-13 and GTIN-14 (weights verified by hand against each length).
- All local imports resolve to real exports.
- Keys are never minted on read paths — `hasIdentity()` is used correctly everywhere a key is checked rather than needed.
- Sensitive-ish ordering in `consensus.ts` is right: a hard ingredient hit beats vote count, which is the property the whole product rests on.
- No `innerHTML` anywhere; all relay-sourced strings go through Svelte's escaping, and `fromEvent` clamps lengths and validates shape.
