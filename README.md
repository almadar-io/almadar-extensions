# @almadar/extensions

> Editor extension utilities for .orb files — virtual document wrapper and S-expression grammar generator

Part of the [Almadar](https://github.com/almadar-io/almadar) platform.

## Installation

```bash
npm install @almadar/extensions
```

## Usage

```typescript
import { /* ... */ } from '@almadar/extensions';
```

## Editors

| Editor | Path | Highlighting | Diagnostics |
| --- | --- | --- | --- |
| VSCode | `editors/vscode` | TextMate (`lolo.tmLanguage.json` + `sexpr.injection.json`) | orb-lsp |
| Zed | `editors/zed` | tree-sitter (`tree-sitter-lolo`, `highlights.scm`) | orb-lsp |
| Neovim | `editors/nvim` | tree-sitter (same grammar) + regex fallback | orb-lsp |

Every grammar artifact is **generated** from `@almadar/syntax`'s `tokens.json`
— one registry behind all three editors, so keyword/operator/effect/pattern/
behavior lists cannot drift:

```bash
pnpm run generate-grammar
```

| Generator | Emits |
| --- | --- |
| `src/sexpr-grammar.ts` | `dist/sexpr.injection.json` (VSCode) |
| `src/lolo-grammar.ts` | `dist/lolo.tmLanguage.json` (VSCode), `editors/zed/languages/lolo/highlights.scm` |
| `src/nvim-grammar.ts` | `editors/nvim/queries/{lolo,orb}/highlights.scm`, `editors/nvim/syntax/{lolo,orb}.vim` |

See `editors/nvim/README.md` for the Neovim plugin's install and commands.

## API

<!-- Document public exports here -->

## License

BSL 1.1 (Business Source License). Converts to Apache 2.0 on 2030-02-01. Non-production use is free.
