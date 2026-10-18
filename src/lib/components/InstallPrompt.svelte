<script lang="ts">
	/**
	 * Inline install prompt — a suggestion, never a wall.
	 *
	 * Shown at the one moment installing genuinely matters: just before
	 * someone pays and receives a key. Reading needs no install, because
	 * a link someone shares has to open straight into an answer.
	 *
	 * Renders nothing when already installed, or when the browser cannot
	 * install at all (Firefox, in-app browsers) — telling someone to do
	 * something their browser can't do is noise.
	 */
	import { onMount } from 'svelte';
	import { isIOS, isStandalone } from '$lib/backup';

	let deferredPrompt = $state<any>(null);
	let platform = $state<'none' | 'chromium' | 'ios'>('none');
	let installing = $state(false);
	let dismissed = $state(false);

	function inAppBrowser(): boolean {
		return /FBAN|FBAV|Instagram|Line\/|Twitter|WhatsApp|Snapchat/i.test(navigator.userAgent);
	}

	onMount(() => {
		if (isStandalone()) return;
		if (isIOS() && !inAppBrowser()) platform = 'ios';

		const onPrompt = (e: Event) => {
			e.preventDefault();
			deferredPrompt = e;
			platform = 'chromium';
		};
		window.addEventListener('beforeinstallprompt', onPrompt);
		return () => window.removeEventListener('beforeinstallprompt', onPrompt);
	});

	async function install() {
		if (!deferredPrompt) return;
		installing = true;
		try {
			deferredPrompt.prompt();
			await deferredPrompt.userChoice;
		} finally {
			installing = false;
			deferredPrompt = null;
			dismissed = true;
		}
	}
</script>

{#if platform !== 'none' && !dismissed}
	<div class="prompt">
		<div class="head">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
				stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<rect x="5" y="2" width="14" height="20" rx="3" />
				<path d="M12 18h.01" />
			</svg>
			<div>
				<strong>Add to your Home Screen first</strong>
				<p class="tiny muted">
					{#if platform === 'ios'}
						iOS deletes website data after 7 days. Installing keeps your
						contributor key from disappearing.
					{:else}
						Keeps your contributor key safe and lets the app work offline.
					{/if}
				</p>
			</div>
		</div>

		{#if platform === 'chromium'}
			<button class="btn btn-secondary" onclick={install} disabled={installing}>
				{installing ? 'Installing…' : 'Install'}
			</button>
		{:else}
			<p class="tiny steps">
				Tap <strong>Share</strong>
				<svg class="inline" viewBox="0 0 24 24" fill="none" stroke="currentColor"
					stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M12 16V3M8 7l4-4 4 4" />
					<path d="M20 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5" />
				</svg>
				then <strong>Add to Home Screen</strong>
			</p>
		{/if}

		<button class="skip" onclick={() => (dismissed = true)}>
			Continue without installing
		</button>
	</div>
{/if}

<style>
	.prompt {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
		padding: var(--sp-4);
		margin-bottom: var(--sp-4);
		border-radius: var(--r-lg);
		background: var(--accent-soft);
		border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
	}

	.head { display: flex; gap: var(--sp-3); align-items: flex-start; }

	.head > svg {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		color: var(--accent);
		margin-top: 2px;
	}

	.head strong { font-size: 15px; font-weight: 600; display: block; }
	.head p { margin-top: 3px; line-height: 1.45; }

	.steps { color: var(--text-2); line-height: 1.5; }

	.inline {
		width: 14px;
		height: 14px;
		vertical-align: -3px;
		color: var(--accent);
	}

	.skip {
		align-self: center;
		padding: var(--sp-1);
		font-size: 13px;
		font-weight: 550;
		color: var(--text-3);
	}
</style>
