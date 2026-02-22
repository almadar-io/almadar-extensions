#!/usr/bin/env node

/**
 * Almadar OrbLSP — Language Server for .orb files
 *
 * Provides TypeScript-powered validation by wrapping .orb JSON
 * as `satisfies OrbitalSchema` and delegating to TypeScript's
 * LanguageService for diagnostics.
 *
 * Usage:
 *   npx @almadar/orb-lsp          (stdio mode, for editor integration)
 *   node bin/orb-lsp.js            (direct invocation)
 */

import('../dist/server.js');
