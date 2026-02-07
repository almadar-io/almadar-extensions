/**
 * Almadar Extensions
 *
 * Editor extension utilities for .orb files.
 *
 * - **Virtual Document**: Wraps .orb JSON as TypeScript for free validation
 * - **Diagnostic Mapper**: Maps TS diagnostics back to .orb positions
 * - **S-Expression Grammar**: Generates TextMate injection from operator SSOT
 *
 * @packageDocumentation
 */

// Virtual Document
export {
    wrapOrbContent,
    unwrapOrbContent,
    getVirtualPath,
    WRAPPER_LINE_OFFSET,
    WRAPPER_COL_OFFSET,
} from './virtual-document.js';

// Diagnostic Mapper
export {
    mapPositionToOrb,
    mapDiagnostic,
    mapDiagnostics,
    type Position,
    type Range,
    type DiagnosticSeverity,
    type OrbDiagnostic,
    type TsDiagnostic,
} from './diagnostic-mapper.js';

// S-Expression Grammar
export {
    generateSExprGrammar,
    generateSExprGrammarJson,
    getOperatorNames,
    getOperatorsByCategory,
    type TmInjectionGrammar,
} from './sexpr-grammar.js';
