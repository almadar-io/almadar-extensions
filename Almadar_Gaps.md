<!-- Gap ledger for this repo: the source of truth for its open gaps. Managed with scripts/gaps-ledger.mjs in the Almadar monorepo. -->
# @almadar/extensions — open gaps

Every open gap this repo owns lives here. This file is the source of truth; the monorepo's `docs/Almadar_Gaps.md` only rolls it up.

- **One entry per gap:** `- **<code>** — <what is wrong and where>. <owning package> [mechanical|architectural] — <evidence, prevention rung>`. `[mechanical]` = small and well-scoped; `[architectural]` = needs design judgment.
- **Codes:** new gaps use this repo's prefix `G-EXTENSIONS-`. Take the "Next code" below, then bump it in the same edit. Codes are never reused or renamed.
- **Close by deleting.** Remove the entry in the same commit as the fix. There is no "closed" section; git history is the record.
- **Cross-repo gaps don't go here.** If fixing it needs another repo, describe it in your report or PR body; the monorepo coordinator files it.

Next code: `G-EXTENSIONS-004`

## Open gaps

_No open gaps._
- **G-EXTENSIONS-002** — `editors/zed/tree-sitter-lolo` corpus tests "Trait with state and effect" and "Guard transition with operator symbol" fail at HEAD (`tree-sitter test`: 2/9 failed before the 2026-10-08 modifier-bracket change too): the expected trees name a `sexpr_op` node the generated parser no longer produces. Regenerate expectations or restore the node. The grammar also lags the language (no `uses`, `theme`, `locales` rules). `editors/zed/tree-sitter-lolo/` [mechanical] — found 2026-10-08. Prevention rung: tooling regression gate (`tree-sitter test` in CI).
- **G-EXTENSIONS-003** — `editors/zed/grammars/lolo` is a nested checkout (detached at `fac840b`) carrying its own copy of `tree-sitter-lolo/grammar.js`; the 2026-10-08 app/page modifier-bracket grammar change landed only in `editors/zed/tree-sitter-lolo`. Re-point the nested checkout or drop the duplicate copy. `editors/zed/grammars/lolo` [mechanical] — found 2026-10-08.
- **G-EXTENSIONS-001** — The Orb LSP ignores `orb validate --json`'s `line`/`column`/`endLine`/`endColumn`/`approximate`: it derives positions by regex on the `path` string and underlines to end of line. Use the reported span (approximate → a hint-severity range). `lsp/src/server.ts` [mechanical] — found 2026-09-28
