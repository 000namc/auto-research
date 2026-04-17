# Research Direction (예시 템플릿)

> **Purpose.** `auto-research` 파이프라인의 **탐색 바이어스**를 담는 단일 파일.
> AI가 ideation을 수행할 때 이 문서를 근거로 후보를 제안하고 novelty check를
> 수행한다.
>
> **사용법.** 이 파일을 그대로 두지 말고 `docs/private/research-direction.md`로
> 복사한 뒤 자기 상황에 맞게 수정한다. private 디렉터리는 `.gitignore`에
> 등록되어 있어 공개되지 않는다. 파이프라인 코드는 `docs/private/`을 먼저
> 보고, 없으면 이 example 파일을 fallback으로 읽는다.
>
> **AI 규약.** 이 문서를 **read-only로 취급**. 수정은 사용자(수동 편집 또는
> 웹앱 PUT)만. 변경 시 SSE `direction_changed` 이벤트가 모든 워커에 전파됨.

---

## Target venues

(Primary 결정. 상세는 [`venue-selection-guide.md`](venue-selection-guide.md))

자기 상황에 맞는 venue를 우선순위 순서대로 적는다. 예시:

- **Primary — <Workshop name>** (마감 ~MM, scope: ...)
- **Backup — <Journal>** (rolling 또는 마감 ...)
- **Stretch — <Top conference>** (마감 ...)

`card.md` `target_venue` 필드 규약: 자기가 정한 venue 식별자를 일관되게.
예: `NeurIPS-workshop/ICBINB`, `TMLR`, `ICLR-workshop/ICBINB`.

## Research themes

현재 관심 주제 (우선순위 순서대로). 예시:

1. **<Theme A>** — 한 줄 설명.
2. **<Theme B>** — ...
3. **<Theme C>** — ...

자기 도메인에 맞게 자유롭게. AI는 이 리스트를 ideation 근거로 삼는다.

## Style preferences

자기가 선호하는 연구 스타일. 예시 (그대로 써도 무방):

- **Empirical > theoretical.** 실증 실험 중심. 순수 이론 논문은 피함.
- **Negative/inconclusive results OK.** ICBINB 계열 venue와 일치.
- **Narrow·deep > broad survey.** 하나의 가설·현상을 체계적으로 파되 여러 모델·조건으로 변주.
- **Pre-committed success criteria 필수** (`plan_review` 4-item checklist).
- **Compute 예산 의식.** 사용 가능한 GPU·예산을 명시.
- **후보 동시 제시 규약.** AI는 narrow/broad 사전 commitment 없이 **3~5개 concrete 후보를 동시 제시** 후 사용자가 pick.

## Constraints & exclusions

피하고 싶은 주제·방법·데이터셋. 예시:

- **AI Scientist 라이선스 §3.2 금지 영역** — 의료 진단·범죄 예측·deepfake·surveillance.
- **비싼 pretraining run** — 7B+ 모델 from-scratch 학습. fine-tune/probing은 OK.
- **leakage 가능성 큰 benchmark** — 최신 웹 크롤 기반 QA. 선택 시 leakage check 필수.
- **저자 동의 없는 사적 데이터**.
- **재현 불가능한 설정** — closed model만 쓰는 실험은 가능하면 로컬 모델 동반.

## Open hooks

사용자가 잡고 있는 반쯤 뜬 아이디어 조각 (ideation seed로 활용):

- *(여기에 hook을 자유롭게 append. AI가 ideation 시 이 섹션 참조)*
- (예시) "LLM-as-Judge 와 human rater 의 mismatch 패턴이 task-type 별로 갈리는가?"
- (예시) "Small model + verifier loop 가 medium model single-shot 을 이기는 domain은 어디까지?"

---

## 수정 가이드

- 이 파일은 **단일 소스**. 중복 정보는 `venue-selection-guide.md`·`CLAUDE.md`로 포인터만.
- 웹앱 drawer에서 편집 시 자동 저장. 편집 중 다른 사람이 동시 수정하면 last-write-wins (v0.1 제약).
- AI가 이 파일을 수정하려 하면 reject (read-only contract). 변경 제안이 있으면 `projects/<slug>/card.md` Blockers에 기록.
