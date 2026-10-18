<script lang="ts">
	/**
	 * Per-contributor claim list with a hide control.
	 *
	 * This is the way into the blocklist that `consensus.ts` has always
	 * filtered against but nothing could populate. Since the £1 gate is
	 * client-side, a determined spammer can publish freely — so the user
	 * needs a way to silence one, and it has to take effect immediately
	 * rather than going into a moderation queue nobody runs.
	 *
	 * Hiding is local to this device. There is no global takedown here,
	 * deliberately: a pseudonymous crowd-sourced dataset with a
	 * crowd-operated delete button is a dataset one angry person can empty.
	 */
	import { nip19 } from 'nostr-tools';
	import type { Claim } from '$lib/product';

	let {
		claims,
		hiddenCount = 0,
		myPubkey = null,
		onblock,
		onunblock
	}: {
		claims: Claim[];
		hiddenCount?: number;
		myPubkey?: string | null;
		onblock: (pubkey: string) => void;
		onunblock: (pubkey: string) => void;
	} = $props();

	let open = $state(false);
	let justHid = $state<string | null>(null);

	function short(pubkey?: string): string {
		if (!pubkey) return 'unknown';
		try {
			const npub = nip19.npubEncode(pubkey);
			return npub.slice(0, 9) + '…' + npub.slice(-4);
		} catch {
			return pubkey.slice(0, 8) + '…';
		}
	}

	function when(ts?: number): string {
		if (!ts) return '';
		const days = Math.floor((Date.now() / 1000 - ts) / 86400);
		if (days < 1) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 30) return `${days} days ago`;
		if (days < 365) return `${Math.floor(days / 30)} months ago`;
		return `${Math.floor(days / 365)} years ago`;
	}

	const label = (v: string) =>
		v === 'vegan' ? 'Vegan' : v === 'not-vegan' ? 'Not vegan' : 'Unclear';

	function hide(pubkey: string) {
		justHid = pubkey;
		onblock(pubkey);
	}

	function undo() {
		if (!justHid) return;
		onunblock(justHid);
		justHid = null;
	}
</script>

<button class="disclosure card" onclick={() => (open = !open)} aria-expanded={open}>
	<span>
		{claims.length}
		{claims.length === 1 ? 'contributor' : 'contributors'}
		{#if hiddenCount}<span class="muted">· {hiddenCount} hidden</span>{/if}
	</span>
	<svg class:open viewBox="0 0 24 24" fill="none" stroke="currentColor"
		stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M6 9l6 6 6-6" />
	</svg>
</button>

{#if open}
	<div class="card list">
		{#each claims as claim (claim.id ?? claim.pubkey)}
			<div class="row">
				<div class="info">
					<span class="verdict" data-v={claim.verdict}>{label(claim.verdict)}</span>
					<span class="who mono">{short(claim.pubkey)}</span>
					{#if claim.pubkey === myPubkey}<span class="you">you</span>{/if}
					<span class="tiny muted">{when(claim.created_at)}</span>
				</div>

				{#if claim.pubkey && claim.pubkey !== myPubkey}
					<button class="hide" onclick={() => hide(claim.pubkey!)}>Hide</button>
				{/if}
			</div>

			{#if claim.note}
				<p class="note tiny">{claim.note}</p>
			{/if}
		{/each}

		{#if justHid}
			<div class="undo">
				<span class="tiny">Contributor hidden on this device.</span>
				<button onclick={undo}>Undo</button>
			</div>
		{/if}

		<p class="foot tiny muted">
			Hiding affects only your device. Their claim stays public on Nostr.
		</p>
	</div>
{/if}

<style>
	.disclosure {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		margin-top: var(--sp-3);
		padding: var(--sp-4);
		font-size: 14px;
		font-weight: 550;
	}

	.disclosure svg {
		width: 17px;
		height: 17px;
		color: var(--text-3);
		transition: transform 0.2s var(--ease);
	}

	.disclosure svg.open { transform: rotate(180deg); }

	.list { margin-top: var(--sp-2); padding: var(--sp-2); }

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		padding: var(--sp-3) var(--sp-3);
	}

	.row + .row { border-top: 1px solid var(--border); }

	.info {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--sp-2);
		min-width: 0;
	}

	.verdict {
		padding: 3px 9px;
		border-radius: var(--r-full);
		font-size: 11px;
		font-weight: 650;
	}

	.verdict[data-v='vegan']     { background: var(--yes-soft);   color: var(--yes); }
	.verdict[data-v='not-vegan'] { background: var(--no-soft);    color: var(--no); }
	.verdict[data-v='unclear']   { background: var(--maybe-soft); color: var(--maybe); }

	.who { color: var(--text-2); }

	.you {
		padding: 2px 7px;
		border-radius: var(--r-full);
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 11px;
		font-weight: 650;
	}

	.hide {
		flex-shrink: 0;
		padding: var(--sp-2) var(--sp-3);
		border-radius: var(--r-full);
		border: 1px solid var(--border);
		color: var(--text-2);
		font-size: 13px;
		font-weight: 550;
	}

	.hide:active { background: var(--surface-3); }

	.note {
		padding: 0 var(--sp-3) var(--sp-3);
		color: var(--text-2);
		line-height: 1.45;
	}

	.undo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		margin: var(--sp-2);
		padding: var(--sp-3) var(--sp-4);
		border-radius: var(--r-md);
		background: var(--surface-3);
	}

	.undo button {
		color: var(--accent);
		font-size: 13px;
		font-weight: 650;
	}

	.foot {
		padding: var(--sp-3) var(--sp-3) var(--sp-2);
		line-height: 1.45;
	}
</style>
