/**
 * The contribute path: entitlement check → publish → offline queue.
 *
 * Kept separate from nostr.ts so the gate cannot be bypassed by
 * accident: UI code calls `submitClaim`, never `publish` directly.
 */

import { publish, getIdentity } from './nostr';
import { toEventTemplate, type Claim } from './product';
import { canContribute } from './entitlement';
import { queueClaim, pending, dequeue, markAttempt } from './cache';

export class NotEntitledError extends Error {
	constructor() {
		super('Contributing requires the one-time unlock.');
		this.name = 'NotEntitledError';
	}
}

export interface SubmitResult {
	status: 'published' | 'queued';
	/** Event id when published. */
	id?: string;
}

/**
 * Publish a claim, or queue it if the network is unavailable.
 *
 * Queuing on failure rather than erroring is deliberate: the usual
 * failure case is a user in a supermarket with no signal, and losing
 * their typed-out ingredients list would be the worst possible
 * outcome for a crowd-sourced dataset.
 */
export async function submitClaim(claim: Claim): Promise<SubmitResult> {
	if (!canContribute()) throw new NotEntitledError();

	const template = toEventTemplate(claim);

	try {
		const ev = await publish(template);
		return { status: 'published', id: ev.id };
	} catch {
		await queueClaim(claim);
		return { status: 'queued' };
	}
}

let flushing = false;

/**
 * Drain the offline queue. Call on app resume and on regaining
 * connectivity. Safe to call concurrently.
 */
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
	if (!canContribute()) return { sent: 0, failed: 0 };

	// The layout fires this on both `online` and `visibilitychange`, which
	// routinely land together. Without this guard two passes race over the
	// same queue and publish everything twice.
	if (flushing) return { sent: 0, failed: 0 };
	flushing = true;
	try {
		const queue = await pending();
		let sent = 0;
		let failed = 0;

		for (const item of queue) {
			// Give up after a week of failures rather than retrying forever.
			if (item.attempts > 20 || Date.now() - item.queuedAt > 7 * 864e5) {
				await dequeue(item.id);
				continue;
			}
			try {
				await publish(toEventTemplate(item.claim));
				await dequeue(item.id);
				sent++;
			} catch (e) {
				await markAttempt(item, (e as Error).message);
				failed++;
			}
		}

		return { sent, failed };
	} finally {
		flushing = false;
	}
}

/** Pubkey for the settings screen. Display as npub, never raw hex. */
export async function myPubkey(): Promise<string> {
	return (await getIdentity()).pk;
}
