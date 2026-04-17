# auto-research

Sakana AI의 **"The AI Scientist"** ([*Towards end-to-end automation of AI research*, Nature 2026](https://www.nature.com/articles/s41586-026-10265-5)) 아이디어에서 출발한
**human-in-the-loop 자동 연구 파이프라인**. 논문의 fully-autonomous 접근과 달리
승인 게이트를 두어 사용자가 주요 전이 지점마다 검수·승인한다.

> 이 파일은 **공용 컨벤션**만 담는다. 사용자별 진행 상황·세션 로그·연구 방향
> seed·서버 환경·제출 전략 등은 [`docs/private/CLAUDE.md`](docs/private/CLAUDE.md)에
> 작성한다 (해당 파일 + `docs/private/` 디렉터리는 `.gitignore`에 등록되어
> 있어 공개 저장소에 들어가지 않음).
>
> **새 세션 우선순위:** (1) 이 파일 → (2) `docs/private/CLAUDE.md` (있으면).

## 프로젝트 구조

```
<repo-root>/
├── CLAUDE.md                       # 이 파일 — 공용 컨벤션
├── README.md                       # 셋업 가이드
├── docs/
│   ├── card-schema.md              # Research card.md 계약 스펙
│   ├── state-machine.md            # Research 루프 상태 전이, 3 gate
│   ├── explore-schema.md           # Explore (direction + finding) 계약
│   ├── methodology-review.md       # F1~F7 failure mode + safety 결정
│   ├── venue-selection-guide.md    # venue 선정 일반 가이드
│   ├── webapp-access.md            # 로컬·원격 웹앱 접근 가이드
│   ├── research-direction.example.md  # 사용자가 본인 버전을 private/로 복사하는 템플릿
│   └── private/                    # 🚫 .gitignore (개인 컨텍스트)
│       └── CLAUDE.md, progress.md, research-direction.md, ...
├── build/                          # Docker / compose
│   ├── docker-compose.yml          # 3 service: api, web, agents
│   ├── Dockerfile.api · Dockerfile.web · Dockerfile.agents
│   └── .dockerignore
├── bin/                            # tmux 세션 lifecycle 스크립트
│   ├── agents-{up,down,status}.sh, agents-entrypoint.sh
│   ├── spawn-agent.sh              # 개별 role spawn (--append-system-prompt)
│   └── agent-{attach,pane}.sh
├── src/
│   ├── api/                        # FastAPI: cards, directions, agents tmux 제어, SSE
│   ├── shared/                     # card.py + direction.py 파서 + pytest
│   └── web/                        # React + Vite + Tailwind (🔬 Research / 🧭 Explore 2-view)
├── agents/                         # 멀티세션 file-as-bus
│   ├── README.md                   # 운영 규약 + file-write 경계 하드룰
│   └── {orchestrator,research-worker,execution-worker,writing-worker}/
│       └── identity.md, inbox/, outbox/, status, log
├── templates/                      # 실험 scaffold
├── projects/                       # 🔬 Research 카드 (사용자가 슬러그 지정)
│   ├── README.md
│   └── example/                    # 공용 샘플 카드
│       # (사용자 자기 카드는 .gitignore — projects/*만 무시, !example, !README.md)
└── explore/                        # 🧭 Explore directions + findings
    # 전체 디렉터리 .gitignore. 개인 자유탐색 맥락 · findings 수집물
    └── <direction-slug>/{direction.md, findings/f<NNN>-*.md}
```

## 핵심 결정사항

### Architecture

- **멀티-세션 (tmux).** 4개의 Claude Code 세션이 호스트 tmux로 동시 실행된다. 1개가 **orchestrator**, 3개가 **worker** (research / execution / writing). 세션 간 통신은 **file-as-bus** (`agents/<role>/inbox/`, `outbox/`) + **tmux send-keys** (orchestrator가 worker를 직접 깨움). proj별 Claude 세션 없음.
- **Orchestrator만 polling.** orchestrator만 `/loop`으로 자기 자신에게 주기적 ping을 보낸다 (또는 사용자가 명시적으로 깨움). worker는 idle 상태로 대기하다가 orchestrator가 send-keys로 메시지를 던지면 깨어난다. polling cost를 worker × N 만큼 곱해서 늘리지 않는다.
- **Worker stateless 원칙.** 각 task는 자기완결적 — worker는 이전 task의 메모리에 의존 금지. orchestrator가 task 메시지에 모든 컨텍스트 포함. context 압박 시 orchestrator가 worker restart (N task마다 또는 pane line count 임계값).
- **File is the database.** `projects/<slug>/card.md`가 단일 소스 (YAML frontmatter + Markdown body). DB 없음. 웹앱·AI·사람 모두 같은 파일 read/write. 모든 실험은 `projects/` 하위로 집약.
- **Gate-based approval flow (v0.2).** Top-level stage 4개 (`idea`/`run`/`write`/`done`) + stage 내부 substage. Gate는 3개: `idea.review`, `run.plan_review`, `write.review`. **`run.plan_review`가 가장 큰 compute 절감 지점** — `run.setup` 이후 (scaffold + baseline 확인 후) iterate 진입 전에 차단. 4-item checklist (benchmark fit, leakage check, metric fit, pre-committed success criteria) 강제 — [docs/methodology-review.md](docs/methodology-review.md) F2. 자세한 전이: [`docs/state-machine.md`](docs/state-machine.md).
- **Append-only safety contract.** `Command Queue`, `Event Log`의 append-only는 단순 편의가 아니라 **안전장치**다. [Hidden Pitfalls of AI Scientist Systems](https://arxiv.org/abs/2509.08713)의 권장사항인 "trace logs > final paper"를 만족시킨다. 어떤 sub-agent도 기존 항목 수정 금지.
- **Sub-agent file-write 경계 (하드 룰).** sub-agent는 **오직 `projects/<slug>/` 하위만** 쓰기 가능. 절대 금지 경로: `src/`, `build/`, `templates/`, `docs/`, `agents/<other-role>/`, `bin/`, `CLAUDE.md`, `README.md`. 위 경로 변경이 필요하면 `card.md` Blockers에 항목 추가하고 `status=blocked`로 전환. **자기수정 시스템이 되지 않기 위함** — DGM의 reward hacking 사례 회피.
- **Result-validator 단계.** `run.iterate` 내부 stage_4_ablation 종료 후 → `run.wrap` 진입 전, validator가 `projects/<slug>/runs/` raw 출력에서 메트릭을 재계산하여 보고치와 diff. 불일치 시 `status=blocked` (substage 유지). MLR-Bench의 80% fabrication rate에 대한 deterministic 방어선.

### Tech stack

- **Backend:** Python + FastAPI (컨테이너 `auto-research-api`)
- **Frontend:** React + Vite + Tailwind CSS (컨테이너 `auto-research-web`)
- **Realtime:** SSE (FastAPI 네이티브)
- **Storage:** Filesystem (`card.md` + `agents/<role>/{inbox,outbox,status,log}`). DB 없음.
- **LLM:** **Claude Code 멀티-세션 (컨테이너 `auto-research-agents` 안 tmux)**. Anthropic API/SDK 직접 호출 없음. Aider 없음. 모든 sub-agent 작업은 agents 컨테이너 안 tmux 세션에서 수행 — `claude --append-system-prompt "$(cat agents/<role>/identity.md)"`로 role 주입. claude 바이너리·인증(`~/.claude/`, `~/.claude.json`)은 호스트에서 bind mount.
- **Process management:** tmux 3.4 (agents 컨테이너 내부). api 컨테이너에 tmux **client**가 있어 shared `tmux-socket` 볼륨으로 agents의 tmux server 조작.
- **컨테이너 path 통일:** 모든 컨테이너가 프로젝트를 `/app/data/auto-research`로 mount. **identity.md, 코드는 모두 cwd 기준 상대경로 사용** — host와 container 모두에서 같은 파일이 동일하게 동작.
- **호스트에 떠있는 것 = 디자이너 Claude Code 세션 + Docker daemon만**. 그 외 모든 프로젝트 활동은 컨테이너 내부.

### 외부 코드 재사용 없음

"The AI Scientist" 의 설계 아이디어 (agentic exploration · 단계별 experiment lifecycle · reviewer agent · novelty check) 를 참고하되, 외부 소스에서 코드·템플릿·프롬프트를 복사하지 않는다. 전부 자체 구현:

- **자체 구현:** HITL gate 체인 state machine ([`state-machine.md`](docs/state-machine.md)) · card.md journal · experiment runner · agent manager · Explore direction/findings 모델
- **Venue 템플릿:** 논문 단계에서 필요 시 사용자가 해당 학회·저널 공식 LaTeX 템플릿을 `templates/<venue>/` 에 직접 배치.
- 별도 라이선스 상속 이슈 없음. 레포 전체 MIT.

**동기:** fully-autonomous 설계는 창의적이지만 F1~F7 failure mode 들을 전부 상속받는다 ([`docs/methodology-review.md`](docs/methodology-review.md)). 핵심 차이는 **게이트 (idea.review / run.plan_review / write.review) 로 주요 전이마다 사용자 검수를 강제** — 논문 설계보다 보수적이지만 실제 배포 가능한 결과물 추구.

### Target venues

이 파이프라인의 산출물은 **HITL 게이트가 있는 자동 연구 시스템의 출력**이다. 일반적으로:

- **Primary:** negative-results-friendly workshop (예: NeurIPS/ICLR ICBINB)
- **Backup:** TMLR (rolling, no page cap, correctness-focused)
- **Stretch:** top conf main track (가능하면)

상세 추론은 [`docs/venue-selection-guide.md`](docs/venue-selection-guide.md). 자기 상황의 구체 결정·일정·`target_venue` 필드 규약은 `docs/private/`에 작성.

### Webapp 접근

**외부 노출 0** 원칙. 컨테이너는 항상 loopback (`127.0.0.1`)에만 bind. 접근 모드:

- **로컬 dev (default):** `docker compose up -d --build` → 같은 머신 브라우저 `http://localhost:5173`.
- **원격 서버 (옵션):** SSH `LocalForward 5173 localhost:5173 / LocalForward 8000 localhost:8000` 으로 터널링. 방화벽 변경 0.

상세는 [`docs/webapp-access.md`](docs/webapp-access.md).

## Collaboration conventions

- **언어:** 한국어. 기술 용어(API, Kanban, frontmatter, tree search 등)는 영어 원어 OK.
- **실험 주제 제안 방식:** narrow/broad 사전 commitment 요구 금지. **3~5개 concrete 후보를 스펙트럼 전체에 걸쳐 동시 제시** → 사용자가 observe 후 선택.
- **컨테이너 우선:** 모든 작업은 **컨테이너 내부**에서. 호스트에 직접 pip/apt 설치 금지. 호스트에는 docker daemon + 디자이너 Claude Code 세션 외에는 띄우지 않음.
- **Read-first.** 변경 전 항상 현재 상태 확인. 쓰기는 프로젝트 디렉터리 안에서만.
- **GPU 배분:** `--gpus '"device=N"'`으로 명시. 사용 전 `nvidia-smi`로 충돌 확인.
- **Network·systemd·docker daemon·user·firewall** 관련 변경은 사용자 승인 필수.

## Key files to read first

1. 이 파일 (공용 컨벤션)
2. `docs/private/CLAUDE.md` (있으면; 개인 컨텍스트)
3. [`docs/card-schema.md`](docs/card-schema.md) — Research card.md contract (orchestrator/webapp/sub-agents 공유)
4. [`docs/state-machine.md`](docs/state-machine.md) — Research 루프 전이, 3 gate, sub-agent dispatch
5. [`docs/explore-schema.md`](docs/explore-schema.md) — Explore (direction + finding) contract
6. [`docs/methodology-review.md`](docs/methodology-review.md) — failure mode survey + safety 결정
7. [`docs/venue-selection-guide.md`](docs/venue-selection-guide.md) — venue 선정 일반 가이드
8. [`agents/README.md`](agents/README.md) — multi-session worker model + IPC contracts
9. [`projects/example/card.md`](projects/example/card.md) — 카드 샘플
