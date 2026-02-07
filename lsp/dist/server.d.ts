/**
 * Almadar OrbLSP Server
 *
 * A stdio-based LSP server that validates .orb files by shelling out
 * to `almadar validate --json` and mapping diagnostics back to the
 * original .orb file positions.
 *
 * Architecture:
 *   .orb file → temp file → `almadar validate --json` → parse JSON
 *   → map JSON paths to line positions → publish diagnostics
 */
interface JsonPosition {
    line: number;
    character: number;
}
/**
 * Given raw JSON text and a JSON path like "orbitals[0].traits[0].stateMachine",
 * find the line/character position of that path in the source.
 *
 * Strategy: walk the path segments and use regex to find each key/index
 * in the source text sequentially, advancing a cursor.
 */
declare function jsonPathToPosition(jsonText: string, jsonPath: string): JsonPosition;

export { jsonPathToPosition };
