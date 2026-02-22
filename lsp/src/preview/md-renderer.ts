/**
 * Zero-dependency Markdown → HTML renderer.
 *
 * Handles: headings, blockquotes, unordered/ordered lists, bold, italic,
 * inline code, fenced code blocks, horizontal rules, links, and paragraphs.
 *
 * Designed for rendering Arabic .md chapter files in the RTL preview.
 */

/** Escape HTML special characters */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Process inline markdown: bold, italic, inline code, links */
function inlineMarkdown(text: string): string {
    let result = esc(text);

    // Inline code (must come before bold/italic to avoid conflicts)
    result = result.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold + italic
    result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Links [text](url)
    result = result.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" style="color: var(--lapis); text-decoration: underline;">$1</a>',
    );

    // Non-breaking spaces for poetry alignment
    result = result.replace(/&amp;nbsp;/g, '&nbsp;');

    return result;
}

export function renderMarkdown(source: string): string {
    const lines = source.split('\n');
    const output: string[] = [];
    let i = 0;
    let inList: 'ul' | 'ol' | null = null;
    let inBlockquote = false;
    let blockquoteLines: string[] = [];

    function flushBlockquote(): void {
        if (blockquoteLines.length > 0) {
            const content = blockquoteLines.map(inlineMarkdown).join('<br>');
            output.push(`<blockquote>${content}</blockquote>`);
            blockquoteLines = [];
        }
        inBlockquote = false;
    }

    function flushList(): void {
        if (inList) {
            output.push(inList === 'ul' ? '</ul>' : '</ol>');
            inList = null;
        }
    }

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trimEnd();

        // Fenced code block
        if (trimmed.startsWith('```')) {
            flushBlockquote();
            flushList();
            const lang = trimmed.slice(3).trim();
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trimEnd().startsWith('```')) {
                codeLines.push(esc(lines[i]));
                i++;
            }
            i++; // skip closing ```
            const langAttr = lang ? ` data-lang="${esc(lang)}"` : '';
            output.push(
                `<pre class="code-block"${langAttr}><code>${codeLines.join('\n')}</code></pre>`,
            );
            continue;
        }

        // Horizontal rule
        if (/^---+\s*$/.test(trimmed) || /^\*\*\*+\s*$/.test(trimmed)) {
            flushBlockquote();
            flushList();
            output.push('<hr>');
            i++;
            continue;
        }

        // Heading
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            flushBlockquote();
            flushList();
            const level = headingMatch[1].length;
            output.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
            i++;
            continue;
        }

        // Blockquote
        if (trimmed.startsWith('> ') || trimmed === '>') {
            flushList();
            inBlockquote = true;
            blockquoteLines.push(trimmed.startsWith('> ') ? trimmed.slice(2) : '');
            i++;
            continue;
        }
        if (inBlockquote) {
            flushBlockquote();
        }

        // Unordered list
        if (/^[-*]\s+/.test(trimmed)) {
            flushBlockquote();
            if (inList !== 'ul') {
                flushList();
                output.push('<ul>');
                inList = 'ul';
            }
            output.push(`<li>${inlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
            i++;
            continue;
        }

        // Ordered list
        const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
        if (olMatch) {
            flushBlockquote();
            if (inList !== 'ol') {
                flushList();
                output.push('<ol>');
                inList = 'ol';
            }
            output.push(`<li>${inlineMarkdown(olMatch[2])}</li>`);
            i++;
            continue;
        }

        // Non-list line closes list
        flushList();

        // Empty line
        if (trimmed === '') {
            i++;
            continue;
        }

        // Table detection (simple)
        if (trimmed.includes('|') && trimmed.startsWith('|')) {
            flushBlockquote();
            const tableLines: string[] = [trimmed];
            i++;
            while (i < lines.length && lines[i].trimEnd().startsWith('|')) {
                tableLines.push(lines[i].trimEnd());
                i++;
            }
            output.push(renderTable(tableLines));
            continue;
        }

        // Paragraph
        output.push(`<p>${inlineMarkdown(trimmed)}</p>`);
        i++;
    }

    flushBlockquote();
    flushList();

    return output.join('\n');
}

/** Render a simple markdown table */
function renderTable(lines: string[]): string {
    const parseRow = (line: string): string[] =>
        line
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());

    if (lines.length < 2) return '';

    const headers = parseRow(lines[0]);
    // lines[1] is the separator row (|---|---|)
    const rows = lines.slice(2).map(parseRow);

    let html = '<table><thead><tr>';
    for (const h of headers) {
        html += `<th>${inlineMarkdown(h)}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (const row of rows) {
        html += '<tr>';
        for (const cell of row) {
            html += `<td>${inlineMarkdown(cell)}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}
