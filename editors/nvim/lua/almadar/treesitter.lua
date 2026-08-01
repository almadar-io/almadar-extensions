--- Tree-sitter wiring for `.lolo` and `.orb`.
---
--- `.lolo` has a real grammar (`tree-sitter-lolo`, shared with the Zed
--- extension). Its generated `parser.c` is committed, so the parser is built
--- on demand with the system C compiler — no nvim-treesitter dependency and
--- nothing to fetch.
---
--- `.orb` is JSON. Rather than mapping the filetype onto the `json` language
--- (which would force every `.orb`-specific query into `queries/json/`, where
--- it would also apply to real JSON files), the stock JSON parser is loaded a
--- second time under the language name `orb` via `symbol_name`. That gives
--- `.orb` its own query namespace — `queries/orb/highlights.scm` — layering
--- the S-expression highlighting on top of JSON without touching `json`.
local config = require("almadar.config")

local M = {}

local uv = vim.uv or vim.loop
local is_windows = vim.fn.has("win32") == 1
local LIB_EXT = is_windows and ".dll" or ".so"

---@type table<string, boolean>
local registered = {}

--- Is `lang` loaded? Creating a parser is the one check that behaves the same
--- on every Neovim version.
---@param lang string
---@return boolean
local function language_loaded(lang)
    return (pcall(vim.treesitter.get_string_parser, "", lang))
end

--- `vim.treesitter.language.add` has two contracts: Neovim ≤0.11 returns
--- nothing and *raises* when the parser cannot be found, ≥0.12 returns
--- `nil, err` and raises nothing. Neither a bare `pcall` nor the return value
--- alone is conclusive, so the result is verified by loading the language.
---@param lang string
---@param opts table|nil
---@return boolean ok, string|nil err
local function add_language(lang, opts)
    local called, add_err = pcall(vim.treesitter.language.add, lang, opts)
    if language_loaded(lang) then
        return true
    end
    return false,
        (not called and tostring(add_err)) or ("could not load the %q parser"):format(lang)
end

--- Directory holding tree-sitter-lolo's generated sources.
---@return string|nil dir, string|nil err
local function grammar_dir()
    local configured = config.options.treesitter.grammar_dir
    if configured then
        local src = vim.fs.joinpath(configured, "src")
        if uv.fs_stat(vim.fs.joinpath(src, "parser.c")) then
            return src
        end
        return nil, ("no parser.c under configured grammar_dir: %s"):format(configured)
    end

    -- Installed from the monorepo: editors/nvim/ and editors/zed/ are siblings.
    local root = config.plugin_root()
    local candidates = {
        vim.fs.joinpath(root, "tree-sitter-lolo", "src"),
        vim.fs.joinpath(vim.fs.dirname(root), "zed", "tree-sitter-lolo", "src"),
    }
    for _, dir in ipairs(candidates) do
        if uv.fs_stat(vim.fs.joinpath(dir, "parser.c")) then
            return dir
        end
    end
    return nil, ("tree-sitter-lolo sources not found (looked in %s)"):format(table.concat(candidates, ", "))
end

---@return string
local function parser_dir()
    return config.options.treesitter.parser_dir
        or vim.fs.joinpath(vim.fn.stdpath("data"), "almadar", "parser")
end

--- First compiler on the configured list that exists.
---@return string[]|nil argv_prefix
local function find_compiler()
    for _, entry in ipairs(config.options.treesitter.compiler) do
        local argv = vim.split(entry, "%s+")
        if vim.fn.executable(argv[1]) == 1 then
            return argv
        end
    end
    return nil
end

