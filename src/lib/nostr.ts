/**
 * Nostr layer: identity, relay pool, publish and query.
 *
 * Identity is a locally generated keypair with no kind-0 profile ever
 * published. The pubkey is still visible on every relay — this is
 * pseudonymity, not anonymity — so `rotateIdentity()` exists and the UI
 * must be honest about what rotation costs (your claim history).
 */

import {
	SimplePool,
	generateSecretKey,
	getPublicKey,
	finalizeEvent,
	type Event,
	type EventTemplate,
	type Filter
} from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/** Addressable event kind for a vegan product claim. */
export const KIND_CLAIM = 30301;

export const DEFAULT_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band',
	'wss://nostr.mom'
];

const SK_STORAGE_KEY = 'isitvegan.sk';

let _sk: Uint8Array | null = null;
let _pool: SimplePool | null = null;

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/**
 * Key storage.
 *
 * localStorage is all a PWA gets — there is no secure enclave available
 * from the web, so the key is readable by any script on this origin.
 * That is an accepted risk for a £1 contributor key and would not be for
 * anything holding funds. On iOS it is also subject to 7-day eviction,
 * which is why backup.ts exists.
 */
export interface KeyStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
}

const store: KeyStore = {
	async get(k) {
		return typeof localStorage === 'undefined' ? null : localStorage.getItem(k);
	},
	async set(k, v) {
		if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
	},
	async remove(k) {
		if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
	}
};

/**
 * Does this device already hold a key? Read paths must never call
 * `getIdentity()` just to check, because that would mint one.
 */
export async function hasIdentity(): Promise<boolean> {
	return _sk !== null || (await store.get(SK_STORAGE_KEY)) !== null;
}

/**
 * Load the existing key, minting one on first call.
 *
 * Deliberately lazy. Reading the dataset — scanning, resolving, browsing
 * history — needs no key at all, so a free user never gets one and has
 * nothing to back up. The key is created at the moment someone unlocks
 * contributing, which is also the moment the backup prompt makes sense.
 */
export async function getIdentity(): Promise<{ sk: Uint8Array; pk: string }> {
	if (!_sk) {
		const stored = await store.get(SK_STORAGE_KEY);
		if (stored) {
			_sk = hexToBytes(stored);
		} else {
			_sk = generateSecretKey();
			await store.set(SK_STORAGE_KEY, bytesToHex(_sk));
		}
	}
	return { sk: _sk, pk: getPublicKey(_sk) };
}

/**
 * Replace the stored key, clearing the in-memory cache.
 *
 * The cache clear is the whole point: writing to storage alone leaves
 * `_sk` holding the OLD key for the rest of the session, so a restore
 * would appear to succeed while every event still got signed with the
 * key the user was trying to replace.
 */
export async function setIdentity(sk: Uint8Array): Promise<{ pk: string }> {
	await store.set(SK_STORAGE_KEY, bytesToHex(sk));
	_sk = sk;
	return { pk: getPublicKey(sk) };
}

/**
 * Discard the current key and mint a new one.
 *
 * Destructive: previously published claims stay on relays forever under
 * the old pubkey, but this device can no longer edit or replace them.
 * Warn the user before calling.
 */
export async function rotateIdentity(): Promise<{ pk: string }> {
	await store.remove(SK_STORAGE_KEY);
	_sk = null;
	const { pk } = await getIdentity();
	return { pk };
}

/* ------------------------------------------------------------------ */
/* Relay pool                                                          */
/* ------------------------------------------------------------------ */

export function pool(): SimplePool {
	if (!_pool) _pool = new SimplePool();
	return _pool;
}

export function closePool() {
	_pool?.close(DEFAULT_RELAYS);
	_pool = null;
}

/** Fetch every claim event for a given barcode, across all relays. */
export async function fetchClaims(
	barcode: string,
	relays: string[] = DEFAULT_RELAYS,
	timeoutMs = 4000
): Promise<Event[]> {
	const filter: Filter = { kinds: [KIND_CLAIM], '#d': [barcode], limit: 200 };
	return collect(filter, relays, timeoutMs);
}

async function collect(filter: Filter, relays: string[], timeoutMs: number): Promise<Event[]> {
	const seen = new Map<string, Event>();
	return new Promise((resolve) => {
		const sub = pool().subscribeMany(relays, [filter], {
			onevent(ev) {
				seen.set(ev.id, ev);
			},
			oneose() {
				/* keep collecting until the timeout — relays EOSE at different times */
			}
		});
		setTimeout(() => {
			sub.close();
			resolve([...seen.values()]);
		}, timeoutMs);
	});
}

/** Sign and publish a claim. Resolves once at least one relay accepts. */
export async function publish(
	template: EventTemplate,
	relays: string[] = DEFAULT_RELAYS
): Promise<Event> {
	const { sk } = await getIdentity();
	const signed = finalizeEvent(template, sk);
	const results = pool().publish(relays, signed);
	await Promise.any(results).catch(() => {
		throw new Error('No relay accepted the claim. Check your connection and try again.');
	});
	return signed;
}
