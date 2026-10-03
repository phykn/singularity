# SINGULARITY

**번개를 키우고, 중력을 버티고, 특이점에 도달하세요.**

전자가 궤도를 돌며 번개로 적을 처치하는 모바일 웹 게임입니다. 이동과 공격은 자동으로 진행됩니다. 경험치를 모아 스킬을 조합하고, 최대 10분 안에 블랙홀을 만들어 보세요.

[플레이하기 · 개발 서버](https://flyer-affirm-observer.ngrok-free.dev)

> 개발 PC와 터널이 실행 중일 때 접속할 수 있습니다. ngrok 안내가 나오면 **Visit Site**를 누르세요.

## 플레이

- **세 카드 중 하나 선택** — 레벨이 오르면 번개 스킬이나 공격력·공격 속도·이동 속도를 강화합니다. 8초 동안 선택하지 않으면 자동으로 고릅니다.
- **자유로운 조합** — 번개 스킬 네 종류를 조합하고 각각 다섯 단계까지 강화합니다. 희귀도에 따라 위력과 형태가 달라집니다.
- **점점 좁아지는 궤도** — 놓친 적은 중앙에 쌓여 중력을 키웁니다. 충분히 성장한 전자가 충돌하면 블랙홀이 됩니다.
- **이어 하기** — 진행은 자동으로 저장됩니다. 화면을 떠나면 게임 시간이 멈추고, 탭을 다시 열면 저장한 판을 이어 합니다.

**한국어 · English · 中文 · 日本語**를 지원합니다. 첫 화면에서 언어를 고르고 **START**를 누르세요. 사운드와 시각 효과는 일시정지 메뉴에서 바꿀 수 있습니다.

## 로컬 실행

Node.js **24 이상**이 필요합니다.

```sh
npm ci
npm run dev
```

[localhost:8081](http://localhost:8081)에서 실행됩니다. 같은 네트워크의 휴대폰에서는 개발 PC의 IP 주소와 포트 `8081`로 접속할 수 있습니다.

```sh
npm run build     # dist/에 제작 빌드 생성
npm run preview   # 제작 빌드 확인 · 개발 서버를 먼저 종료
```

## 개발

**React · Phaser · TypeScript · Vite**로 만듭니다. React가 화면과 카드 선택을, Phaser가 전장과 효과를 담당합니다.

| 바꿀 내용 | 시작 파일 |
| --- | --- |
| 화면과 스타일 | [App.tsx](src/App.tsx), [style.css](src/style.css) |
| 전투와 성장 | [game.ts](src/game.ts), [growth.ts](src/growth.ts) |
| 스킬·난이도 수치 | [rules.json](design/rules.json) |
| 그래픽과 번개 효과 | [scene.ts](src/scene.ts), [pixels.ts](src/pixels.ts) |
| 번역 | [i18n.ts](src/i18n.ts) |
| 저장과 복원 | [storage.ts](src/storage.ts), [useGame.ts](src/useGame.ts) |

저장된 판은 해당 버전의 규칙으로 복원합니다. 규칙을 바꿀 때는 이전 저장의 재생 결과도 함께 확인합니다.

## 검사

```sh
npm test
npm run check:design
npm run benchmark
npm run check:balance
npm run build
```

개발 서버와 Chrome 또는 Edge가 설치된 환경에서는 화면·번역·진행 복원을 검사할 수 있습니다.

```sh
npm run check:browser
npm run check:languages
npm run check:resume
```

서버 주소는 `GAME_URL`, 브라우저 실행 파일은 `BROWSER_PATH` 환경변수로 지정합니다. 검사 보고서와 화면 캡처는 로컬 `artifacts/`에 저장합니다. 모바일 화면을 모사한 검사는 실제 휴대폰의 성능·발열·조작감 확인을 대체하지 않습니다.
