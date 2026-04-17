# Explore Kanban Schema — v0.1

> **Status:** v0.1 (2026-04-17). 자유탐색(Explore) 영역의 **단일 계약**. Research Kanban (`projects/<slug>/card.md`)과 **완전 분리**된 별도 객체군이다.
>
> **Scope:** 이 파일은 `explore/<slug>/direction.md` + `explore/<slug>/findings/*.md` 계약만 다룬다. Research Kanban 스키마는 [`card-schema.md`](card-schema.md), 상태 전이는 [`state-machine.md`](state-machine.md).

## 1. 역할 및 원칙

**Explore** 은 **연구 방향이 아직 정해지지 않은 상태의 자동 리서치** 를 담는다. 사용자는 "이런 방향의 자료를 모아줬으면 좋겠다" 는 **direction** 을 카드로 만들고, orchestrator가 해당 direction에 대해 주기적으로 **findings (논문 요약·venue 노트·아이디어 등)** 를 쌓는다. 사용자가 읽고, 맘에 드는 finding/direction을 Research Kanban으로 **승격** 하면 정식 연구 프로젝트가 된다.

설계 원칙:
- **Research Kanban과 파일·state 완전 분리.** `explore/` 는 `projects/` 와 형제. 카드 id space도 분리.
- **Parent (direction) + child (findings) 2-level.** direction 하나에 findings 여러 개 누적.
- **File is the database.** direction.md + finding md 파일 외 별도 저장소 없음.
- **Append-only trace.** Activity Log, findings 디렉터리 모두 append-only. drop/archive는 플래그 토글로 처리 — 파일 삭제 금지.
- **Promotion = 의식 (ritual).** Explore → Research 전이는 사용자가 slug를 확정해야만 발생. 자동 승격 없음.

## 2. 파일 구조

```
<repo-root>/explore/<direction-slug>/
├── direction.md                 # 부모 카드
└── findings/
    ├── f001-<short>.md          # 자식 finding (생성 순서 = 번호)
    ├── f002-<short>.md
    └── ...
```

- `<direction-slug>`: lowercase alphanumerics + `-`/`_`, 1~64자, 첫글자 alphanumeric. Research slug space 와 **독립** (같은 slug 를 양쪽에 둘 수 있음, 권장되진 않음).
- `f<NNN>-<short>`: `NNN` 3자리 제로패딩 정수 (001~999). `<short>`: 1~24자 alphanumerics+`-`. 한 direction 내에서 고유.

## 3. `direction.md` 포맷

YAML frontmatter + Markdown 본문.

### 3.1 Frontmatter

| 필드 | 타입 | 필수 | 설명 |
|---|---|:-:|---|
| `id` | string | ✅ | 디렉터리명과 동일 |
| `title` | string | ✅ | 한 줄 제목 |
| `kind` | enum | ✅ | §3.3 참조 |
| `cadence` | enum | ✅ | `oneshot` \| `daily` \| `weekly` \| `on_demand` |
| `status` | enum | ✅ | `running` \| `paused` \| `done` \| `error` |
| `assignee` | enum | ✅ | `ai` \| `user` \| `null` |
| `created` | ISO 8601 | ✅ | `YYYY-MM-DDTHH:MM:SS+09:00` |
| `updated` | ISO 8601 | ✅ | 쓸 때마다 갱신 |
| `next_run` | ISO 8601 \| null | ⬜ | recurring cadence 에서 다음 실행 예정 시각. `on_demand` / `done` / `paused` 시 null |
| `last_run` | ISO 8601 \| null | ⬜ | 마지막 cycle 실행 시각 |
| `finding_count` | int | ⬜ | denormalized 집계 (orchestrator 유지). 0 이상. UI용 hint — 진실은 `findings/` 디렉터리. |
| `tags` | list[string] | ⬜ | 검색·필터 |

### 3.2 Body 섹션 (순서 고정)

| 순서 | 헤더 | 필수 | 내용 |
|:-:|---|:-:|---|
| 1 | `## Seed` | ✅ | 사용자가 작성하는 direction 의 목적·맥락·제약. `refocus:` verb마다 새 단락 append (append-only). |
| 2 | `## Agenda` | ⬜ | orchestrator가 maintain 하는 "앞으로 할 것" 리스트. 교체 가능 (append-only 아님 — 여긴 plan 같은 living view). |
| 3 | `## Command Queue` | ✅ | 사용자→orchestrator 명령 append-only 큐. 포맷은 `card-schema.md §6` 와 동일. verbs는 §5 참조. |
| 4 | `## Activity Log` | ✅ | 발생한 모든 이벤트 append-only. 포맷은 `card-schema.md §7` 와 동일. event types는 §6 참조. |

