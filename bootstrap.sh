# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install most packages using Homebrew
/opt/homebrew/bin/brew bundle

# Install Rust

# Install Node
/opt/homebrew/bin/volta install node@12
/opt/homebrew/bin/volta install yarn
/opt/homebrew/bin/volta install typescript-language-server
/opt/homebrew/bin/volta install typescript
/opt/homebrew/bin/volta install eslint_d

# Install Zsh plugins
git clone https://github.com/zsh-users/zsh-autosuggestions     $HOME/.local/zsh/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting $HOME/.local/zsh/plugins/zsh-syntax-highlighting

# Install Neovim plugin manager
git clone https://github.com/wbthomason/packer.nvim $HOME/.local/share/nvim/site/pack/packer/start/packer.nvim

# Link config files
ln -s $HOME/Repos/ravern/dots/config/.zshrc        $HOME/.zshrc
ln -s $HOME/Repos/ravern/dots/config/starship.toml $HOME/.config/starship.toml
ln -s $HOME/Repos/ravern/dots/config/nvim          $HOME/.config/nvim
