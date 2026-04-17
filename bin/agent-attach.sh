#!/usr/bin/env bash
# agent-attach.sh — attach to an agent's tmux session inside the container.
# Detach with Ctrl-B then D.
#
# Usage: bin/agent-attach.sh <role>
#   role: orchestrator | research-worker | execution-worker | writing-worker

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <role>" >&2
  echo "  role: orchestrator | research-worker | execution-worker | writing-worker" >&2
  exit 1
fi

session="agent-$1"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^auto-research-agents$'; then
  echo "ERROR: auto-research-agents container is not running." >&2
  exit 1
fi

if ! docker exec auto-research-agents tmux has-session -t "$session" 2>/dev/null; then
  echo "ERROR: $session is not running inside the container." >&2
  exit 1
fi

exec docker exec -it auto-research-agents tmux attach -t "$session"
