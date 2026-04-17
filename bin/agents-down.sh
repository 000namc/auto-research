#!/usr/bin/env bash
# agents-down.sh — stop the agents container (kills all tmux sessions inside).
#
# Usage: bin/agents-down.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

docker compose -f build/docker-compose.yml stop agents
echo "agents container stopped."
