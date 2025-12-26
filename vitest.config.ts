import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./tests/setup.ts'],
		coverage: {
			provider: 'istanbul',
			reporter: ['text', 'json', 'html'],
			thresholds: {
				statements: 90,
				branches: 90,
				functions: 90,
				lines: 90,
			},
			exclude: [
				'node_modules/**',
				'dist/**',
				'**/*.d.ts',
				'test/**',
				'tests/e2e/**',
				'playwright.config.ts',
				'vitest.config.ts',
			],
		},
		include: ['tests/unit/**/*.{test,spec}.{js,ts}', 'tests/integration/**/*.{test,spec}.{js,ts}'],
	},
});