### 3.3 `kind` 값 및 의미

| kind | 의미 | 주로 생성되는 finding kind | 적합한 cadence |
|---|---|---|---|
| `venues` | 내 방향과 맞는 학회·저널 찾기 | `venue` | `oneshot` / `on_demand` |
| `venue_archive` | 특정 venue 과거~현재 논문 catalog | `paper` | `oneshot` |
| `tracking` | 새 논문·공지 지속 트래킹 | `paper`, `tracking` | `daily` / `weekly` |
| `topic` | 특정 주제 자유 수집 (논문 + 아이디어 혼합) | `paper`, `idea`, `synthesis` | `on_demand` / `weekly` |
| `freeform` | 템플릿 없음 — worker가 seed만 보고 판단 | 모두 | 모두 |

kind는 orchestrator 프롬프트와 worker task type 분기에 쓰인다 ([`agents/research-worker/identity.md`]).

## 4. `findings/f<NNN>-<short>.md` 포맷

### 4.1 Frontmatter

| 필드 | 타입 | 필수 | 설명 |
|---|---|:-:|---|
| `id` | string | ✅ | 파일명 stem (예: `f003-lora-truth-drift`) |
| `parent` | string | ✅ | direction slug |
| `kind` | enum | ✅ | `paper` \| `venue` \| `idea` \| `tracking` \| `synthesis` |
| `title` | string | ✅ | 한 줄 제목 |
| `created` | ISO 8601 | ✅ | |
| `source` | string \| null | ⬜ | URL / arxiv id / venue 공식 페이지 등 |
| `interest` | enum | ✅ | `none` \| `liked` \| `archived` \| `promoted` |
| `promoted_to` | string \| null | ⬜ | `interest=promoted` 일 때 Research card slug (`projects/<slug>`) |
| `tags` | list[string] | ⬜ | |

### 4.2 Body

자유 markdown. worker 가 kind에 따라 적절한 구조로 작성. 강제 템플릿 없음 — 단, orchestrator identity 에서 kind별 권장 구조 기술.

- `paper`: bibkey, abstract 요약 2~3줄, method 요약, 내 direction 과의 관계
- `venue`: 공식 이름·주기·scope·CFP 링크·적합성 점수 근거
- `idea`: 1~2 문단 아이디어 + 관련 논문 3~5편 + 예상 실험 shape
- `tracking`: "무엇이 새로 나왔고 direction 에 어떻게 영향 주는가" 한 문단 + source
- `synthesis`: 지금까지 쌓인 finding들에서 emergent pattern 한 문단 (예: "최근 3주간 수집된 paper 12편 중 8편이 truthfulness 측면 — 이 쪽이 hot")

## 5. Command verbs (`direction.md` Command Queue)

| verb | 효과 |
|---|---|
| `refocus: <hint>` | `## Seed` 에 `### Refocus <timestamp>` 단락 append. 다음 cycle 부터 반영 (Activity Log `direction_refocused`). |
| `run_now` | cadence 무시하고 즉시 cycle 1회 실행. `next_run` 을 현재 시각으로 설정. |
| `pause` | `status=paused`, `next_run=null`. 재개 전까진 cycle 돌지 않음. |
| `resume` | `status=running`, cadence 기반으로 `next_run` 재계산. |
| `archive` | `status=done` (terminal). findings 는 그대로 보존. Research의 `abort` 와 동일 성격. |
| `drop: <finding-id>` | 해당 finding frontmatter `interest=archived` 토글. 파일 삭제 금지. Activity Log `finding_dropped`. |
| `promote: <finding-id> as <card-slug>` | finding 을 **Research Kanban `idea.draft` 카드로 승격**. 상세는 §7. Activity Log `finding_promoted`. |
| `note: <text>` | Activity Log 기록만 (`user_note`). |

> **slug 확정은 user 책임.** `promote` verb 는 `as <slug>` 필수 — orchestrator 가 slug을 자동 생성하지 않는다. slug 충돌 시 verb 처리 거부, Activity Log에 error 기록.

## 6. Event types (`Activity Log`)

