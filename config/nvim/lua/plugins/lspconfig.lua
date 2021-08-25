local lsp = require('lspconfig')

-- Generic key bindings.

local on_attach = function(_, buffer) 
	require('completion').on_attach()

	local function buf_set_keymap(...) vim.api.nvim_buf_set_keymap(buffer, ...) end
	local function buf_set_option(...) vim.api.nvim_buf_set_option(buffer, ...) end

	buf_set_option('omnifunc', 'v:lua.vim.lsp.omnifunc')

	local opts = { noremap=true, silent=true }

	buf_set_keymap('n', 'gD', '<Cmd>lua vim.lsp.buf.declaration()<CR>', opts)
	buf_set_keymap('n', 'gd', '<Cmd>lua vim.lsp.buf.definition()<CR>', opts)
	buf_set_keymap('n', 'K', '<Cmd>lua vim.lsp.buf.hover()<CR>', opts)

	buf_set_keymap('n', 'gi', '<cmd>lua vim.lsp.buf.implementation()<CR>', opts)
	buf_set_keymap('n', '<C-k>', '<cmd>lua vim.lsp.buf.signature_help()<CR>', opts)
	buf_set_keymap('n', 'gr', '<cmd>lua vim.lsp.buf.references()<CR>', opts)
	buf_set_keymap('n', '[d', '<cmd>lua vim.lsp.diagnostic.goto_prev()<CR>', opts)
	buf_set_keymap('n', ']d', '<cmd>lua vim.lsp.diagnostic.goto_next()<CR>', opts)
end

-- Configure individual language servers.

lsp.rust_analyzer.setup { on_attach = on_attach }

lsp.beancount.setup {
  cmd = { "beancount-langserver", "--stdio" },
  init_options = {
    journalFile = "/Users/ravern/Repos/ravern/finances/main.beancount",
    pythonPath = "/usr/bin/python3",
  },
  on_attach = on_attach
}

lsp.tsserver.setup {
  on_attach = function(client)
    if client.config.flags then
      client.config.flags.allow_incremental_sync = true
    end
    client.resolved_capabilities.document_formatting = false
    on_attach(client)
  end
}

local eslint = {
  lintCommand = "eslint_d -f unix --stdin --stdin-filename ${INPUT}",
  lintStdin = true,
  lintFormats = {"%f:%l:%c: %m"},
  lintIgnoreExitCode = true,
  formatCommand = "eslint_d --fix-to-stdout --stdin --stdin-filename ${INPUT}",
  formatStdin = true
}
lsp.efm.setup {
  init_options = { documentFormatting = true },
  settings = {
    rootMarkers = {".git/"},
    languages = {
      typescript = {eslint},
      javascript = {eslint},
      typescriptreact = {eslint},
      javascriptreact = {eslint},
    },
  },
  filetypes = {
    "javascript",
    "javascriptreact",
    "javascript.jsx",
    "typescript",
    "typescript.tsx",
    "typescriptreact"
  },
  on_attach = function(client)
    client.resolved_capabilities.document_formatting = true
    client.resolved_capabilities.goto_definition = false
    on_attach(client)
  end,
}

vim.api.nvim_command('autocmd BufWritePre *.rs        lua vim.lsp.buf.formatting_sync()')
vim.api.nvim_command('autocmd BufWritePre *.js        lua vim.lsp.buf.formatting_sync()')
vim.api.nvim_command('autocmd BufWritePre *.jsx       lua vim.lsp.buf.formatting_sync()')
vim.api.nvim_command('autocmd BufWritePre *.ts        lua vim.lsp.buf.formatting_sync()')
vim.api.nvim_command('autocmd BufWritePre *.tsx       lua vim.lsp.buf.formatting_sync()')
vim.api.nvim_command('autocmd BufWritePre *.beancount lua vim.lsp.buf.formatting_sync()')
