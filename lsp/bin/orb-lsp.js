#!/usr/bin/env node

/**
 * Almadar OrbLSP — Language Server for .orb and .lolo files
 *
 * Validates by shelling out to `orb validate --json` (the @almadar/orb CLI)
 * and mapping diagnostics back to the original file positions.
 *
 * Usage:
 *   npx @almadar/orb-lsp          (stdio mode, for editor integration)
 *   node bin/orb-lsp.js            (direct invocation)
 */

import('../dist/server.js');
