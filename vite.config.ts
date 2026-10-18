import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// getUserMedia needs HTTPS or localhost. `--host` plus a tunnel
		// (or `vite --https`) is how you test scanning on a real phone.
		host: true
	}
});
