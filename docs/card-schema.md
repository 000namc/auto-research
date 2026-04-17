# `card.md` Schema — v0.2

> **Status:** v0.2 (2026-04-17 restructure). 오케스트레이터·sub-agent·Kanban 웹앱이 공유하는 **단일 계약**.
>
> **v0.2 변경:** top-level stage를 `idea`/`run`/`write`/`done` 4개로 축소. 각 stage의 세부 단계는 `substage`로 표현. 자세한 매핑은 [`state-machine.md`](state-machine.md) 부록 A 참조.
>
> **Scope:** 이 파일은 **Research Kanban** (`projects/<slug>/card.md`)의 스키마. 자유탐색(Explore) 영역은 별도 객체 (`explore/<slug>/direction.md` + findings) — [`explore-schema.md`](explore-schema.md) 참조.

## 1. 역할

`card.md`는 한 실험(`projects/<slug>/`)의 **살아있는 상태**를 담는 단일 파일이다. AI 워커, 웹앱, 사람 편집이 모두 이 파일 하나로 수렴한다.

설계 원칙:
- **File is the database.** 이 파일만 읽으면 현재 상태가 완전히 재구성되어야 한다.
- **Append-only 기본.** `Command Queue`·`Event Log`는 삭제 없이 아래로 추가. 체크박스만 토글.
- **단일 소스.** 별도 DB 없음. 웹앱은 card.md를 직접 읽고 쓴다.
- **Git-friendly.** 한 줄 = 한 이벤트. diff가 잘 보이게.

## 2. 파일 위치

```
<repo-root>/projects/<slug>/card.md
```

- `<slug>`는 디렉터리 이름 = 카드 ID. 규약: lowercase alphanumerics + `-`/`_`, 첫글자는 alphanumeric, 1~64자.
- 신규 카드는 ideation crystallize 단계에서 사용자가 slug 지정 (예: `alignment-drift`, `llm-judge`).
- 각 proj 디렉터리에 정확히 1개의 `card.md`.

## 3. 파일 포맷

YAML frontmatter (`---` 경계) + Markdown 본문. 아래 순서를 지킨다.

### 3.1 Frontmatter 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|:-:|---|
| `id` | string | ✅ | 디렉터리명과 동일 |
| `title` | string | ✅ | 한 줄 제목 |
| `stage` | enum | ✅ | §4 참조 |
| `substage` | enum \| null | ✅ | §4 참조 (stage당 허용 substage 조합만 valid) |
| `status` | enum | ✅ | §5 참조 |
| `assignee` | enum | ✅ | `ai` \| `user` \| `null` |
| `created` | ISO 8601 | ✅ | `YYYY-MM-DDTHH:MM:SS+09:00` |
| `updated` | ISO 8601 | ✅ | 파일 쓸 때마다 갱신 |
| `tags` | list[string] | ⬜ | 검색·필터용 |
| `parent_id` | string \| null | ⬜ | 다른 proj에서 파생된 경우 |
| `target_venue` | string \| null | ⬜ | 목표 학회·저널 (예: `NeurIPS-workshop/ICBINB`, `TMLR`, `ICLR-workshop/ICBINB`) |

> **참고:** 비용 추적 필드(`compute_*_usd`)는 v0.1에서 제거됨. 모든 AI 작업은 Claude Code 멀티-세션 안에서 일어나며 per-call 과금이 없다. GPU/wall-clock 추적이 필요해지면 별도 필드로 다시 추가.

### 3.2 Body 섹션 (순서 고정)

| 순서 | 헤더 | 필수 | 내용 |
|:-:|---|:-:|---|
| 1 | `## Summary` | ✅ | AI가 유지하는 1~2 문단 현재 상태 |
| 2 | `## Plan` | ✅ | `docs/plan.md` 링크 (또는 인라인 요약) |
| 3 | `## Blockers` | ✅ | 사용자 결정이 필요한 항목 checkbox list |
| 4 | `## Command Queue` | ✅ | 사용자→AI 명령 append-only 큐 (§6) |
| 5 | `## Event Log` | ✅ | 발생한 모든 이벤트 append-only 로그 (§7) |
| 6 | `## Metrics` | ⬜ | 주요 수치 결과 (key: value) |
| 7 | `## Artifacts` | ⬜ | 생성된 파일 링크 (플롯·논문 등) |

필수 섹션은 헤더가 항상 존재, 내용은 비어 있어도 OK.

## 4. `stage` × `substage`

Top-level stage는 4개. 각 stage는 고정된 substage 집합을 갖는다.

### 4.1 `stage`

| stage | 의미 | terminal? |
|---|---|:-:|
| `idea` | 아이디어 등록·novelty check·승인 | |
| `run` | 연구 수행 전체 (survey→setup→iterate→wrap) | |
| `write` | 논문/보고서 작성 및 최종 승인 | |
| `done` | 완료·폐기·중단 | ✅ |

### 4.2 `substage` (stage별 valid 조합)

| stage | substage | gate? | 의미 |
|---|---|:-:|---|
| `idea` | `draft` | | ideation, novelty check 진행 중 |
| `idea` | `review` | 🛑 | 아이디어 승인 대기 |
| `run` | `survey` | | 관련 리서치 총조사 (lit review) |
| `run` | `setup` | | 데이터셋 확보, scaffold 코드, baseline |
| `run` | `plan_review` | 🛑 | 실험 설계·예산·성공기준 승인 대기 |
| `run` | `iterate` | | 가설 설정 및 실험 반복 (4-stage tree search 포함) |
| `run` | `wrap` | | 실험결과 정리, validator, 요약 |
| `write` | `draft` | | LaTeX 초안, figure |
| `write` | `review` | 🛑 | 최종 산출물 승인 대기 |
| `done` | `null` | | terminal |

