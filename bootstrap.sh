# Install Rosetta 2
/usr/sbin/softwareupdate --install-rosetta --agree-to-license

# Install Homebrew (on both architectures)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
arch -x86_64 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install most packages using Homebrew
/opt/homebrew/bin/brew bundle

# Install Rust and global binaries
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | /bin/bash
$HOME/.cargo/bin/cargo install pazi
$HOME/.cargo/bin/cargo install cargo-edit

# Install Node and global packages
/opt/homebrew/bin/volta install node@12
/opt/homebrew/bin/volta install yarn
/opt/homebrew/bin/volta install http-server
/opt/homebrew/bin/volta install live-server
/opt/homebrew/bin/volta install local-ssl-proxy

# Install Coq and global packages
opam pin add coq 8.18.0
opam install vscoq-language-server

# Install Zsh plugins
git clone https://github.com/zsh-users/zsh-autosuggestions     $HOME/.local/zsh/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting $HOME/.local/zsh/plugins/zsh-syntax-highlighting

# Link config files
mkdir -p $HOME/.config
ln -s $HOME/Repos/ravern/dots/config/.zshrc        $HOME/.zshrc
ln -s $HOME/Repos/ravern/dots/config/.gitconfig    $HOME/.gitconfig
ln -s $HOME/Repos/ravern/dots/config/starship.toml $HOME/.config/starship.toml
ln -s $HOME/Repos/ravern/dots/config/alacritty     $HOME/.config/alacritty
ln -s $HOME/Repos/ravern/dots/config/.cargo/config $HOME/.cargo/config
ln -s $HOME/Repos/ravern/dots/config/nvim          $HOME/.config/nvim
