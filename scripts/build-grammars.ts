#!/usr/bin/env tsx
/**
 * Build Grammars Script
 *
 * Generates the TextMate S-expression injection grammar from
 * the @almadar/operators registry. Run via:
 *
 *   pnpm run generate-grammar
 *
 * Output: dist/sexpr.injection.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { generateSExprGrammar } from '../src/sexpr-grammar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'dist');
const outPath = join(outDir, 'sexpr.injection.json');

// Ensure dist/ exists
mkdirSync(outDir, { recursive: true });

// Generate and write
const grammar = generateSExprGrammar();
const json = JSON.stringify(grammar, null, 2);

writeFileSync(outPath, json, 'utf-8');

const patternCount = grammar.patterns.length;
console.log(`✅ Generated sexpr.injection.json`);
console.log(`   → ${patternCount} patterns`);
console.log(`   → ${outPath}`);
