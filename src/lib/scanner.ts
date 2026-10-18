/**
 * Barcode scanning in the browser.
 *
 * Two paths, because platform support is split:
 *
 *   - BarcodeDetector: native, fast, battery-cheap. Chrome and Edge on
 *     Android and desktop. NOT implemented in Safari on any platform.
 *   - ZXing (WASM): works everywhere getUserMedia does, including iOS
 *     Safari. Slower and warmer, but it is the only option on iPhone.
 *
 * Camera constraints that matter in a shop:
 *   - `facingMode: environment` — rear camera, never the selfie cam.
 *   - Continuous autofocus, which is what makes small barcodes resolve.
 *   - HTTPS is mandatory for getUserMedia; localhost is exempt.
 */

export type BarcodeFormat =
	| 'ean_13'
	| 'ean_8'
	| 'upc_a'
	| 'upc_e'
	| 'code_128'
	| 'itf';

const FORMATS: BarcodeFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];

export interface ScannerHandle {
	stop(): void;
}

export class CameraError extends Error {
	constructor(
		message: string,
		readonly kind: 'denied' | 'unavailable' | 'insecure' | 'unknown'
	) {
		super(message);
		this.name = 'CameraError';
	}
}

export function hasNativeDetector(): boolean {
	return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

function assertSecure() {
	if (typeof window === 'undefined') return;
	if (!window.isSecureContext) {
		throw new CameraError(
			'Camera access needs a secure connection (https).',
			'insecure'
		);
	}
}

async function openCamera(): Promise<MediaStream> {
	assertSecure();
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new CameraError('This browser cannot access the camera.', 'unavailable');
	}
	try {
		return await navigator.mediaDevices.getUserMedia({
			video: {
				facingMode: { ideal: 'environment' },
				width: { ideal: 1280 },
				height: { ideal: 720 },
				// Non-standard but honoured on Android Chrome; ignored elsewhere.
				...({ focusMode: 'continuous' } as any)
			},
			audio: false
		});
	} catch (e) {
		const name = (e as DOMException)?.name;
		if (name === 'NotAllowedError' || name === 'SecurityError') {
			throw new CameraError(
				'Camera permission was refused. Allow it in your browser settings to scan.',
				'denied'
			);
		}
		if (name === 'NotFoundError' || name === 'OverconstrainedError') {
			throw new CameraError('No usable camera was found on this device.', 'unavailable');
		}
		throw new CameraError('The camera could not be started.', 'unknown');
	}
}

/**
 * Start scanning into a <video> element.
 *
 * `onResult` fires once per distinct barcode; the caller decides
 * whether to stop. Duplicate reads within `debounceMs` are swallowed so
 * a barcode held in frame does not fire fifty times.
 */
export async function startScanner(
	video: HTMLVideoElement,
	onResult: (barcode: string) => void,
	opts: { debounceMs?: number; onError?: (e: Error) => void } = {}
): Promise<ScannerHandle> {
	const debounceMs = opts.debounceMs ?? 2000;
	const stream = await openCamera();

	video.srcObject = stream;
	video.setAttribute('playsinline', 'true'); // iOS: do not go fullscreen
	video.muted = true;
	await video.play();

	let stopped = false;
	let lastValue = '';
	let lastAt = 0;

	const emit = (value: string) => {
		const now = Date.now();
		if (value === lastValue && now - lastAt < debounceMs) return;
		lastValue = value;
		lastAt = now;
		onResult(value);
	};

	const cleanup = () => {
		stopped = true;
		stream.getTracks().forEach((t) => t.stop());
		video.srcObject = null;
	};

	if (hasNativeDetector()) {
		const Detector = (window as any).BarcodeDetector;
		const supported: string[] = await Detector.getSupportedFormats();
		const detector = new Detector({
			formats: FORMATS.filter((f) => supported.includes(f))
		});

		// Throttled to ~12fps rather than running on every animation frame.
		// detect() is expensive, a barcode does not move 60 times a second,
		// and this is a phone held up in a shop — the difference is warmth
		// in the user's hand and battery they need for the rest of the day.
		let timer: ReturnType<typeof setTimeout>;
		const tick = async () => {
			if (stopped) return;
			try {
				const codes = await detector.detect(video);
				if (codes.length) emit(codes[0].rawValue);
			} catch {
				/* transient decode failures are normal; keep going */
			}
			if (!stopped) timer = setTimeout(tick, 80);
		};
		tick();

		return {
			stop() {
				clearTimeout(timer);
				cleanup();
			}
		};
	}

	// iOS Safari and anything else without BarcodeDetector.
	const { BrowserMultiFormatReader } = await import('@zxing/browser');
	const reader = new BrowserMultiFormatReader();

	// decodeFromVideoElement resolves to a controls handle. Dropping it
	// leaves ZXing decoding frames forever against a stopped stream —
	// invisible, but it pins the CPU on the one platform where ZXing is
	// the only option and battery is already the cost of using it.
	let controls: { stop: () => void } | null = null;

	reader
		.decodeFromVideoElement(video, (result) => {
			if (stopped) return;
			if (result) emit(result.getText());
		})
		.then((c) => {
			controls = c as unknown as { stop: () => void };
			// Stopped while we were still setting up.
			if (stopped) controls.stop();
		})
		.catch((e: Error) => opts.onError?.(e));

	return {
		stop() {
			controls?.stop();
			cleanup();
		}
	};
}

/**
 * Decode a barcode from a still photo.
 *
 * The fallback when live scanning fails: damaged labels, awkward
 * lighting, or an iPhone struggling with ZXing. `capture="environment"`
 * on a file input gets the rear camera without needing getUserMedia at
 * all, which also rescues users who refused camera permission.
 */
export async function decodeImage(file: Blob): Promise<string | null> {
	const bitmap = await createImageBitmap(file);

	if (hasNativeDetector()) {
		const Detector = (window as any).BarcodeDetector;
		const detector = new Detector({ formats: FORMATS });
		const codes = await detector.detect(bitmap);
		bitmap.close?.();
		return codes.length ? codes[0].rawValue : null;
	}

	const { BrowserMultiFormatReader } = await import('@zxing/browser');
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
	bitmap.close?.();

	try {
		const reader = new BrowserMultiFormatReader();
		return reader.decodeFromCanvas(canvas).getText();
	} catch {
		return null;
	}
}
