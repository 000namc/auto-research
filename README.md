# auto-research

Human-in-the-loop 자동 연구 파이프라인. 프로젝트 맥락은 [`CLAUDE.md`](CLAUDE.md) 참조.

웹앱은 두 개의 보드로 나뉜다:
- **🔬 Research** — 확정된 아이디어를 `idea → run → write → done` 게이트를 거쳐 수행. `projects/<slug>/card.md` 가 단일 소스.
- **🧭 Explore** — 자유탐색. `explore/<slug>/direction.md` 에 "시키고 싶은 자동 리서치 방향"을 적으면 그 아래 `findings/f001-*.md` 로 결과가 쌓인다. 마음에 드는 finding 은 Research 로 승격.

## Quick start

**전제:**

1. Linux/macOS 호스트, Docker (24+) + docker compose plugin
2. [Claude Code](https://claude.ai/code) 설치 및 로그인 (`~/.claude/`, `~/.claude.json` 생성됨)
3. (옵션) NVIDIA GPU + nvidia-container-toolkit — execution-worker가 학습 실험을 돌릴 때 필요

```bash
# 1. Configure (한 번만)
cp .env.example .env
$EDITOR .env                        # CLAUDE_HOME 등 본인 경로 확인

# 2. Bring up the dev stack (agents + api + web). Builds on first run.
docker compose -f build/docker-compose.yml up -d --build

# 3. Open the webapp
#    같은 머신: 브라우저에서 http://localhost:5173
#    원격 서버: SSH `LocalForward 5173 localhost:5173` 후 같은 URL
#    (자세한 원격 접속은 docs/webapp-access.md)

# 4. Tail logs
docker compose -f build/docker-compose.yml logs -f agents
docker compose -f build/docker-compose.yml logs -f api
docker compose -f build/docker-compose.yml logs -f web

# 5. Run parser tests
docker compose -f build/docker-compose.yml run --rm --no-deps api \
    pytest src/shared/test_card.py -v

# 6. Stop everything (no data loss; bind mounts keep state on disk)
docker compose -f build/docker-compose.yml down
```

## What's in the stack

| Service | Port | Base | Purpose |
|---|---|---|---|
| `agents` | (none, internal tmux only) | ubuntu:24.04 | tmux server + 4 Claude Code sessions (orchestrator + research/execution/writing workers). Identity injected via `--append-system-prompt`. |
| `api` | `127.0.0.1:8000` | python:3.12-slim | FastAPI: card + direction CRUD, docs editor, SSE on `/api/events`, agent control via shared tmux socket |
| `web` | `127.0.0.1:5173` | node:20-alpine | Vite dev server (React + Tailwind) — Research / Explore 2-view |

`api` and `web` use `network_mode: host` to bind to 127.0.0.1 only — never exposed externally. For remote access, use SSH `LocalForward` (see [`docs/webapp-access.md`](docs/webapp-access.md)).

`agents` and `api` share the `tmux-socket` named volume so the api container's tmux client can control sessions inside the agents container without docker exec.

**Path uniformity:** every container mounts the project at `/app/data/auto-research`. Identity files use relative paths so the same files work in both host and containers.

## Agent helpers (host CLI)

```bash
bin/agents-up.sh        # docker compose up agents (idempotent)
bin/agents-down.sh      # docker compose stop agents
bin/agents-status.sh    # show tmux session state + heartbeat + inbox/outbox counts
bin/agent-pane.sh <role>      # capture-pane content
bin/agent-attach.sh <role>    # attach to a session interactively (Ctrl-B D to detach)
```

Agent control is also available through the webapp.

## Layout

```
src/
├── shared/         # card.md + direction.md parsers/serializers (pytest-tested)
├── api/            # FastAPI app + SSE broadcaster
└── web/            # React + Vite + Tailwind — Research Kanban + Explore view
agents/             # 4 tmux session identities (orchestrator + 3 workers)
├── orchestrator/{identity.md, inbox/, outbox/, status, log}
├── research-worker/  …
├── execution-worker/ …
└── writing-worker/   …
bin/                # host CLI helpers (docker-aware)
build/              # Dockerfiles + docker-compose.yml
docs/               # public docs (card-schema, state-machine, explore-schema, …)
└── private/        # gitignored — your own progress, research direction, etc.
projects/           # 🔬 Research cards (idea/run/write/done)
└── example/        # sample card; your own cards live at projects/<slug>/card.md
explore/            # 🧚 gitignored — Explore directions + findings
                    # each direction is explore/<slug>/{direction.md, findings/}
templates/          # experiment scaffolds
```

## Key files to read first

1. [`CLAUDE.md`](CLAUDE.md) — project-wide architecture, decisions, conventions
2. [`docs/card-schema.md`](docs/card-schema.md) — Research card.md contract (orchestrator/webapp/sub-agents)
3. [`docs/state-machine.md`](docs/state-machine.md) — Research loop transitions, 3 gates, sub-agent dispatch
4. [`docs/explore-schema.md`](docs/explore-schema.md) — Explore Kanban (direction + finding) contract
5. [`docs/methodology-review.md`](docs/methodology-review.md) — failure mode survey + safety decisions
6. [`docs/venue-selection-guide.md`](docs/venue-selection-guide.md) — venue selection (ICBINB / TMLR rationale)
7. [`agents/README.md`](agents/README.md) — multi-session worker model + IPC contracts
8. [`projects/example/card.md`](projects/example/card.md) — example card

## License

MIT. See [`LICENSE`](LICENSE).

본 파이프라인은 Sakana AI의 **"The AI Scientist"** 아이디어에서 출발했다. 논문의 fully-autonomous 접근 대신 HITL 게이트 체인으로 재설계했고, 코드는 자체 구현. 레포 전체 MIT.
