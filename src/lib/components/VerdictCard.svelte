<script lang="ts">
	import type { Resolution } from '$lib/consensus';
	import { confidenceLabel } from '$lib/consensus';

	let { resolution, name, brand }: {
		resolution: Resolution;
		name?: string;
		brand?: string;
	} = $props();

	let open = $state(false);

	const tone = $derived(
		resolution.verdict === 'vegan' ? 'yes'
		: resolution.verdict === 'not-vegan' ? 'no'
		: 'maybe'
	);

	const headline = $derived(
		resolution.verdict === 'vegan' ? 'Vegan'
		: resolution.verdict === 'not-vegan' ? 'Not vegan'
		: 'Unclear'
	);

	// Confidence as five discrete pips rather than a percentage. A number
	// like "73% vegan" reads as precision the data cannot support.
	const pips = $derived(Math.max(0, Math.min(5, Math.round(resolution.confidence * 5))));

	// The single strongest reason is the one worth reading at a glance;
	// the rest only matter to someone who taps.
	const lead = $derived(resolution.reasons[0]);
	const rest = $derived(resolution.reasons.slice(1));
</script>

<div class="verdict" data-tone={tone}>
	<div class="glyph" aria-hidden="true">
		{#if resolution.verdict === 'vegan'}
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
				stroke-linecap="round" stroke-linejoin="round">
				<path d="M20 6 9 17l-5-5" />
			</svg>
		{:else if resolution.verdict === 'not-vegan'}
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
				stroke-linecap="round" stroke-linejoin="round">
				<path d="M18 6 6 18M6 6l12 12" />
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
				stroke-linecap="round" stroke-linejoin="round">
				<path d="M12 17h.01M12 13.5a2.5 2.5 0 1 0-2.5-3" />
				<circle cx="12" cy="12" r="9" />
			</svg>
		{/if}
	</div>

	<h1>{headline}</h1>

	{#if name}
		<p class="name">{name}{#if brand}<span class="brand"> · {brand}</span>{/if}</p>
	{/if}

	<div class="confidence">
		<div class="pips" role="img"
			aria-label="{confidenceLabel(resolution.confidence)}, {pips} out of 5">
			{#each Array(5) as _, i}
				<span class="pip" class:on={i < pips}></span>
			{/each}
		</div>
		<span class="tiny muted">{confidenceLabel(resolution.confidence)}</span>
	</div>

	{#if resolution.conflict}
		<div class="flag">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
				stroke-linecap="round" aria-hidden="true">
				<path d="M12 9v4M12 17h.01" />
				<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
			</svg>
			<span>Contributors and the label disagree — check the pack</span>
		</div>
	{/if}

	{#if lead}
		<p class="lead">{lead}</p>
	{/if}
</div>

{#if rest.length}
	<button class="why" onclick={() => (open = !open)} aria-expanded={open}>
		<span>Why?</span>
		<svg class:open viewBox="0 0 24 24" fill="none" stroke="currentColor"
			stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M6 9l6 6 6-6" />
		</svg>
	</button>

	{#if open}
		<ul class="reasons card">
			{#each rest as reason}
				<li>{reason}</li>
			{/each}
		</ul>
	{/if}
{/if}

{#if resolution.verdict !== 'not-vegan'}
	<p class="allergy tiny">
		Crowd-sourced. If you have an allergy rather than a preference, read the label.
	</p>
{/if}

<style>
	.verdict {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--sp-3);
		padding: var(--sp-6) var(--sp-5);
		border-radius: var(--r-xl);
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-2);
	}

	.verdict[data-tone='yes']   { --t: var(--yes);   --t-soft: var(--yes-soft); }
	.verdict[data-tone='no']    { --t: var(--no);    --t-soft: var(--no-soft); }
	.verdict[data-tone='maybe'] { --t: var(--maybe); --t-soft: var(--maybe-soft); }

	.glyph {
		width: 76px;
		height: 76px;
		display: grid;
		place-items: center;
		border-radius: var(--r-full);
		background: var(--t-soft);
		color: var(--t);
		animation: pop 0.4s var(--ease);
	}

	.glyph svg { width: 38px; height: 38px; }

	@keyframes pop {
		from { transform: scale(0.8); opacity: 0; }
		to   { transform: scale(1);   opacity: 1; }
	}

	h1 { font-size: 34px; color: var(--t); letter-spacing: -0.035em; }

	.name { font-size: 17px; font-weight: 550; max-width: 32ch; }
	.brand { color: var(--text-2); font-weight: 450; }

	.confidence {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.pips { display: flex; gap: 5px; }

	.pip {
		width: 22px;
		height: 5px;
		border-radius: var(--r-full);
		background: var(--surface-3);
	}

	.pip.on { background: var(--t); }

	/* Orange here, not a verdict colour: this is "pay attention", not an
	   answer. The verdict hues stay reserved for the answer itself. */
	.flag {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-2) var(--sp-4);
		border-radius: var(--r-full);
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 13px;
		font-weight: 550;
		text-align: left;
	}

	.flag svg { width: 16px; height: 16px; flex-shrink: 0; }

	.lead {
		font-size: 15px;
		color: var(--text-2);
		line-height: 1.5;
		max-width: 34ch;
		padding-top: var(--sp-1);
	}

	.why {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-1);
		width: 100%;
		margin-top: var(--sp-3);
		padding: var(--sp-3);
		color: var(--text-2);
		font-size: 14px;
		font-weight: 600;
	}

	.why svg {
		width: 17px;
		height: 17px;
		transition: transform 0.2s var(--ease);
	}

	.why svg.open { transform: rotate(180deg); }

	.reasons {
		list-style: none;
		margin: 0;
		padding: var(--sp-2);
	}

	.reasons li {
		padding: var(--sp-3) var(--sp-4);
		font-size: 14px;
		color: var(--text-2);
		line-height: 1.45;
	}

	.reasons li + li { border-top: 1px solid var(--border); }

	.allergy {
		margin-top: var(--sp-4);
		text-align: center;
		color: var(--text-3);
		line-height: 1.5;
		padding: 0 var(--sp-4);
	}
</style>
