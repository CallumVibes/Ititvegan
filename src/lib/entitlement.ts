/**
 * Contributor entitlement — the £1 one-time unlock.
 *
 * Scanning, reading and resolving are free and always will be: someone
 * stood in a shop checking a jar of pesto must never hit a paywall.
 * The £1 buys the right to PUBLISH claims, which is the only surface
 * spam can actually use.
 *
 * ---------------------------------------------------------------
 * IMPORTANT, and the reason this file is written the way it is:
 *
 * A client-side gate is honour-system only. The relays are public, so
 * a determined spammer can publish kind-30301 events with any Nostr
 * client and never see this code. Enforcement has to happen where the
 * write lands — the relay must refuse events from pubkeys that have
 * not paid (NIP-11 `limitation.payment_required`).
 *
 * This module is therefore the *client half* of that contract: it
 * tracks entitlement, drives the UI, and attaches proof to publishes.
 * `RelayAuthProvider` below is the hook for the relay-side half.
 * Until that exists, treat the gate as a speed bump, not a wall.
 * ---------------------------------------------------------------
 */

export type EntitlementState = 'unknown' | 'locked' | 'pending' | 'unlocked';

export interface Entitlement {
	state: EntitlementState;
	/** Opaque proof to present to the relay. Provider-specific. */
	proof?: string;
	/** Unix ms. */
	grantedAt?: number;
	/** Human-readable provider name, for the receipts screen. */
	via?: string;
}

/**
 * Pluggable payment backend.
 *
 * Implementations to come: `LightningProvider` (LNbits or LNURL — the
 * relay issues an invoice bound to your pubkey and admits you on
 * settlement) and `PlayBillingProvider` (Google Play one-time product,
 * for users who want a card rather than sats).
 */
export interface PaymentProvider {
	readonly name: string;
	/** Price in pence, so the UI never hardcodes "£1". */
	readonly pricePence: number;
	/** Begin a purchase. Resolves when the user has paid or cancelled. */
	purchase(pubkey: string): Promise<Entitlement>;
	/** Re-check with the backend, e.g. after a reinstall. */
	restore(pubkey: string): Promise<Entitlement>;
}

/**
 * Development stub. Unlocks instantly, charges nothing, and marks the
 * entitlement clearly so it can never be mistaken for a real one.
 */
export class StubProvider implements PaymentProvider {
	readonly name = 'Stub (development)';
	readonly pricePence = 100;

	async purchase(): Promise<Entitlement> {
		return { state: 'unlocked', proof: 'stub', grantedAt: Date.now(), via: this.name };
	}

	async restore(): Promise<Entitlement> {
		return { state: 'locked' };
	}
}

const STORAGE_KEY = 'isitvegan.entitlement';

let provider: PaymentProvider = new StubProvider();

export function setPaymentProvider(p: PaymentProvider) {
	provider = p;
}

export function getPaymentProvider(): PaymentProvider {
	return provider;
}

/** Format the price for display. Never hardcode the string in the UI. */
export function priceLabel(): string {
	const p = provider.pricePence;
	return p % 100 === 0 ? `£${p / 100}` : `£${(p / 100).toFixed(2)}`;
}

export function load(): Entitlement {
	if (typeof localStorage === 'undefined') return { state: 'unknown' };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { state: 'locked' };
		const parsed = JSON.parse(raw) as Entitlement;
		return parsed.state === 'unlocked' ? parsed : { state: 'locked' };
	} catch {
		return { state: 'locked' };
	}
}

function save(e: Entitlement) {
	if (typeof localStorage !== 'undefined')
		localStorage.setItem(STORAGE_KEY, JSON.stringify(e));
}

export function canContribute(): boolean {
	return load().state === 'unlocked';
}

/**
 * Run the purchase flow and persist the result.
 *
 * This is the point at which the user's key comes into existence — the
 * caller should follow a successful unlock straight into the backup
 * screen, because from here on there is something to lose.
 */
export async function unlock(pubkey: string): Promise<Entitlement> {
	const result = await provider.purchase(pubkey);
	if (result.state === 'unlocked') save(result);
	return result;
}

/**
 * Restore a previous purchase — new phone, reinstall, or key rotation.
 *
 * Note the wrinkle: entitlement is bound to the *pubkey*, so rotating
 * your key also drops your entitlement. The rotation confirmation
 * screen must say so plainly, or people will lose their £1 and
 * rightly be annoyed.
 */
export async function restore(pubkey: string): Promise<Entitlement> {
	const result = await provider.restore(pubkey);
	if (result.state === 'unlocked') save(result);
	return result;
}
