# Setting up IsItVegan

Everything here is phone-doable. No local toolchain — GitHub Actions builds and deploys it.

## 1. Create the repo

On github.com (mobile browser works fine):

1. New repository → name it `isitvegan` → **Public** → don't add a README (one's included)
2. Open the new empty repo → **Add file** → **Upload files**
3. Upload the contents of `isitvegan.zip`

Uploading a folder on mobile is awkward. Two options:

- **Easier:** use the GitHub mobile app or a file manager that can unzip, then upload folder by folder
- **Cleaner:** on a desktop once, `git clone`, unzip in, `git add -A && git commit && git push`

The folder structure must be preserved — `src/lib/*.ts`, `src/routes/*.svelte`, `static/*` etc. all need to land in the right places.

## 2. Turn on Pages

Repo → **Settings** → **Pages** → Source: **GitHub Actions**

That's the only setting. Don't pick "Deploy from a branch" — the workflow handles it.

## 3. Push

Any push to `main` triggers `.github/workflows/deploy.yml`, which:

1. Installs dependencies
2. Runs `svelte-check` (type checking)
3. Runs the test suite
4. Builds the static site
5. Deploys to Pages

**The first run will probably fail.** Nothing in this repo has been compiled — npm couldn't reach the registry in the environment it was written in, so `svelte-check` and `vitest` have never actually run. Expect type errors on the first go. Open the failed run, read the error, fix, push again. Paste the log to me and I'll fix them.

## 4. Your URL

Once green: `https://<your-username>.github.io/isitvegan`

The workflow sets `BASE_PATH` automatically for project pages. If you later point a custom domain at it, delete the `BASE_PATH` line from `deploy.yml`.

Pages gives you HTTPS, which `getUserMedia` requires — the camera will not work without it.

---

## What to do before telling anyone about it

### Required

**Wire up payment.** `src/lib/entitlement.ts` currently uses `StubProvider`, which unlocks instantly and charges nothing. Shipping as-is means contributing is free. Implement `PaymentProvider` with Lightning (LNbits/LNURL) or a Stripe payment link.

**Decide about the relay.** The £1 gate is client-side only. A spammer can publish kind-30301 events from any Nostr client without touching your code. Either run a relay that requires payment for write access (NIP-11 `payment_required`), or accept that `consensus.ts` filtering is all you have.

### Worth doing

**Replace the icons.** `static/icons/*` are generated placeholders — scanner brackets on orange. Fine, not distinctive.

**Seed some products.** An empty database is a bad first impression. Scan fifty things from your own cupboards before sharing the link.

**Test on a real iPhone.** The ZXing fallback path has never run on actual hardware. It's the thing most likely to be subtly broken.

---

## Where things live

| You want to change | File |
|---|---|
| Which ingredients are flagged | `src/lib/ingredients.ts` |
| How verdicts get decided | `src/lib/consensus.ts` |
| Colours, spacing, fonts | `src/app.css` |
| The £1 price or payment | `src/lib/entitlement.ts` |
| Which relays are used | `src/lib/nostr.ts` (`DEFAULT_RELAYS`) |
| Which Blossom servers | `src/lib/blossom.ts` |

`AUDIT.md` lists what was fixed and what's known-weak. `README.md` has the architecture and the reasoning behind the data model.

## Local development, if you ever want it

```
npm install
npm run dev -- --host
```

The camera needs HTTPS, so testing scanning on a phone against a laptop dev server needs a tunnel (Tailscale, ngrok) rather than a bare LAN address.
