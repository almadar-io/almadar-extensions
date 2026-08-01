-- `.orb` is JSON, but it gets its own filetype so the S-expression layer and
-- the orb-lsp diagnostics apply to it without touching real JSON files.
vim.filetype.add({
    extension = {
        lolo = "lolo",
        orb = "orb",
    },
})
