import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Static output: the whole app is HTML, JS and CSS on a CDN. No server,
 * nothing to run, nothing to pay for. All state lives either on Nostr
 * relays or in the user's own browser.
 *
 * `fallback` makes it a true SPA so deep links like /product/50001126
 * resolve client-side without needing per-route prerendering.
 */
export default {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: true,
			strict: false
		}),
		serviceWorker: { register: true },
		// Without a poll interval the `updated` store never fires, so the
		// "new version" prompt would be dead code. Hourly is plenty for an
		// app people open for thirty seconds at a time.
		version: { pollInterval: 3600000 },
		// Set BASE_PATH in CI when deploying to a project page
		// (https://user.github.io/repo). Leave empty for a custom domain.
		paths: { base: process.env.BASE_PATH ?? '' },
		alias: { $lib: 'src/lib' }
	}
};
