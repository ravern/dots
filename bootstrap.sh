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
/opt/homebrew/bin/volta install typescript-language-server
/opt/homebrew/bin/volta install typescript
/opt/homebrew/bin/volta install eslint_d
/opt/homebrew/bin/volta install ios-deploy
/opt/homebrew/bin/volta install pkg
/opt/homebrew/bin/volta install http-server
/opt/homebrew/bin/volta install live-server
/opt/homebrew/bin/volta install local-ssl-proxy
/opt/homebrew/bin/volta install expo-cli

# Install Python packages
sudo /usr/bin/pip3 install beancount
sudo /usr/bin/pip3 install fava

# Install Zsh plugins
git clone https://github.com/zsh-users/zsh-autosuggestions     $HOME/.local/zsh/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting $HOME/.local/zsh/plugins/zsh-syntax-highlighting

# Link config files
ln -s $HOME/Repos/ravern/dots/config/.zshrc        $HOME/.zshrc
ln -s $HOME/Repos/ravern/dots/config/.gitconfig    $HOME/.gitconfig
ln -s $HOME/Repos/ravern/dots/config/starship.toml $HOME/.config/starship.toml
ln -s $HOME/Repos/ravern/dots/config/.cargo/config $HOME/.cargo/config
