#!/usr/bin/env tsx
/**
 * Build Grammars Script
 *
 * Generates the TextMate S-expression injection grammar from
 * the @almadar/std registry. Run via:
 *
 *   pnpm run generate-grammar
 *
 * Output: dist/sexpr.injection.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { generateSExprGrammar } from '../src/sexpr-grammar.js';
import { generateLoloTmLanguage } from '../src/lolo-grammar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'dist');

// Ensure dist/ exists
mkdirSync(outDir, { recursive: true });

// .orb S-expression injection grammar
const sexprOutPath = join(outDir, 'sexpr.injection.json');
const sexprGrammar = generateSExprGrammar();
writeFileSync(sexprOutPath, JSON.stringify(sexprGrammar, null, 2), 'utf-8');
console.log(`✅ Generated sexpr.injection.json`);
console.log(`   → ${sexprGrammar.patterns.length} patterns`);
console.log(`   → ${sexprOutPath}`);

// .lolo full TextMate grammar
const loloOutPath = join(outDir, 'lolo.tmLanguage.json');
const loloGrammar = generateLoloTmLanguage();
writeFileSync(loloOutPath, JSON.stringify(loloGrammar, null, 2), 'utf-8');
console.log(`✅ Generated lolo.tmLanguage.json`);
console.log(`   → ${loloGrammar.patterns.length} patterns`);
console.log(`   → ${loloOutPath}`);
