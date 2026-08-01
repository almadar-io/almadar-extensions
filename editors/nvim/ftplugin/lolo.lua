-- Mirrors editors/zed/languages/lolo/config.toml and the VSCode
-- language-configuration-lolo.json.
vim.bo.commentstring = ";; %s"
vim.bo.comments = "s:#=,e:=#,:;;,:#"
vim.bo.expandtab = true
vim.bo.shiftwidth = 2
vim.bo.tabstop = 2
vim.bo.softtabstop = 2

-- `-` and `/` are word characters in lolo: `render-ui`, `math/add`,
-- `game-core` are single identifiers, so `w`/`*`/`gd` should treat them so.
vim.opt_local.iskeyword:append({ "-", "/" })

vim.opt_local.matchpairs:append("<:>")

vim.b.undo_ftplugin = table.concat({
    "setlocal commentstring< comments< expandtab< shiftwidth< tabstop<",
    "softtabstop< iskeyword< matchpairs<",
}, " ")
