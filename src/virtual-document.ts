/**
 * Virtual Document — The TypeScript Wrapper Trick
 *
 * Wraps .orb JSON content inside a TypeScript file that imports
 * OrbitalSchema from @almadar/core. This lets the TypeScript
 * language server validate the entire .orb structure for free.
 *
 * @packageDocumentation
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * The TypeScript prefix prepended to .orb content.
 * Line 1: import type
 * Line 2: const declaration with `satisfies` for best error messages
 */
const TS_PREFIX =
    `import type { OrbitalSchema } from '@almadar/core';\n` +
    `const _orbital = `;

/**
 * The TypeScript suffix appended after .orb content.
 */
const TS_SUFFIX = ` satisfies OrbitalSchema;\n`;

/**
 * Number of lines the prefix adds before .orb content begins.
 * Used to offset diagnostics back to original .orb line numbers.
 *
 * The prefix is exactly 2 lines:
 *   Line 1: import type { OrbitalSchema } from '@almadar/core';
 *   Line 2: const _orbital = ... (the .orb content starts on THIS line)
 *
 * So .orb line 1 corresponds to virtual .ts line 2.
 */
export const WRAPPER_LINE_OFFSET = 1;

/**
 * Number of characters on the prefix line before .orb content begins.
 * `const _orbital = ` is 18 characters.
 */
export const WRAPPER_COL_OFFSET = 18;

// ============================================================================
// Core API
// ============================================================================

/**
 * Wrap raw .orb JSON content into a virtual TypeScript file.
 *
 * @param orbContent - The raw JSON string from the .orb file
 * @returns The complete TypeScript source that tsserver can validate
 *
 * @example
 * ```ts
 * const orbJson = fs.readFileSync('app.orb', 'utf-8');
 * const tsContent = wrapOrbContent(orbJson);
 * // tsContent is now a valid .ts file that TypeScript can check
 * ```
 */
export function wrapOrbContent(orbContent: string): string {
    return TS_PREFIX + orbContent + TS_SUFFIX;
}

/**
 * Extract the original .orb content from a wrapped virtual TypeScript file.
 *
 * @param virtualContent - The virtual .ts file content
 * @returns The original .orb JSON string, or null if not a valid wrapper
 */
export function unwrapOrbContent(virtualContent: string): string | null {
    if (!virtualContent.startsWith(TS_PREFIX)) return null;
    if (!virtualContent.endsWith(TS_SUFFIX)) return null;

    return virtualContent.slice(
        TS_PREFIX.length,
        virtualContent.length - TS_SUFFIX.length,
    );
}

/**
 * Generate the virtual .ts filename for a given .orb file path.
 *
 * @param orbFilePath - Absolute path to the .orb file
 * @returns The virtual .ts file path (same directory, `.orb.ts` extension)
 *
 * @example
 * ```ts
 * getVirtualPath('/projects/app.orb')
 * // → '/projects/app.orb.ts'
 * ```
 */
export function getVirtualPath(orbFilePath: string): string {
    return orbFilePath + '.ts';
}
