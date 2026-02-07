import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/server.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    target: 'node18',
    banner: {
        js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
});
