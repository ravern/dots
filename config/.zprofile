# Environments
source $HOME/.cargo/env
eval "$(/opt/homebrew/bin/brew shellenv)"
eval "$(/opt/homebrew/bin/mise activate zsh --shims)"
eval "$(rbenv init - zsh)"
eval "$(opam env)"

# Exports
export LANG=en_US.UTF-8
export TERM=xterm-256color
export HOMEBREW_NO_AUTO_UPDATE=1
export GOPATH=$HOME/.go
export DOTS_PATH=$HOME/Repos/ravern/dots
export PNPM_HOME=$HOME/Library/pnpm
export ANDROID_HOME=$HOME/Library/Android/sdk
export BUN_INSTALL=$HOME/.bun
export PATH=/opt/homebrew/bin:$PATH
export PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PNPM_HOME:$PATH
export PATH=$PATH:/opt/homebrew/opt/openjdk@17/bin
export PATH=$PATH:/Library/TeX/texbin
export PATH=$PATH:$HOME/.dotnet/tools
export PATH=$HOME/.local/bin:$PATH
export PATH=$HOME/.cabal/bin:$PATH
export PATH=$HOME/.zig/bin:$PATH
export PATH=$HOME/.go/bin:$PATH
export PATH=$BUN_INSTALL/bin:$PATH
export PATH=$HOME/.mint/bin:$PATH
export LIBRARY_PATH=$LIBRARY_PATH:/opt/homebrew/lib
export INCLUDE_PATH=$INCLUDE_PATH:/opt/homebrew/include
export PATH="$HOME/.elan/bin:$PATH"

# Load private environment variables and expose them to macOS GUI apps.
ENV_ZSH="$HOME/.config/env.zsh"
if [ -f "$ENV_ZSH" ]; then
  source "$ENV_ZSH"

  if command -v launchctl >/dev/null 2>&1; then
    while IFS= read -r env_name; do
      [ -n "${(P)env_name:-}" ] && launchctl setenv "$env_name" "${(P)env_name}"
    done < <(sed -nE 's/^[[:space:]]*export[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)(=.*)?$/\1/p' "$ENV_ZSH")
  fi
fi
unset ENV_ZSH
