#!/usr/bin/env bash
# agents-status.sh — list agent sessions inside the agents container.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ROLES=(orchestrator research-worker execution-worker writing-worker)

# Container running?
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^auto-research-agents$'; then
  echo "agents container is NOT running. Start with: bin/agents-up.sh"
  exit 1
fi

printf "%-20s %-10s %-25s %-12s %-12s\n" "ROLE" "TMUX" "HEARTBEAT" "INBOX" "OUTBOX"
printf "%-20s %-10s %-25s %-12s %-12s\n" "----" "----" "---------" "-----" "------"

for role in "${ROLES[@]}"; do
  session="agent-$role"

  if docker exec auto-research-agents tmux has-session -t "$session" 2>/dev/null; then
    tmux_state="up"
  else
    tmux_state="down"
  fi

  status_file="$REPO_ROOT/agents/$role/status"
  if [[ -f "$status_file" && -s "$status_file" ]]; then
    heartbeat=$(cat "$status_file")
  else
    heartbeat="-"
  fi

  inbox_dir="$REPO_ROOT/agents/$role/inbox"
  inbox_count=$(find "$inbox_dir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')

  outbox_dir="$REPO_ROOT/agents/$role/outbox"
  outbox_count=$(find "$outbox_dir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')

  printf "%-20s %-10s %-25s %-12s %-12s\n" \
    "$role" "$tmux_state" "$heartbeat" "$inbox_count" "$outbox_count"
done
