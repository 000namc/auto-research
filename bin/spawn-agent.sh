#!/usr/bin/env bash
# Spawn a claude session for an agent and inject its identity via
# --append-system-prompt.
#
# Usage:
#   spawn-agent.sh <role>               # singleton
#   spawn-agent.sh <role> <instance>    # multi-role instance
#
# Singletons read identity from:     agents/<role>/identity.md
# Multi-role instances try:          agents/<role>/<instance>/identity.md
#                                    (falls back to agents/<role>/identity.md
#                                     if the per-instance file isn't present,
#                                     so a worker pool can share a single
#                                     identity and differentiate only by its
#                                     name + instance-scoped inbox/outbox)
#
# Both callers issue a tmux command of the form:
#   tmux new-session -d -s <session> -c /app/data/auto-research \
#       /app/data/auto-research/bin/spawn-agent.sh <role> [instance]
#
# The tmux server (which lives inside the agents container) executes this
# script in its own context, so claude is spawned as an agents-container
# process — which is what we want.

set -euo pipefail

# tmux new-session inherits the *client*'s environment when called from
# another container. The api container does not carry the claude binary in
# its PATH (only the agents container does), so when the api triggers a
# session start, the resulting pane would fail to find claude. Force the
# correct PATH + HOME here so spawn-agent works regardless of caller.
export PATH="/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/ubuntu"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <role> [instance]" >&2
  exit 64
fi

ROLE="$1"
INSTANCE="${2-}"
REPO="/app/data/auto-research"
# Resolve claude binary from PATH (set above). The compose file bind-mounts
# the host's claude binary into /home/ubuntu/.local/bin/, which is on PATH.
CLAUDE="$(command -v claude || true)"

if [[ -n "$INSTANCE" ]]; then
  INSTANCE_IDENTITY="$REPO/agents/$ROLE/$INSTANCE/identity.md"
  ROLE_IDENTITY="$REPO/agents/$ROLE/identity.md"
  if [[ -f "$INSTANCE_IDENTITY" ]]; then
    IDENTITY="$INSTANCE_IDENTITY"
  elif [[ -f "$ROLE_IDENTITY" ]]; then
    IDENTITY="$ROLE_IDENTITY"
  else
    echo "ERROR: no identity file for $ROLE/$INSTANCE (tried $INSTANCE_IDENTITY, $ROLE_IDENTITY)" >&2
    exit 1
  fi
else
  IDENTITY="$REPO/agents/$ROLE/identity.md"
  if [[ ! -f "$IDENTITY" ]]; then
    echo "ERROR: identity file not found: $IDENTITY" >&2
    exit 1
  fi
fi

if [[ -z "$CLAUDE" || ! -x "$CLAUDE" ]]; then
  echo "ERROR: claude binary not found on PATH ($PATH)" >&2
  echo "       check that the host's claude install is bind-mounted into the agents container (see build/docker-compose.yml)" >&2
  exit 1
fi

# Expose the instance name + address to the agent via env so identity.md can
# reference $AGENT_NAME / $AGENT_ADDRESS if it wants. (Claude Code inherits
# env from the spawning shell.)
export AGENT_ROLE="$ROLE"
export AGENT_NAME="$INSTANCE"
if [[ -n "$INSTANCE" ]]; then
  export AGENT_ADDRESS="$ROLE/$INSTANCE"
else
  export AGENT_ADDRESS="$ROLE"
fi

# Defensive tmux hygiene — runs every time a new agent session is spawned,
# so these settings heal themselves even if the tmux server restarts.
#
# Three sources of visual garbage in xterm.js panes:
#   1) `status-format[1]` override adds a second status line showing
#      `pane_index[WxH]`, duplicating status info and pushing content.
#   2) Default `status-right` includes `#{?window_bigger,[offset_x,offset_y],}`
#      which renders a `[0,0]` marker whenever the attached client's viewport
#      is larger than the tmux window — and also pads the delta area with `·`.
#   3) `aggressive-resize off` (tmux default) means the window does NOT
#      auto-resize to the attached client's size, so window_bigger trips
#      easily and stays tripped.
#
# Fix all three. `|| true` so the spawn doesn't fail if the option is unset.
tmux set-option -gu 'status-format[1]'      2>/dev/null || true
# The default `status-right` includes `#{?window_bigger,[ox,oy],}` which
# paints a `[0,0]` offset marker and pads the delta area with `·` whenever
# the attached xterm viewport differs from the window — creating the
# infamous "dot grid ghosting". The cleanest fix (matches dojang's tmux
# config) is to turn status off entirely: agents run one pane per session,
# no multiplexing needed, so the status bar is pure visual noise anyway.
tmux set-option -g  status off              2>/dev/null || true
tmux set-option -gw aggressive-resize on    2>/dev/null || true

cd "$REPO"
exec "$CLAUDE" --append-system-prompt "$(cat "$IDENTITY")"
