# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install most packages using Homebrew
/opt/homebrew/bin/brew bundle

# Install apps that are not available through Homebrew
if [ ! -d /Applications/Looq.app ]; then
  looq_stage_dir=$(mktemp -d /tmp/looq-install.XXXXXX)
  curl -fL https://releases.parcse.com/looq/Looq-latest.dmg -o "$looq_stage_dir/Looq.dmg"
  hdiutil attach "$looq_stage_dir/Looq.dmg" -nobrowse -readonly -mountpoint "$looq_stage_dir/mount"
  ditto "$looq_stage_dir/mount/Looq.app" /Applications/Looq.app
  hdiutil detach "$looq_stage_dir/mount"
  rm -f "$looq_stage_dir/Looq.dmg"
  rmdir "$looq_stage_dir"
fi

# Link mise config before installing managed tools
mkdir -p $HOME/.config
if [ ! -e $HOME/.config/mise ]; then
  ln -s $HOME/Repos/ravern/dots/config/mise $HOME/.config/mise
fi

# Install Mint packages
/opt/homebrew/bin/mint bootstrap

# Install Rust and global binaries
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | /bin/bash
$HOME/.cargo/bin/cargo install pazi
$HOME/.cargo/bin/cargo install cargo-edit
$HOME/.cargo/bin/cargo install cargo-bundle
$HOME/.cargo/bin/cargo install --features vendored-openssl --locked --bin jj jj-cli
$HOME/.cargo/bin/rustup toolchain install nightly

# Install Node and global JS tools
/opt/homebrew/bin/mise trust $HOME/.config/mise/config.toml
/opt/homebrew/bin/mise install
/opt/homebrew/bin/mise reshim

# Install Python apps
/opt/homebrew/bin/pipx install fava || /opt/homebrew/bin/pipx upgrade fava
/opt/homebrew/bin/pipx install rendercv || /opt/homebrew/bin/pipx upgrade rendercv

# Select Ruby
/opt/homebrew/bin/rbenv install -s 2.7.8
/opt/homebrew/bin/rbenv global 2.7.8

# Install Coq and global packages
opam pin add coq 8.18.0
opam install vscoq-language-server

# Install Zsh plugins
mkdir -p $HOME/.local/zsh/plugins
git clone https://github.com/zsh-users/zsh-autosuggestions     $HOME/.local/zsh/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting $HOME/.local/zsh/plugins/zsh-syntax-highlighting

# Link config files
mkdir -p $HOME/.config
mkdir -p $HOME/.config/emacs
mkdir -p $HOME/.cargo
mkdir -p $HOME/.claude
mkdir -p $HOME/.codex
mkdir -p $HOME/.cursor
mkdir -p $HOME/.local/bin
if [ ! -f $HOME/Repos/ravern/dots/config/env.zsh ]; then
  cp $HOME/Repos/ravern/dots/config/env.zsh.example $HOME/Repos/ravern/dots/config/env.zsh
  chmod 600 $HOME/Repos/ravern/dots/config/env.zsh
fi
ln -s $HOME/Repos/ravern/dots/config/.zprofile             $HOME/.zprofile
ln -s $HOME/Repos/ravern/dots/config/.zshrc               $HOME/.zshrc
ln -s $HOME/Repos/ravern/dots/config/.gitconfig           $HOME/.gitconfig
if [ ! -e $HOME/.config/env.zsh ]; then
  ln -s $HOME/Repos/ravern/dots/config/env.zsh             $HOME/.config/env.zsh
fi
ln -s $HOME/Repos/ravern/dots/config/starship.toml        $HOME/.config/starship.toml
ln -s $HOME/Repos/ravern/dots/config/ghostty              $HOME/.config/ghostty
ln -s $HOME/Repos/ravern/dots/config/.cargo/config.toml   $HOME/.cargo/config.toml
ln -s $HOME/Repos/ravern/dots/config/jj                   $HOME/Library/Application\ Support/jj
ln -s $HOME/Repos/ravern/dots/config/claude/settings.json $HOME/.claude/settings.json
ln -s $HOME/Repos/ravern/dots/config/claude/CLAUDE.md     $HOME/.claude/CLAUDE.md
ln -s $HOME/Repos/ravern/dots/config/codex/config.toml    $HOME/.codex/config.toml
ln -s $HOME/Repos/ravern/dots/config/codex/hooks.json     $HOME/.codex/hooks.json
ln -s $HOME/Repos/ravern/dots/config/cursor/permissions.json $HOME/.cursor/permissions.json
ln -s $HOME/Repos/ravern/dots/config/bin/sish             $HOME/.local/bin/sish
