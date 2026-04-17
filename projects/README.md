# `projects/`

각 실험은 `projects/<slug>/` 하위 디렉터리 한 개. 안에 정확히 하나의
[`card.md`](../docs/card-schema.md)가 있어야 한다.

```
projects/
├── README.md          # 이 파일 (공용)
├── example/           # 공용 샘플 카드
│   ├── card.md
│   └── docs/
└── <your-slug>/       # 본인 카드 (gitignore 됨)
    ├── card.md
    ├── CLAUDE.md      # (옵션) proj-specific context for AI sessions
    ├── docs/
    │   ├── plan.md
    │   └── results.md
    ├── src/           # (옵션) 실험 코드
    └── runs/          # (옵션) raw 실행 출력 — gitignored
```

## Slug 규약

- 디렉터리 이름 = 카드 ID = `card.md`의 `id` 필드.
- 정규식: `^[a-z0-9][a-z0-9_-]{0,63}$` (lowercase alphanumeric + `-`/`_`, 첫
  글자는 alphanumeric, 1~64자).
- 예: `alignment-drift`, `llm-judge`, `sentiment-baseline`.

## 새 카드 만드는 방법

**옵션 1 — 웹앱 ideation chat:**
1. 웹앱 Idea 컬럼의 `🗣 Ideate` 버튼
2. research-worker 와 자유 대화
3. `✦ Crystallize to card` 클릭 → slug 입력 → 카드 자동 생성

**옵션 2 — 수동:**
1. `mkdir projects/<slug>`
2. [`example/card.md`](example/card.md) 참고해 frontmatter + 필수 섹션 (Summary,
   Plan, Blockers, Command Queue, Event Log) 작성
3. `stage=idea, substage=draft` 으로 시작 (또는 `idea/review` 로 바로 사용자 게이트 진입)

## Gitignore 정책

이 저장소를 fork해서 자기 실험을 돌리면, `projects/*` 는 `.gitignore` 처리되어
있고 `example/` 와 `README.md` 만 추적된다 (`.gitignore`의 `!example/` /
`!README.md` 예외). 자기 카드를 git에 올리고 싶으면 그쪽 `.gitignore`를 풀거나
별도 데이터 저장소를 사용한다.
