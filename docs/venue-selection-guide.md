# Venue Selection Guide

> **Purpose.** `auto-research`로 만든 논문/보고서를 **어디에 제출할지** 결정할
> 때 참고하는 일반 가이드. 자기 상황의 구체 결정은
> `docs/private/venue-decision.md` 같은 개인 문서로 분리할 것.

## TL;DR

이 파이프라인은 **HITL 게이트가 있는 자동 연구 시스템**이다.
[methodology-review.md](methodology-review.md) F1에서 정리한 대로 fully-autonomous
agent의 80% fabrication rate를 가정하고 설계됐다. 이 특성이 venue 선택에 직접
영향을 준다.

| Track | 추천 venue 유형 | Format | 왜 |
|---|---|---|---|
| **Primary (1차 제출)** | Negative-results-friendly workshop (예: NeurIPS/ICLR ICBINB) | short (~4–8 pp) | 워크샵 bar가 "흥미로운 실패"라 자동 파이프라인 산출물에 적합 |
| **Backup** | TMLR | flexible, no hard cap | rolling submission, correctness 중심 |
| **Stretch** | Top conf main track | long, 마감 빠듯 | 가능하면 도전, 일정 안 맞으면 즉시 backup으로 |

같은 paper가 primary → backup으로 옮겨갈 수 있다. TMLR는 워크샵 게재 후 확장
재출판도 허용.

## 왜 ICBINB-계열 workshop을 primary로 (모범 사례)

1. **Sakana 선례 (2025).** SakanaAI가 ICLR 2025 ICBINB에 AI-generated 논문 3편
   제출, 모두 peer review 통과. UBC IRB 승인 + 워크샵 organizers와 투명하게
   협의. 자동 시스템 산출물도 disclosed하면 게재 가능함을 입증.
2. **Scope match.** ICBINB는 **negative results, surprising failures**를 명시적
   환영 — smoke-test 파이프라인이 클리어할 수 있는 bar.
3. **Disclosure 수용 전례.** ICBINB organizers는 disclosed AI-generated 논문을
   실제로 수용해 본 경험이 있음. auto-research 산출물도 acknowledgments 섹션에
   파이프라인 disclosure 를 포함하면 원칙적으로 호환.

## 왜 TMLR backup (단순 fallback이 아닌)

1. **Always open.** Rolling submission, 마감 anxiety 없음.
2. **No page limit.** Full ablation + reproducibility appendix를 다 실을 수 있음.
3. **Correctness over novelty.** 리뷰가 "claim이 supported됐나"에 집중 — 실증
   dry-run에 잘 맞음.
4. **Workshop publication과 호환.** TMLR는 워크샵 paper 확장/재출판 허용.
5. **Fast.** Median 76일 to decision; assignment 후 2주 내 review.

## 일반적으로 피하는 venue (1차 제출 기준)

| Venue 유형 | 왜 (이 파이프라인 한정) |
|---|---|
| **Top conf main track (NeurIPS/ICML/ICLR)** | bar가 너무 높음. 자동 파이프라인의 첫 산출물이 통과하기 어렵고, 마감 압박 + 큰 논문 길이 요구 |
| **Specialty venue (ACL/EMNLP 등)** | 자기 도메인이 정확히 맞지 않으면 engine LaTeX 템플릿 advantage 못 봄 |
| **Closed-review venue** | trace logs 공개 어려움 (methodology-review.md F3) |

## Re-evaluation triggers

자기 venue 결정은 다음 시그널이 오면 재검토:

- 목표 워크샵 CFP가 늦어지거나 폐지됨
- proj 일정이 크게 슬립 (>3주)
- 새 venue가 관련 마감을 발표
- 라이선스/disclosure 정책 변화

## 자기 결정 기록 위치

자기 상황 구체 결정 (어느 워크샵, 어느 마감, 어느 proj 어느 트랙)은 이 문서가
아니라 `docs/private/venue-decision.md`에. 이 가이드는 추론·정책만 담는다.
