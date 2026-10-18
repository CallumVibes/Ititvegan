/**
 * Blossom upload — product photos only.
 *
 * Blossom is content-addressed blob storage: you PUT bytes, you get back
 * a sha256-named URL. It has no query capability, which is why product
 * DATA lives in Nostr events and only IMAGES live here.
 *
 * Auth is a kind-24242 event signed with the app's local key (BUD-01).
 */

import { finalizeEvent } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { getIdentity } from './nostr';

export const DEFAULT_BLOSSOM_SERVERS = [
	'https://blossom.primal.net',
	'https://cdn.satellite.earth'
];

export interface Upload {
	url: string;
	sha256: string;
	size: number;
}

/** Build the base64 `Nostr` authorization header for a blob action. */
async function authHeader(
	verb: 'upload' | 'get' | 'list' | 'delete',
	hash: string,
	expiresInSec = 300
): Promise<string> {
	const { sk } = await getIdentity();
	const ev = finalizeEvent(
		{
			kind: 24242,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['t', verb],
				['x', hash],
				['expiration', String(Math.floor(Date.now() / 1000) + expiresInSec)]
			],
			content: `${verb} blob`
		},
		sk
	);
	const json = JSON.stringify(ev);
	const b64 =
		typeof btoa === 'function'
			? btoa(unescape(encodeURIComponent(json)))
			: Buffer.from(json, 'utf-8').toString('base64');
	return `Nostr ${b64}`;
}

/**
 * Upload a photo, trying each server until one accepts.
 *
 * Returns the hash alongside the URL so the claim event can pin the
 * content: if a server later serves different bytes, the client can
 * detect it and refuse to show the image.
 */
export async function upload(
	file: Blob,
	servers: string[] = DEFAULT_BLOSSOM_SERVERS
): Promise<Upload> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const hash = bytesToHex(sha256(bytes));
	const auth = await authHeader('upload', hash);

	let lastError = '';
	for (const server of servers) {
		try {
			const res = await fetch(`${server.replace(/\/$/, '')}/upload`, {
				method: 'PUT',
				headers: {
					Authorization: auth,
					'Content-Type': file.type || 'application/octet-stream'
				},
				body: bytes
			});

			if (!res.ok) {
				lastError = `${server}: ${res.status} ${res.statusText}`;
				continue;
			}

			const body = await res.json();
			const url: string | undefined = body?.url;
			if (typeof url !== 'string' || !url.startsWith('https://')) {
				lastError = `${server}: response had no usable url`;
				continue;
			}

			// Trust our own hash over whatever the server reports.
			return { url, sha256: hash, size: bytes.length };
		} catch (e) {
			lastError = `${server}: ${(e as Error).message}`;
		}
	}

	throw new Error(`No Blossom server accepted the upload. ${lastError}`);
}

/**
 * Downscale and re-encode before upload. Shop photos off a phone camera
 * are 4-8 MB; nobody on mobile data wants that, and Blossom servers
 * routinely cap blob size.
 */
export async function prepareImage(file: Blob, maxDim = 1200, quality = 0.75): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * scale);
	const h = Math.round(bitmap.height * scale);

	const canvas =
		typeof OffscreenCanvas !== 'undefined'
			? new OffscreenCanvas(w, h)
			: Object.assign(document.createElement('canvas'), { width: w, height: h });

	const ctx = (canvas as any).getContext('2d');
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close?.();

	if ('convertToBlob' in canvas) {
		return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality });
	}
	return await new Promise<Blob>((resolve, reject) =>
		(canvas as HTMLCanvasElement).toBlob(
			(b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))),
			'image/jpeg',
			quality
		)
	);
}
