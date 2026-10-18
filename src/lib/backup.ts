/**
 * Identity backup and restore.
 *
 * This exists because of a specific iOS behaviour, and it is not
 * optional on that platform:
 *
 *   Safari evicts all script-writable storage — localStorage,
 *   IndexedDB, the lot — after 7 days without the site being used.
 *   Adding the PWA to the home screen exempts it, but a user who
 *   visits in a browser tab and comes back a fortnight later will
 *   find their key gone, their contribution history orphaned and
 *   their £1 unlock lost.
 *
 * So: prompt for a backup the moment someone unlocks contributing,
 * and make restore a first-class flow, not a buried setting.
 */

import { nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import { getIdentity, setIdentity } from './nostr';
import { canContribute } from './entitlement';

export interface Backup {
	/** Bech32 nsec. Treat as a password — it IS the account. */
	nsec: string;
	npub: string;
	exportedAt: string;
}

/** Produce a backup payload for display, copy or download. */
export async function exportIdentity(): Promise<Backup> {
	const { sk, pk } = await getIdentity();
	return {
		nsec: nip19.nsecEncode(sk),
		npub: nip19.npubEncode(pk),
		exportedAt: new Date().toISOString()
	};
}

/** Offer the backup as a downloaded file. */
export async function downloadBackup(): Promise<void> {
	const b = await exportIdentity();
	const body = [
		'IsItVegan identity backup',
		'',
		'KEEP THIS SECRET. Anyone with the key below can publish claims as you.',
		'',
		`Public key:  ${b.npub}`,
		`Private key: ${b.nsec}`,
		`Exported:    ${b.exportedAt}`,
		'',
		'To restore: open IsItVegan, go to Settings, choose Restore identity,',
		'and paste the private key.'
	].join('\n');

	const blob = new Blob([body], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `isitvegan-key-${b.npub.slice(0, 12)}.txt`;
	a.click();
	URL.revokeObjectURL(url);
}

export class InvalidKeyError extends Error {
	constructor(msg = 'That is not a valid private key.') {
		super(msg);
		this.name = 'InvalidKeyError';
	}
}

/**
 * Restore from an nsec or raw hex key.
 *
 * Destructive: replaces the current identity. The caller must confirm
 * first, and should mention that any unbacked-up current key is gone.
 */
export async function restoreIdentity(input: string): Promise<{ npub: string }> {
	const trimmed = input.trim();
	let sk: Uint8Array;

	if (trimmed.startsWith('nsec1')) {
		try {
			const decoded = nip19.decode(trimmed);
			if (decoded.type !== 'nsec') throw new InvalidKeyError();
			sk = decoded.data as Uint8Array;
		} catch {
			throw new InvalidKeyError('That nsec could not be decoded — check for typos.');
		}
	} else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
		sk = hexToBytes(trimmed.toLowerCase());
	} else if (trimmed.startsWith('npub1')) {
		throw new InvalidKeyError(
			'That is a public key (npub). You need the private key, which starts with nsec1.'
		);
	} else {
		throw new InvalidKeyError();
	}

	// Goes through setIdentity so the in-memory key is replaced too, not
	// just the stored one.
	const { pk } = await setIdentity(sk);
	return { npub: nip19.npubEncode(pk) };
}

/* ------------------------------------------------------------------ */
/* Storage durability                                                  */
/* ------------------------------------------------------------------ */

/**
 * Ask the browser to make storage persistent, which exempts the origin
 * from eviction. Chrome grants it on installed PWAs and engaged sites;
 * Safari does not implement it at all, which is exactly why the backup
 * flow above has to exist.
 */
export async function requestPersistence(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
	try {
		if (await navigator.storage.persisted()) return true;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

export function isIOS(): boolean {
	if (typeof navigator === 'undefined') return false;
	return (
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
}

export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	return (
		window.matchMedia?.('(display-mode: standalone)').matches ||
		(navigator as any).standalone === true
	);
}

/**
 * True when this user is in the danger zone: iOS, in a browser tab
 * rather than installed, AND holding something worth losing.
 *
 * The entitlement check is the important clause. A free reader has no
 * key worth protecting — losing their storage costs them a cached
 * product list they can re-fetch in a second. Nagging them about
 * backups would be noise, and worse, it would make a free app feel
 * like it demands setup. Only contributors, who have paid and have a
 * publishing history bound to their pubkey, ever see the warning.
 */
export function atRiskOfKeyLoss(): boolean {
	return canContribute() && isIOS() && !isStandalone();
}
