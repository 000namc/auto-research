#!/usr/bin/env bash
# agent-pane.sh — capture an agent's tmux pane content from inside the container.
#
# Usage: bin/agent-pane.sh <role> [n_lines]

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <role> [n_lines]" >&2
  exit 1
fi

session="agent-$1"
lines="${2:-50}"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^auto-research-agents$'; then
  echo "ERROR: auto-research-agents container is not running." >&2
  exit 1
fi

if ! docker exec auto-research-agents tmux has-session -t "$session" 2>/dev/null; then
  echo "ERROR: $session is not running inside the container." >&2
  exit 1
fi

docker exec auto-research-agents tmux capture-pane -t "$session" -p | tail -n "$lines"
