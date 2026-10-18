# IsItVegan

Scan a barcode, find out whether the product is vegan. Crowd-sourced, stored on Nostr, **free to read**.

A PWA — one codebase, one URL, Android and iOS contributing to the same dataset. No app stores, no install friction, no 30% cut on the £1.

## How it works

1. **Scan** a barcode in the shop.
2. The app queries Nostr relays for claims about that barcode.
3. A **rules engine** reads the ingredients list; **agreement across independent contributors** adjusts confidence around it.
4. If nobody has it yet, Open Food Facts prefills a form — you confirm against the actual pack, then publish.

### Why Nostr and not Blossom for the data

Blossom is content-addressed blob storage. You can fetch a file by its sha256 hash, but you cannot ask it "give me barcode 5000112637922" — there is no query. So:

- **Nostr relays** hold the product claims (queryable by tag)
- **Blossom** holds product photos only

## Data model

One addressable event per **claim**, not per product:

```
kind: 30301
tags:
  ["d",     "5000112637922"]   # barcode = identifier
  ["name",  "Oat Drink Barista"]
  ["brand", "Oatly"]
  ["v",     "vegan"]           # vegan | not-vegan | unclear
  ["img",   "<blossom-url>", "<sha256>"]
  ["why",   "contains vitamin D3"]
  ["src",   "label"]           # label | off | manufacturer
content: {"ingredients": "...", "note": "..."}
```

Because `d` is replaceable **per author**, every contributor owns their own claim. Nobody can overwrite anyone else's, so the dataset is effectively append-only and cannot be vandalised by a single bad actor. Clients fetch all claims for a barcode and compute consensus locally.

## Verdict resolution

The ingredients list is the anchor of truth, not the vote count:

- A hard ingredient hit (gelatine, whey, carmine…) wins outright. Three hundred people voting "vegan" on a product whose label lists gelatine does not make it vegan — it raises a **conflict** flag instead, since the recipe may have changed.
- Otherwise contributor agreement decides, with the rules engine adding or removing confidence.
- **"Unclear" is a real answer.** E471 genuinely may be plant or animal; saying so is more useful than guessing.

Confidence saturates: five independent keys is good evidence, fifty is not ten times better.

## Platform notes

### Installing

Reading never requires installation. A shared link has to open straight into an answer — someone texting "is this vegan?" to a friend is the main way this app spreads, and a wall in front of that closes the loop off.

`InstallPrompt.svelte` appears at one place only: the paywall, just before someone pays and receives a key worth protecting. It's a suggestion with a visible "continue without installing", and it renders nothing at all when the browser can't install (Firefox, in-app browsers) or already has.

- **Chromium** — `beforeinstallprompt` gives one-tap install
- **iOS Safari** — no programmatic install exists, so the Share → Add to Home Screen flow is spelled out

### iOS storage eviction

Safari deletes all script-writable storage after **7 days** without the site being used. Home-screen install exempts it, which is why contributors are nudged to install and free readers aren't — a reader losing their cache re-fetches it in a second.

Keys are generated **lazily**, at unlock, not at first launch. A free reader never has one, so there is nothing to back up and no nagging — losing their storage costs them a cached list they re-fetch in a second. Contributors get the key handed to them immediately after payment, with a forced "I've saved it" confirmation before they can continue.

`requestPersistence()` works on Chrome and does nothing on Safari, which is why the backup flow is mandatory rather than nice-to-have.

### Barcode scanning

Two paths, because support is split:

| | BarcodeDetector | ZXing (WASM) |
|---|---|---|
| Chrome/Edge, Android + desktop | ✅ native, fast | fallback |
| Safari, iOS + macOS | ❌ not implemented | ✅ only option |

`src/lib/scanner.ts` picks automatically. Both need **HTTPS** — getUserMedia refuses on plain HTTP, localhost excepted. There's a still-photo path (`decodeImage`) using `capture="environment"` for damaged labels and for users who declined camera permission.

### Other iOS gaps worth knowing

- Push notifications need iOS 16.4+ **and** home-screen install
- No background sync, so the offline publish queue drains on app resume
- `playsinline` is set on the video element or iOS hijacks it fullscreen

## The £1 unlock

Free to read. £1 once to contribute.

Reading must never cost anything — someone stood in a supermarket checking a jar of pesto should not hit a paywall. The £1 gates **publishing**, which is the only surface spam can use.

Being a PWA helps here: no Apple IAP requirement, no Play Billing, no 30%. A Lightning invoice or a Stripe payment link both work, and `PaymentProvider` in `src/lib/entitlement.ts` takes either.

Spam defence in the meantime is client-side: `consensus.ts` drops links, floods, future timestamps and duplicate keys, and users can hide a contributor outright from the product screen. Hiding is local to the device and never deletes anything from Nostr.

> **Enforcement caveat, read before shipping.** `entitlement.ts` is the *client half* of the gate. Relays are public, so a spammer can publish kind-30301 events from any Nostr client and never run this code. To make the £1 bite, the relay must refuse writes from unpaid pubkeys (NIP-11 `limitation.payment_required`). Until then the gate is a speed bump, and `src/lib/consensus.ts` is doing the real anti-spam work client-side.

## Layout

```
src/lib/
  ingredients.ts   rules engine — ~70 rules, E-numbers, exception masking
  consensus.ts     spam filtering + blended verdict resolution
  nostr.ts         identity, relay pool, publish/query
  product.ts       claim model, event encode/decode, barcode validation
  scanner.ts       BarcodeDetector + ZXing fallback, still-photo decode
  backup.ts        key export/restore, iOS eviction detection
  blossom.ts       photo upload, downscaling, hash verification
  openfoodfacts.ts unknown-barcode prefill (ODbL — attribute in UI)
  cache.ts         IndexedDB: offline reads + pending-publish queue
  contribute.ts    entitlement check → publish → queue on failure
  entitlement.ts   the £1 unlock, pluggable payment provider
  lookup.ts        scan orchestration, yields cache → relays → OFF
  components/
    VerdictCard.svelte   result display, confidence as pips not percentages
    ClaimList.svelte     per-contributor claims with a per-device Hide control
    InstallPrompt.svelte non-blocking install nudge, shown at the paywall
src/routes/
  +layout.svelte         nav, offline queue drain, iOS key warning
  +page.svelte           scanner
  product/[barcode]/     result, ingredients, rule hits
  add/[barcode]/         paywall → key backup → claim form
  history/               offline-readable scan history
  settings/              key management, restore, theme
src/app.css              design tokens (dark-first, light mode)
src/service-worker.ts
static/manifest.webmanifest
tests/core.test.ts
.github/workflows/deploy.yml
```

## Deploying

Push to `main` and GitHub Pages serves it. Fully static — no server, nothing to run, nothing to pay for.

The workflow sets `BASE_PATH` automatically for project pages and copies `index.html` to `404.html` so deep links resolve. Point a custom domain at it and drop the `BASE_PATH` line.

Pages gives you HTTPS, which the camera requires.

## Safety note

This is crowd-sourced data about food. Anyone with an allergy — as opposed to an ethical preference — should read the physical label, and the app should say so plainly on every "unclear" result. A wrong answer here has real consequences, which is why the rules engine refuses to guess.

## Licence

Code: MIT. Product data published to Nostr is public by nature. Open Food Facts content is ODbL.
