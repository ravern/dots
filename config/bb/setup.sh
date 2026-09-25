#!/bin/sh
# bb has no declarative config: plugin installs, toggles, and settings live in
# ~/.bb/bb.db. This script replays them. Safe to rerun.
set -e

DIR=$HOME/Repos/ravern/dots/config/bb

if ! bb status >/dev/null 2>&1; then
  echo "bb is not running; open bb, then rerun $DIR/setup.sh"
  exit 0
fi

# Local plugins
for p in coordinator-threads customize-model-names reasoning-slider; do
  (cd $DIR/plugins/$p && npm ci --silent && bb plugin build)
  bb plugin install path:$DIR/plugins/$p --yes
done

# Community plugins
bb plugin install git:https://github.com/ChrBoebel/bb-plugin-provider-brand-marks.git@^0.1.0 --yes

# Disabled plugins
for p in coordinator-threads account-pool agent-annotations monaco-editor plugin-api-docs plugin-api-tester provider-pi workflows; do
  bb plugin disable $p
done

# Plugin settings
bb plugin config customize-model-names set visibleModels '{"claude-code":["Opus 5.5","Fable*"],"codex":["GPT-6*"],"acp-cursor":["Grok 4.7"]}'
bb plugin config provider-claude-code set memoryEnabled false
bb plugin config provider-claude-code set subagentsDisabled true
bb plugin config provider-claude-code set workflowsDisabled true
