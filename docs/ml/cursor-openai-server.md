# Cursor 에 로컬 변형문제 AI 붙이기

맥에서 도는 12유형 파이프라인을 OpenAI 호환 `/v1` 서버로 감싸, Cursor **Override OpenAI Base URL** + 커스텀 모델로 부른다.

코드: `ml/serve/openai_server.py` · 실행: `ml/serve/run.sh`

## 메모리

시작 시 7B + LoRA 어댑터 6개 + 35B reasoner 를 한 번 올린다(대략 **25GB**).  
기존 `com.gomijoshua.local-variant-worker` 도 같은 모델을 올리므로 **둘을 동시에 켜면 약 50GB**. 64GB 맥이어도 여유 메모리가 부족하면 한쪽을 끈다.

```bash
# 워커만 잠깐 끄기
launchctl bootout gui/$(id -u)/com.gomijoshua.local-variant-worker
# 다시 켜기
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gomijoshua.local-variant-worker.plist
# 또는
launchctl kickstart -k gui/$(id -u)/com.gomijoshua.local-variant-worker
```

## 서버 실행

```bash
export LOCAL_VARIANT_API_KEY=$(openssl rand -hex 24)
echo "$LOCAL_VARIANT_API_KEY"   # Cursor OpenAI API Key 에 넣을 값
./ml/serve/run.sh               # 127.0.0.1:8765
```

키가 없으면 서버는 시작하지 않는다. 터널로 인터넷에 열리므로 **키가 유일한 문**이다. 키·`MONGODB_URI` 는 로그에 찍지 않는다.

## curl

```bash
# 키 없이 → 401
curl -sS http://127.0.0.1:8765/v1/models

# 12모델
curl -sS http://127.0.0.1:8765/v1/models \
  -H "Authorization: Bearer $LOCAL_VARIANT_API_KEY" | python3 -m json.tool

# 주제 1문항 (stream=false) — 영어 지문만 messages.user 에
curl -sS http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer $LOCAL_VARIANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"variant-topic","stream":false,"messages":[{"role":"user","content":"PASTE ENGLISH PASSAGE HERE"}]}'

# 스트리밍 (Cursor 가 이렇게 부를 수 있음) — 생성 중 15초마다 : keep-alive
curl -sSN http://127.0.0.1:8765/v1/chat/completions \
  -H "Authorization: Bearer $LOCAL_VARIANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"variant-summary","stream":true,"messages":[{"role":"user","content":"PASTE ENGLISH PASSAGE HERE"}]}'
```

모델 id: `variant-topic` `variant-title` `variant-claim` `variant-match` `variant-mismatch` `variant-blank` `variant-summary` `variant-order` `variant-insert` `variant-irrelevant` `variant-vocab` `variant-grammar`

응답 content = 마크다운(발문·지문·선지·정답·해설·경고) + 맨 끝 `` ```json question_data ``` ``.  
실패해도 HTTP 200 + content 에 오류 문구(`finish_reason: stop`).

## Cloudflare 터널 (Cursor 는 localhost 불가)

Cursor 요청은 Cursor 서버를 거쳐 오므로 공개 URL 이 필요하다.

```bash
brew install cloudflared   # 없을 때만
cloudflared tunnel --url http://localhost:8765
# → https://xxxx.trycloudflare.com
```

## Cursor 설정

Settings → Models:

1. **OpenAI API Key** = `LOCAL_VARIANT_API_KEY` 값
2. **Override OpenAI Base URL** 켜기 → `https://xxxx.trycloudflare.com/v1`
3. **Add model** → `variant-summary` 등 (내장 모델 이름과 겹치면 안 됨)
4. 채팅에서 그 모델을 고르고 **영어 지문만** 붙여 넣기

Override 를 켜 두면 Cursor 의 다른 OpenAI 계열 요청도 이 주소로 갈 수 있다. **시험이 끝나면 Override 를 끈다.**

한 문항 20~60초. 그사이 끊기면 스트리밍 keep-alive 가 부족한 것이니 알려 주세요.

## 보안

- 서버는 `127.0.0.1` 만 바인딩. 외부 노출은 터널뿐.
- 터널 URL 은 켤 때마다 바뀐다.
- 안 쓸 때는 서버·터널을 끈다. 인터넷에서 키만 알면 들어올 수 있다.
- Anthropic/OpenAI 등 외부 추론 API 는 쓰지 않는다(전부 맥 MLX).

## 구현 메모

- MLX 는 스레드마다 Stream 이 다르다. 모델 로딩·`run_pipeline` 은 **전용 추론 스레드**에서만 돌리고, HTTP 스레드는 큐에 넣고 기다린다.
- SSE 는 생성 중 15초마다 `: keep-alive` 를 보내고, `[DONE]` 뒤 **연결을 닫는다**(안 닫으면 클라이언트가 타임아웃까지 대기).
- 요약 등 일부 유형은 파이프라인이 가끔 실패한다(`ok: false`). HTTP 는 200 이고 content 에 「생성 실패…」가 온다 — 한 번 더 보내면 된다.
