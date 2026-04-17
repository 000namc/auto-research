# `agents/` — multi-session worker infrastructure

> 4개의 Claude Code 세션이 호스트 tmux로 동시 실행된다. 1개 orchestrator + 3개 worker.

## 디렉터리 구조

```
agents/
├── orchestrator/
│   ├── identity.md       # 세션 시작 시 --append-system-prompt로 주입
│   ├── inbox/            # (옵션) orchestrator로 향하는 트리거 파일
│   ├── outbox/           # (옵션) — orchestrator는 보통 card.md에 직접 write
│   ├── status            # heartbeat (last loop iteration timestamp)
│   └── log               # append-only 활동 로그
├── research-worker/      # ideation + librarian + planner
│   ├── identity.md
│   ├── inbox/            # task .json 파일들 (orchestrator가 작성)
│   ├── outbox/           # result .json 파일들 (worker가 작성)
│   ├── status
│   └── log
├── execution-worker/     # experiment-runner + analyst + validator
│   └── (동일 구조)
├── writing-worker/       # writer + reviewer
│   └── (동일 구조)
└── README.md             # 이 파일
```

## tmux 세션 이름

- `agent-orchestrator`
- `agent-research-worker`
- `agent-execution-worker`
- `agent-writing-worker`

`tmux ls`로 상태 확인. `tmux attach -t agent-<role>` 로 직접 보기.

## Task / Result 포맷

### `agents/<role>/inbox/<uuid>.json`
```json
{
  "task_id": "9f2b...",
  "from": "orchestrator",
  "for_proj": "proj1",
  "issued_at": "2026-04-10T15:00:00+09:00",
  "type": "plan_draft",
  "input": {
    "card_path": "projects/proj1/card.md",
    "context": "free-form text or structured payload",
    "constraints": ["budget: 25", "..."]
  }
}
```

### `agents/<role>/outbox/<uuid>.json`
```json
{
  "task_id": "9f2b...",
  "completed_at": "2026-04-10T15:30:00+09:00",
  "status": "ok",
  "output": {
    "events": [{"type": "plan", "description": "..."}],
    "next_stage": "plan_review",
    "blockers": [],
    "files_written": ["projects/proj1/docs/plan.md"]
  },
  "error": null
}
```

## 세션 관리

- **시작:** `bin/agents-up.sh` (orchestrator + 3 worker spawn)
- **정지:** `bin/agents-down.sh`
- **상태:** `bin/agents-status.sh`
- **연결:** `bin/agent-attach.sh <role>`
- **화면 캡처:** `bin/agent-pane.sh <role>`

웹앱에서도 동일한 작업 가능 (Step 2 이후): start/stop/restart, pane 미리보기, 메시지 전송.

## File-write 경계 (하드 룰)

worker는 다음 경로에만 쓰기 가능:
- `projects/<slug>/` (모든 proj)
- `agents/<자기 role>/outbox/`
- `agents/<자기 role>/log`
- `agents/<자기 role>/status`

다음 경로에는 **절대 쓰기 금지**:
- `src/`, `build/`, `templates/`, `docs/`, `bin/`
- `agents/<other-role>/`
- `agents/orchestrator/` (worker가 orchestrator를 건드리지 않음)
- `CLAUDE.md`, `README.md`

위 경로 변경이 필요하면 `projects/<slug>/card.md` Blockers에 추가하고 `status=blocked` 로 전환.

이 룰은 [DGM의 reward hacking 사례](../docs/methodology-review.md#f4) 회피용 — 자기수정 시스템이 되지 않기 위함.

## Context 관리

worker는 **stateless 원칙** 준수:
- 각 task는 자기완결적 — 모든 컨텍스트는 task 메시지에 포함
- 이전 task의 메모리에 의존 금지
- N=20 task 처리 후 또는 pane line count > 5000 시 orchestrator가 자동 restart
- task 처리 후 한 줄 요약만 출력하고 다음 메시지 대기 (`/clear` 호출은 안 함 — restart로 대체)
