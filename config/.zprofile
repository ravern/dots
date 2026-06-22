# Environments
source $HOME/.cargo/env
eval "$(/opt/homebrew/bin/brew shellenv)"
eval "$(rbenv init - zsh)"
eval "$(opam env)"

# Exports
export LANG=en_US.UTF-8
export TERM=xterm-256color
export HOMEBREW_NO_AUTO_UPDATE=1
export GOPATH=$HOME/.go
export DOTS_PATH=$HOME/Repos/ravern/dots
export PATH=/opt/homebrew/bin:$PATH
export PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH
export PATH=$PATH:$HOME/.dotnet/tools
export PATH=$HOME/.local/bin:$PATH
export PATH=$HOME/.go/bin:$PATH
export PATH=$HOME/.mint/bin:$PATH
export LIBRARY_PATH=$LIBRARY_PATH:/opt/homebrew/lib
export INCLUDE_PATH=$INCLUDE_PATH:/opt/homebrew/include
export PATH="/Users/ravern/.antigravity/antigravity/bin:$PATH"
eval "$(/opt/homebrew/bin/mise activate zsh --shims)"

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