| type | 기록자 | 용도 |
|---|---|---|
| `direction_created` | ai | 생성 시점. seed·kind·cadence 요약 |
| `cycle_started` | ai | 한 cycle 실행 시작 (cadence 도달 또는 `run_now`) |
| `finding_added` | ai | cycle 종료 후 finding 저장 완료 |
| `finding_dropped` | ai | user `drop` 처리 |
| `finding_promoted` | ai | user `promote` 처리 → Research 카드 생성 완료 |
| `direction_refocused` | ai | user `refocus` 반영 |
| `direction_paused` | ai | user `pause` |
| `direction_resumed` | ai | user `resume` |
| `direction_archived` | ai | user `archive` |
| `cycle_skipped` | ai | cadence 아직 안 왔음 (info 레벨) |
| `error` | ai | cycle 중 오류 |
| `command_processed` | ai | Command Queue 항목 처리 완료 |
| `user_note` | user | 사용자 자유 메모 |

## 7. Promotion: finding → Research `idea.draft`

`promote: <finding-id> as <slug>` 처리 단계:

1. **Slug 검증.** `projects/<slug>/card.md` 가 이미 존재하면 거부, Command Queue 에 error 기록.
2. **Research 카드 생성.** `projects/<slug>/card.md` 를 다음 frontmatter로 작성:
   - `stage=idea, substage=draft, status=running, assignee=ai`
   - `title` = finding.title
   - `tags` = finding.tags + `["from-explore"]`
   - `parent_id` = null (직접 link 대신 Event Log로 연결)
3. **Body 채우기.**
   - `## Summary`: finding body 요약 3~5 문장. "이 direction(explore/<parent>/)에서 승격된 아이디어" 한 줄 명시.
   - `## Plan`: `(TBD — idea review 후 run.survey 에서 구체화)`
   - `## Event Log`: 첫 줄 `[ideation] promoted from explore/<parent>/findings/<finding-id>`
4. **Finding 갱신.** frontmatter `interest=promoted`, `promoted_to=<slug>`. body 에 `> PROMOTED to projects/<slug> at <ts>` 추가 (append-only 유지).
5. **Activity Log append** (direction.md): `finding_promoted` 이벤트.
6. **이후 흐름.** Research Kanban 의 일반 `idea.draft → review` 게이트 진입. 기존 state machine 대로.

## 8. Cadence 엔진

`orchestrator` `/loop` 가 주기적으로 모든 `explore/*/direction.md` 를 스캔:

1. `status != running` → skip.
2. `next_run` 이 null 또는 미래 → skip, Activity Log `cycle_skipped` (info) 는 선택적 (verbose).
3. `next_run <= now` → cycle 실행:
   - Activity Log `cycle_started` append.
   - research-worker 에 `direction_cycle` task dispatch (input: direction frontmatter + seed + 기존 finding titles + kind + angle hint).
   - outbox 결과 받아 curate (중복·seed fit). pass 시 `findings/f<NNN>-<short>.md` 저장 + Activity Log `finding_added`.
4. **cadence 에 따라 next_run 갱신:**
   - `oneshot`: `status=done`, `next_run=null`.
   - `daily`: `next_run = last_run + 24h`.
   - `weekly`: `next_run = last_run + 7d`.
   - `on_demand`: `next_run=null` (다음 `run_now` 대기).

별도 cron 없음. orchestrator 가 단일 스케줄러. 세부 로직은 `agents/orchestrator/identity.md` 의 "Explore direction scheduler" 섹션 (별도 파일 작업).

## 9. 파서 동작

`direction.md` 파싱은 `card.md` 파서와 같은 원리 (`src/shared/card.py`와 shared 가능 — 필드 이름만 다름). Command Queue, Activity Log 라인 포맷은 Research 의 Command Queue, Event Log 와 **동일**. 따라서 파서 재사용 가능, 다만 frontmatter dataclass는 별도.

**쓰기 규칙** (Research 와 동일):
- `updated` 자동 갱신
- Activity Log / Command Queue 는 항상 append
- Seed 는 append-only (refocus 는 새 단락)
- 기존 항목 수정 금지 (체크박스 토글 및 `interest` 플래그 변경만 허용)

## 10. v0.1 미정

- findings 개수 폭증 시 index 전략 (현재: `findings/` 디렉터리 직접 스캔; 1000+ 되면 index 파일 고려)
- direction 간 cross-reference (한 finding이 여러 direction에 걸칠 때)
- Cadence 가 서로 다른 direction 간 starvation 방지 (동일 tick 에 여러 cycle 실행 시 순서)
- Finding 본문에 첨부(PDF·이미지) 처리 규칙
- Explore 영역의 샘플 카드 (`explore/example/`) 추가
