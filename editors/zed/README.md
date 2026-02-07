# Almadar Orbital Extension for Zed

Language support for `.orb` files in the Zed editor.

## Features

- **JSON base grammar** with S-expression highlighting
- **TypeScript LSP validation** via the wrapper trick (`.orb` → virtual `.ts`)
- **S-expression highlighting**: operators, bindings, events, UI slots
- **Bracket matching** and comment toggling

## Installation

### Manual (Development)

```bash
# Linux
cp -r editors/zed ~/.config/zed/extensions/almadar-orb

# macOS
cp -r editors/zed ~/Library/Application\ Support/Zed/extensions/almadar-orb
```

Restart Zed to activate.

## How It Works

1. `.orb` files use JSON grammar as base
2. `highlights.scm` adds S-expression highlighting via TreeSitter queries
3. TypeScript LSP provides structural validation, autocomplete, and hover docs
4. When `@almadar/core` types change, rebuild the package — Zed picks up the updated types automatically
