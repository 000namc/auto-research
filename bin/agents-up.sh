#!/usr/bin/env bash
# agents-up.sh — start the agents container.
#
# The agents container's entrypoint (bin/agents-entrypoint.sh, run inside the
# container) spawns the 4 Claude Code tmux sessions automatically.
#
# Usage: bin/agents-up.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! docker compose -f build/docker-compose.yml ps agents --format json 2>/dev/null | grep -q '"State":"running"'; then
  echo "Starting agents container..."
  docker compose -f build/docker-compose.yml up -d agents
else
  echo "agents container is already running."
fi

# Brief wait for entrypoint to finish spawning
sleep 3

echo
echo "tmux sessions inside container:"
docker exec auto-research-agents tmux ls 2>&1 | grep '^agent-' || echo "  (none yet — try again in a moment)"

echo
echo "Inspect: bin/agent-pane.sh <role>"
echo "Attach:  bin/agent-attach.sh <role>"
echo "Stop:    bin/agents-down.sh"
