/// <reference types="@sveltejs/kit" />
/**
 * Service worker.
 *
 * Caching strategy is shaped by the fact that people use this app in
 * supermarkets, which have famously terrible signal:
 *
 *   - App shell: cache-first. The UI must paint instantly, offline.
 *   - Open Food Facts: network-first with a cache fallback.
 *   - Relays are WebSockets and never touch the service worker; offline
 *     reads come from IndexedDB (src/lib/cache.ts) instead.
 *   - Blossom images: cache-first and immutable, since the URL is a
 *     content hash — the bytes can never change under a given URL.
 */

import { build, files, version } from '$service-worker';

const SHELL = `shell-${version}`;
const IMAGES = 'blossom-images';
const OFF = 'openfoodfacts';

const SHELL_ASSETS = [...build, ...files];

self.addEventListener('install', (event: any) => {
	event.waitUntil(
		caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => (self as any).skipWaiting())
	);
});

self.addEventListener('activate', (event: any) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				// Keep the content-addressed image cache across versions;
				// re-downloading photos on every deploy is rude on mobile data.
				if (key !== SHELL && key !== IMAGES && key !== OFF) await caches.delete(key);
			}
			await (self as any).clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event: any) => {
	const req: Request = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);

	// Content-addressed images: cache forever, never revalidate.
	if (/blossom|satellite\.earth/.test(url.hostname)) {
		event.respondWith(cacheFirst(req, IMAGES));
		return;
	}

	// Open Food Facts: prefer fresh, fall back to whatever we have.
	if (url.hostname.endsWith('openfoodfacts.org')) {
		event.respondWith(networkFirst(req, OFF));
		return;
	}

	// App shell.
	if (url.origin === location.origin) {
		event.respondWith(cacheFirst(req, SHELL));
	}
});

async function cacheFirst(req: Request, cacheName: string): Promise<Response> {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(req);
	if (hit) return hit;
	try {
		const res = await fetch(req);
		if (res.ok) cache.put(req, res.clone());
		return res;
	} catch {
		// Navigation requests fall back to the shell so the app still opens.
		if (req.mode === 'navigate') {
			const shell = await caches.open(SHELL);
			const index = await shell.match('/');
			if (index) return index;
		}
		return new Response('Offline', { status: 503, statusText: 'Offline' });
	}
}

async function networkFirst(req: Request, cacheName: string): Promise<Response> {
	const cache = await caches.open(cacheName);
	try {
		const res = await fetch(req);
		if (res.ok) cache.put(req, res.clone());
		return res;
	} catch {
		const hit = await cache.match(req);
		if (hit) return hit;
		return new Response(JSON.stringify({ status: 0 }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

export {};
