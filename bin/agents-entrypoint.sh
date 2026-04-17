#!/usr/bin/env bash
# agents-entrypoint.sh — runs as PID 1 of the agents container.
#
# Responsibilities:
#   1. Start tmux server (sentinel session keeps it alive)
#   2. Spawn the 4 Claude Code agent sessions, each with its identity.md
#      injected via --append-system-prompt
#   3. Auto-confirm the trust dialog on first run for each session (Enter)
#      — host's .claude.json gets the path persisted, so subsequent restarts
#      won't see the prompt.
#   4. Idle-wait until container is signalled to stop, then clean up

set -euo pipefail

REPO_ROOT="/app/data/auto-research"
ROLES=(orchestrator research-worker execution-worker writing-worker)

cd "$REPO_ROOT"

echo "[entrypoint] starting tmux server (sentinel session)"
tmux new-session -d -s sentinel 'sleep infinity'

for role in "${ROLES[@]}"; do
  session="agent-$role"
  identity="$REPO_ROOT/agents/$role/identity.md"

  if [[ ! -f "$identity" ]]; then
    echo "[entrypoint] WARN: $identity missing, skipping $role"
    continue
  fi

  if tmux has-session -t "$session" 2>/dev/null; then
    echo "[entrypoint] $session already exists, skipping"
    continue
  fi

  # Spawn detached. spawn-agent.sh handles identity injection.
  tmux new-session -d -s "$session" -c "$REPO_ROOT" \
    "$REPO_ROOT/bin/spawn-agent.sh" "$role"
  echo "[entrypoint] spawned $session"

  # Auto-confirm the trust dialog if it appears (idempotent — Enter on a
  # clean prompt is harmless because the input field is empty).
  sleep 2
  if tmux capture-pane -t "$session" -p | grep -q 'trust this folder'; then
    tmux send-keys -t "$session" Enter
    echo "[entrypoint]   trust dialog auto-confirmed for $session"
    sleep 1
  fi
done

echo "[entrypoint] all agents spawned. tmux sessions:"
tmux ls

# Cleanup on signal
trap 'echo "[entrypoint] received signal, killing tmux server"; tmux kill-server 2>/dev/null || true; exit 0' SIGTERM SIGINT

# Idle forever
echo "[entrypoint] idle (PID $$) — waiting for signal"
exec sleep infinity
