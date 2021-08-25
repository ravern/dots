local fn = vim.fn
local execute = vim.api.nvim_command

local install_path = fn.stdpath('data')..'/site/pack/packer/start/packer.nvim'

if fn.empty(fn.glob(install_path)) > 0 then
  fn.system({'git', 'clone', 'https://github.com/wbthomason/packer.nvim', install_path})
end

require('packer').startup(function(use)
	use 'wbthomason/packer.nvim'

  use 'neovim/nvim-lspconfig'
  use 'nvim-lua/lsp_extensions.nvim'
  use 'nvim-lua/completion-nvim'

	use {
		'nvim-telescope/telescope.nvim',
		requires = {
      {'nvim-lua/popup.nvim'},
      {'nvim-lua/plenary.nvim'}
    }
	}
  use {
    'folke/trouble.nvim',
    config = function()
      require('trouble').setup {
        icons = false,
      }
    end
  }

  use 'nvim-treesitter/nvim-treesitter'

  use 'Lokaltog/vim-monotone'
end)

require('plugins.completion')
require('plugins.telescope')
require('plugins.nvim-treesitter')
require('plugins.lspconfig')
require('plugins.lsp_extensions')
