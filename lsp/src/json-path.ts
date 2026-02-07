/**
 * Maps a JSON path (e.g. "orbitals[0].traits[0].guard[1][2]")
 * to the line/character position in the raw JSON text.
 */

export interface JsonPosition {
    line: number;      // 0-indexed
    character: number; // 0-indexed
}

/**
 * Given raw JSON text and a JSON path, find the line/character position
 * of that path in the source.
 *
 * Strategy: walk the path segments and use regex to find each key/index
 * in the source text sequentially, advancing a cursor.
 */
export function jsonPathToPosition(jsonText: string, jsonPath: string): JsonPosition {
    if (!jsonPath) return { line: 0, character: 0 };

    // Parse path segments: "orbitals[0].traits[0].guard[1][2]"
    // → ["orbitals", "0", "traits", "0", "guard", "1", "2"]
    const segments = jsonPath
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);

    let cursor = 0;

    for (const seg of segments) {
        const isIndex = /^\d+$/.test(seg);

        if (isIndex) {
            const idx = parseInt(seg, 10);
            // Find the next array bracket
            const bracketPos = jsonText.indexOf('[', cursor);
            if (bracketPos === -1) break;
            cursor = bracketPos + 1;

            // Skip idx commas at the top level of this array
            let depth = 0;
            let count = 0;
            for (let i = cursor; i < jsonText.length; i++) {
                const ch = jsonText[i];
                if (ch === '{' || ch === '[') depth++;
                else if (ch === '}' || ch === ']') {
                    if (depth === 0) break; // end of array
                    depth--;
                } else if (ch === ',' && depth === 0) {
                    count++;
                    if (count === idx) {
                        cursor = i + 1;
                        // Skip whitespace after comma
                        while (cursor < jsonText.length && /\s/.test(jsonText[cursor])) cursor++;
                        break;
                    }
                }
            }
            if (count < idx && idx > 0) break; // couldn't find enough elements
            if (idx === 0) {
                // Skip whitespace after bracket
                while (cursor < jsonText.length && /\s/.test(jsonText[cursor])) cursor++;
            }
        } else {
            // Find the key in the current object context
            const keyPattern = new RegExp(`"${escapeRegex(seg)}"\\s*:`);
            const match = keyPattern.exec(jsonText.slice(cursor));
            if (!match) break;
            cursor += match.index;
        }
    }

    return offsetToPosition(jsonText, cursor);
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function offsetToPosition(text: string, offset: number): JsonPosition {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            character = 0;
        } else {
            character++;
        }
    }
    return { line, character };
}
