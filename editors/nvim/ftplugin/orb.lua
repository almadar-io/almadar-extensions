-- `.orb` is JSON IR. Mirrors editors/zed/languages/orb/config.toml.
vim.bo.commentstring = "// %s"
vim.bo.comments = "s1:/*,mb:*,ex:*/,://"
vim.bo.expandtab = true
vim.bo.shiftwidth = 2
vim.bo.tabstop = 2
vim.bo.softtabstop = 2
vim.bo.suffixesadd = ".orb"

vim.b.undo_ftplugin =
    "setlocal commentstring< comments< expandtab< shiftwidth< tabstop< softtabstop< suffixesadd<"