### 4.3 `iterate`의 내부 detail (optional)

`run.iterate` 내부는 4-stage tree search (`prelim → hp → agenda → ablation`) 로 세분된다. 외부에는 `substage=iterate` 로만 표시; detail은 Event Log `[stageN]` 이벤트로 추적. 별도 필드로 승격은 v0.2 미정.

## 5. `status` 값

`stage`와 **독립적**으로, "지금 누구 차례냐"를 표현.

| status | 의미 |
|---|---|
| `running` | AI 워커가 작업 중 |
| `awaiting_user` | 사용자 액션 대기 (gate substage 진입 시) |
| `blocked` | AI가 막힘 — 어느 substage에서든 발생. Blockers 섹션 필수. 사용자 `resolve` 시 해제. stage/substage 는 유지 (v0.1의 `needs_attention` 대체) |
| `idle` | 아직 pick 안 됨 |
| `done` | 완료 |
| `error` | 복구 불가 오류 |

**전이 규칙:**
- gate substage 진입 → `status=awaiting_user`, `assignee=user`.
- AI 재개 → `status=running`, `assignee=ai`.
- AI 모호/오류 → `status=blocked`, `assignee=user`, Blockers에 질문. stage/substage 보존.

## 6. Command Queue 문법

사용자 액션(웹앱 버튼/에디터)은 append-only로 이 섹션에 쌓인다.

```
- [ ] <ISO timestamp> <author>: <verb>[: <args>]
```

- `[ ]` = 미처리, `[x]` = AI가 처리 완료
- 처리 시 체크박스만 토글, 항목 자체는 지우지 않음.

### 6.1 인식되는 verb

| verb | 적용 상태 | 효과 |
|---|---|---|
| `approve` | gate substage (`idea.review`, `run.plan_review`, `write.review`) | 다음 substage / stage 전이 |
| `reject` | `idea.review` | `done` (폐기) |
| `revise: <피드백>` | `run.plan_review`, `write.review` | 이전 substage 회귀 (setup, draft) |
| `resolve: <지시>` | `status=blocked` | `status=running` 재개 (substage 그대로) |
| `abort` | any | `done` 으로 중단 |
| `note: <메모>` | any | Event Log 기록만 |

verb가 없는 자유 텍스트는 `note:`로 해석.

### 6.2 예시

```
- [x] 2026-04-08 14:25 user: approve
- [x] 2026-04-09 10:00 user: note: scaffold 선택 검토 완료
- [ ] 2026-04-10 10:45 user: revise: Stage 3에서 CNN 대신 ViT 써봐
```

## 7. Event Log 형식

```
- <YYYY-MM-DD HH:MM> [<type>] <description>
```

- 타임스탬프는 분 단위. 초 정밀도 필요 시 `HH:MM:SS` 허용.
- `<type>`은 아래 표 값 중 하나.

### 7.1 Event 타입

| type | 기록자 | 용도 |
|---|---|---|
| `ideation` | ai | 아이디어 생성·novelty check |
| `approval` | ai | Gate 통과 (user approve 처리 후 기록) |
| `plan` | ai | Plan 작성·수정 |
| `stage1`~`stage4` | ai | 각 substage 진행·결과 |
| `metric` | ai | 수치 결과 기록 |
| `gate` | ai | Gate 진입 (awaiting_user 세팅 시점) |
| `error` | ai | 오류 발생 |
| `command_processed` | ai | Command Queue 항목 처리 완료 |
| `user_note` | user | 사용자 자유 메모 |

## 8. 파서 동작 (오케스트레이터용)

1. 파일 읽기 → YAML frontmatter 분리 → 본문 분리.
2. 본문을 `## ` 헤더 기준 섹션 분리.
3. `Command Queue`의 각 bullet 파싱: `[x|\s]`, timestamp, author, verb, args.
4. `Event Log`의 각 bullet 파싱: timestamp, type, description.
5. `Blockers`는 checkbox list로만 읽고, 쓰기는 stage 전이 로직에서.

**쓰기 규칙:**
- Frontmatter의 `updated` 자동 갱신.
- Event Log·Command Queue는 항상 append.
- 섹션 순서 변경 금지 (diff 최소화).
- 기존 항목을 수정하지 말 것. 체크박스 토글만 허용.

> **⚠️ Safety contract (load-bearing).** Event Log·Command Queue의 append-only는 단순 편의가 아니라 안전장치다. [Hidden Pitfalls of AI Scientist Systems (arXiv 2509.08713)](https://arxiv.org/abs/2509.08713)이 권장한 *"trace logs > final paper for failure detection"* 를 우리는 이 contract로 만족시킨다. **어떤 sub-agent도 기존 항목 수정 금지.** 토글 + append만.

## 9. Full 예시

샘플 카드: [`projects/example/card.md`](../projects/example/card.md).

## 10. v0.1 미정

- Command Queue 동시 편집 충돌 해결 (v0.1은 단일 사용자 전제)
- Parallelized tree search 시 한 proj 내 여러 substage 동시 진행 표현
- 바이너리 artifact (체크포인트) 참조 규칙
