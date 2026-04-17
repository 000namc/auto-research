# Webapp 접근 가이드

`auto-research`의 Kanban 웹앱과 FastAPI 오케스트레이터는 모두 **컨테이너 내부에서 loopback (127.0.0.1)에만 bind** 한다. 기본 가정은 **로컬 머신에서 `docker compose up`**, 원격 서버는 부록.

## 접속 매트릭스

| 시나리오 | 사용자 위치 | 접속 URL | 추가 설정 |
|---|---|---|---|
| **로컬 dev** | 컨테이너가 떠있는 머신 그대로 | `http://localhost:5173` | 없음 |
| **로컬 prod 번들** | 컨테이너가 떠있는 머신 그대로 | `http://localhost:8000` | 없음 (api가 정적 빌드 서빙 시) |
| **원격 서버 (옵션)** | 다른 머신에서 SSH 접속 | `http://localhost:5173` (자기 머신) | SSH `LocalForward` 2줄 |

## 기본 — 로컬 dev

```bash
# 1. .env 한 번만
cp .env.example .env

# 2. 스택 기동
docker compose -f build/docker-compose.yml up -d --build

# 3. 브라우저
open http://localhost:5173        # macOS
xdg-open http://localhost:5173    # Linux
```

웹앱 (Vite HMR)은 `127.0.0.1:5173`. API는 `127.0.0.1:8000`. 둘 다 호스트 loopback에만 bind되어 있어 LAN 다른 기기에서 접근 불가 — 의도된 동작이다.

## 부록 A — 원격 서버 (SSH LocalForward)

원격 GPU 서버 등에서 컨테이너를 띄우고 본인 노트북에서 접속하고 싶은 경우.

### 원리

서버 방화벽을 건드리지 않는다. 외부로 포트를 열지 않고, **이미 열려있는 SSH 포트** 위에 LocalForward를 얹어서 사용. 서버 방화벽 변경 0.

```
사용자 노트북                       원격 서버
┌─────────────────┐                ┌───────────────────────────┐
│  브라우저       │                │                           │
│  localhost:5173 │ ── SSH ──────► │  Vite (127.0.0.1:5173)    │
│  localhost:8000 │ ── tunnel ───► │  FastAPI (127.0.0.1:8000) │
└─────────────────┘                └───────────────────────────┘
```

### 셋업

원격 서버에서:

```bash
# 평소처럼 컨테이너 기동 (기본 동작 그대로)
docker compose -f build/docker-compose.yml up -d --build
```

본인 노트북의 `~/.ssh/config`에 호스트 엔트리 한 번만 추가:

```ssh-config
Host my-server
  Hostname <ip-or-domain>
  User <username>
  Port <ssh-port>           # 22가 아니면 명시
  LocalForward 8000 localhost:8000
  LocalForward 5173 localhost:5173
```

### 사용

```bash
# 1. SSH 연결 (LocalForward 자동 적용)
ssh my-server

# 2. 본인 노트북 브라우저
open http://localhost:5173
```

SSH 세션이 열려있는 동안 터널 활성. 끊기면 자동 종료.

### autossh로 영속 터널

가끔 끊기는 게 싫으면 `autossh`:

```bash
autossh -M 0 -f -N my-server
```

`-M 0` (모니터링 disable, ServerAlive로 충분), `-f` (백그라운드), `-N` (커맨드 없이 터널만).

## 부록 B — 외부 노출이 정말 필요하면

LAN 다른 기기 또는 인터넷에서 직접 접근이 필요한 경우 (권장 안 함):

1. `build/docker-compose.yml`에서 `network_mode: host` 제거 + `ports: ["0.0.0.0:5173:5173"]` 형태로 명시
2. **CORS·인증 추가** — 현재 webapp은 single-user 전제로 인증 없음
3. 방화벽·TLS·rate limiting 본인 책임

이 모드에서는 `card.md` write API가 인증 없이 노출되므로, 절대 개방 인터넷에 두지 말 것.

## 트러블슈팅

| 증상 | 원인·해결 |
|---|---|
| `connection refused localhost:5173` | `docker compose ps`로 `auto-research-web`이 `running`인지 확인. 없으면 `up -d`. |
| 원격에서 SSH 터널 잡히는데 페이지 안 뜸 | 원격 서버에서 `ss -tnlp \| grep -E ":(8000\|5173)"`로 컨테이너가 정말 loopback에 listen 중인지 확인. |
| `Address already in use` (호스트) | `8000` 또는 `5173`을 다른 프로세스가 점유. `lsof -i :5173`. |
| Vite HMR 동작 안 함 | 브라우저 콘솔에서 WebSocket 에러 확인. SSH 터널 사용 중이면 LocalForward로는 ws도 자동 터널링 됨 (정상). |
