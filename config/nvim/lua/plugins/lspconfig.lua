local lsp = require('lspconfig')

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

require('null-ls').config {
  sources = { require('null-ls').builtins.formatting.eslint_d }
}

lsp['null-ls'].setup {}
lsp['rust_analyzer'].setup { on_attach = on_attach }
lsp['tsserver'].setup {
  on_attach = function(client)
    client.resolved_capabilities.document_formatting = false
    vim.cmd("command -buffer Formatting lua vim.lsp.buf.formatting()")
    vim.cmd("autocmd BufWritePost <buffer> lua vim.lsp.buf.formatting()")

    local ts_utils = require("nvim-lsp-ts-utils")
    ts_utils.setup {
      eslint_bin = 'eslint_d',
      eslint_enable_code_actions = true,
    }
    ts_utils.setup_client(client)
  end
}

vim.api.nvim_command('autocmd BufWritePre *.rs lua vim.lsp.buf.formatting_sync()')
