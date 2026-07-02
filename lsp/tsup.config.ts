import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/server.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    target: 'node18',
    // Bundle every runtime dependency into dist/server.js so it runs standalone
    // (no sibling node_modules needed) — required for distribution via VSCode's
    // extension dist/ and Zed's npm_install_package flow. @almadar/cli's
    // platform binaries are resolved dynamically at runtime (require.resolve
    // on a computed string), never statically imported, so they're unaffected.
    noExternal: ['vscode-languageserver', 'vscode-languageserver-textdocument', 'ws', '@almadar/ui'],
    banner: {
        js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
});
