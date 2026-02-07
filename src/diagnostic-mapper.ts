/**
 * Diagnostic Mapper
 *
 * Maps TypeScript diagnostics from the virtual .ts file back to
 * the original .orb file positions, adjusting for the wrapper prefix.
 *
 * @packageDocumentation
 */

import { WRAPPER_LINE_OFFSET, WRAPPER_COL_OFFSET } from './virtual-document.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A position in a text document (0-indexed line and character).
 */
export interface Position {
    /** 0-indexed line number */
    line: number;
    /** 0-indexed character offset within the line */
    character: number;
}

/**
 * A range in a text document.
 */
export interface Range {
    start: Position;
    end: Position;
}

/**
 * Severity levels matching both VSCode and Zed conventions.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * An editor-agnostic diagnostic — the universal unit that
 * VSCode and Zed extensions translate into their native format.
 */
export interface OrbDiagnostic {
    /** Human-readable error message */
    message: string;
    /** Location in the .orb file (already adjusted from virtual .ts) */
    range: Range;
    /** Severity level */
    severity: DiagnosticSeverity;
    /** TypeScript error code (e.g. 2322, 2353) for filtering */
    code?: number;
    /** Source identifier */
    source: 'almadar-ts';
}

/**
 * Raw TypeScript diagnostic (minimal shape matching ts.Diagnostic).
 * Extensions should map their TS server output to this shape.
 */
export interface TsDiagnostic {
    /** 0-indexed line in the virtual .ts file */
    line: number;
    /** 0-indexed character in the virtual .ts file */
    character: number;
    /** End line (optional, defaults to same as line) */
    endLine?: number;
    /** End character (optional) */
    endCharacter?: number;
    /** Error message text */
    messageText: string;
    /** TS error code */
    code?: number;
    /** 1 = error, 2 = warning, 3 = info, 4 = hint */
    category?: number;
}

// ============================================================================
// Core API
// ============================================================================

/**
 * Map a virtual .ts file position back to the original .orb position.
 *
 * @param virtualLine - 0-indexed line in the virtual .ts file
 * @param virtualChar - 0-indexed character in the virtual .ts file
 * @returns Adjusted position in the .orb file
 */
export function mapPositionToOrb(
    virtualLine: number,
    virtualChar: number,
): Position {
    const orbLine = virtualLine - WRAPPER_LINE_OFFSET;

    // If on the same line as the wrapper prefix, adjust column
    const orbChar =
        orbLine === 0 ? Math.max(0, virtualChar - WRAPPER_COL_OFFSET) : virtualChar;

    return {
        line: Math.max(0, orbLine),
        character: Math.max(0, orbChar),
    };
}

/**
 * Map a single TypeScript diagnostic to an OrbDiagnostic.
 *
 * @param tsDiag - The raw TypeScript diagnostic
 * @returns An editor-agnostic diagnostic with adjusted positions
 */
export function mapDiagnostic(tsDiag: TsDiagnostic): OrbDiagnostic {
    const start = mapPositionToOrb(tsDiag.line, tsDiag.character);
    const end = mapPositionToOrb(
        tsDiag.endLine ?? tsDiag.line,
        tsDiag.endCharacter ?? tsDiag.character + 1,
    );

    const severityMap: Record<number, DiagnosticSeverity> = {
        1: 'error',
        2: 'warning',
        3: 'info',
        4: 'hint',
    };

    return {
        message: cleanTsMessage(tsDiag.messageText),
        range: { start, end },
        severity: severityMap[tsDiag.category ?? 1] ?? 'error',
        code: tsDiag.code,
        source: 'almadar-ts',
    };
}

/**
 * Map an array of TypeScript diagnostics to OrbDiagnostics.
 * Filters out diagnostics that fall within the wrapper prefix.
 *
 * @param diagnostics - Array of raw TypeScript diagnostics
 * @returns Array of editor-agnostic diagnostics
 */
export function mapDiagnostics(diagnostics: TsDiagnostic[]): OrbDiagnostic[] {
    return diagnostics
        .filter((d) => d.line >= WRAPPER_LINE_OFFSET)
        .map(mapDiagnostic);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Clean up TypeScript error messages for .orb context.
 *
 * - Removes references to `_orbital` variable name
 * - Replaces `OrbitalSchema` with `.orb schema` for clarity
 */
function cleanTsMessage(message: string): string {
    return message
        .replace(/_orbital/g, '.orb file')
        .replace(/Type '([^']+)'/g, 'Value \'$1\'');
}
