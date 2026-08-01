-- Entry point: registers the `:Orb*` commands and attaches highlighting and
-- the language server per `.lolo` / `.orb` buffer. Loading is lazy — nothing
-- compiles a parser or spawns a server until such a buffer is opened.
if vim.g.loaded_almadar then
    return
end
vim.g.loaded_almadar = true

require("almadar.commands").setup()

vim.api.nvim_create_autocmd("FileType", {
    group = vim.api.nvim_create_augroup("almadar", { clear = true }),
    pattern = { "lolo", "orb" },
    desc = "Almadar: attach tree-sitter highlighting and orb-lsp",
    callback = function(args)
        local lang = args.match
        require("almadar.treesitter").attach(args.buf, lang)

        local _, err = require("almadar.lsp").start(args.buf)
        if err then
            -- Surfaced once per session, not per buffer: a missing server is a
            -- setup problem, and repeating it on every file is noise.
            if not vim.g.almadar_lsp_warned then
                vim.g.almadar_lsp_warned = true
                vim.notify("orb-lsp not started: " .. err, vim.log.levels.WARN, { title = "almadar" })
            end
        end
    end,
})
