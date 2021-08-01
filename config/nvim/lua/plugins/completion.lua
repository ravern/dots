vim.api.nvim_command('inoremap <expr>  <Tab>   pumvisible() ? "\\<C-n>" : "\\<Tab>"')
vim.api.nvim_command('inoremap <expr>  <S-Tab> pumvisible() ? "\\<C-p>" : "\\<S-Tab>"')
vim.api.nvim_command('imap             <Tab>   <Plug>(completion_smart_tab)')
vim.api.nvim_command('imap             <S-Tab> <Plug>(completion_smart_s_tab)')

vim.o.completeopt = 'menuone,noinsert,noselect'
vim.o.shortmess   = vim.o.shortmess..'c'

vim.g.completion_enable_auto_popup = 0