--- Build `<parser_dir>/lolo.so` from the committed grammar sources.
---@param opts { force: boolean|nil }|nil
---@return string|nil path, string|nil err
function M.build(opts)
    opts = opts or {}
    local src, err = grammar_dir()
    if not src then
        return nil, err
    end

    local out_dir = parser_dir()
    vim.fn.mkdir(out_dir, "p")
    local out = vim.fs.joinpath(out_dir, "lolo" .. LIB_EXT)

    local parser_c = vim.fs.joinpath(src, "parser.c")
    local built = uv.fs_stat(out)
    if built and not opts.force then
        -- Rebuild only when the grammar is newer than the artifact.
        local source_stat = uv.fs_stat(parser_c)
        if source_stat and source_stat.mtime.sec <= built.mtime.sec then
            return out
        end
    end

    local cc = find_compiler()
    if not cc then
        return nil,
            ("no C compiler found (tried %s)"):format(table.concat(config.options.treesitter.compiler, ", "))
    end

    local argv = vim.list_extend(vim.deepcopy(cc), {
        "-o", out, "-shared", "-Os", "-fPIC", "-I", src, parser_c,
    })
    -- Some grammars ship an external scanner; tree-sitter-lolo does not, but
    -- pick it up automatically if one is ever added.
    for _, scanner in ipairs({ "scanner.c", "scanner.cc" }) do
        local path = vim.fs.joinpath(src, scanner)
        if uv.fs_stat(path) then
            table.insert(argv, path)
        end
    end

    local result = vim.system(argv, { text = true }):wait()
    if result.code ~= 0 then
        return nil, ("compiling the lolo parser failed (%s):\n%s"):format(
            table.concat(argv, " "), (result.stderr or "") .. (result.stdout or "")
        )
    end
    return out
end

--- Load the `.lolo` parser, building it first if needed.
---@return boolean ok, string|nil err
local function register_lolo()
    if registered.lolo then
        return true
    end
    -- Someone else (nvim-treesitter, a manual install) may already provide it.
    if add_language("lolo") then
        registered.lolo = true
        return true
    end

    local path, err = M.build({ force = false })
    if not path then
        if not config.options.treesitter.auto_install then
            return false, "lolo parser not installed and treesitter.auto_install is false"
        end
        return false, err
    end

    local ok, add_err = add_language("lolo", { path = path })
    if not ok then
        return false, add_err
    end
    registered.lolo = true
    return true
end

--- Load the stock JSON parser a second time under the language name `orb`.
---@return boolean ok, string|nil err
local function register_orb()
    if registered.orb then
        return true
    end
    local found = vim.api.nvim_get_runtime_file("parser/json" .. LIB_EXT, false)[1]
    if not found then
        return false, "no JSON tree-sitter parser found on runtimepath (`:TSInstall json`)"
    end
    local ok, err = add_language("orb", { path = found, symbol_name = "json" })
    if not ok then
        return false, err
    end
    registered.orb = true
    return true
end

--- Ensure the parser for `lang` is loaded.
---@param lang "lolo"|"orb"
---@return boolean ok, string|nil err
function M.ensure(lang)
    if lang == "lolo" then
        return register_lolo()
    elseif lang == "orb" then
        return register_orb()
    end
    return false, "unknown language: " .. tostring(lang)
end

--- Attach highlighting to `bufnr`, falling back to the regex syntax file when
--- the tree-sitter parser is unavailable.
---@param bufnr integer
---@param lang "lolo"|"orb"
function M.attach(bufnr, lang)
    if not config.options.treesitter.enabled then
        vim.bo[bufnr].syntax = lang
        return
    end

    local ok, err = M.ensure(lang)
    if not ok then
        -- The generated syntax/<lang>.vim covers the same token registry.
        vim.bo[bufnr].syntax = lang
        vim.b[bufnr].almadar_treesitter_error = err
        return
    end

    -- `vim.treesitter.start` turns regex syntax off, and that is the right
    -- call here: measured over the std corpus, tree-sitter's error recovery
    -- still colours 92–95% of lines even in files it cannot parse at all —
    -- the same share as a clean file — so layering the regex syntax on top
    -- would only cost a second highlighter pass.
    local started, start_err = pcall(vim.treesitter.start, bufnr, lang)
    if not started then
        vim.bo[bufnr].syntax = lang
        vim.b[bufnr].almadar_treesitter_error = tostring(start_err)
    end
end

return M
