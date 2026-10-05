# SINGULARITY

**작은 전자에서, 거대한 특이점까지.**

궤도를 도는 전자를 지키고 번개를 성장시키는 도트 그래픽 생존 게임입니다. 이동과 공격은 자동으로 진행됩니다. 당신의 선택은 어떤 번개를 모으고, 어떤 조합으로 살아남을지입니다.

<p align="center">
  <img src="docs/images/gameplay-1.jpg" width="32%" alt="입자가 몰려오는 전자의 궤도" />
  <img src="docs/images/gameplay-2.jpg" width="32%" alt="전투 중 등장한 세 가지 강화 선택" />
  <img src="docs/images/gameplay-3.jpg" width="32%" alt="갈래 번개와 추격 번개를 조합한 전투" />
</p>

## 게임 소개

적을 처치하며 경험치를 모으고, 레벨이 오를 때마다 세 가지 강화 중 하나를 고르세요. 놓친 입자가 핵에 쌓이면 궤도가 좁아집니다. 궤도가 무너지기 전에 성장해 특이점을 만들어야 합니다.

- **나만의 번개 조합** — 16종의 스킬 중 네 가지를 조합하고 단계별로 강화합니다.
- **선택의 순간** — 스킬 등급은 처음 획득할 때 고정됩니다. 지금 얻을지, 더 좋은 등급을 기다릴지 결정하세요.
- **가볍게 시작하는 플레이** — 브라우저에서 플레이하며, 진행 상황은 기기에 자동 저장됩니다.
- **모바일과 데스크톱** — 한국어·영어·중국어·일본어를 지원합니다.

## 로컬 실행

Node.js 24 이상이 필요합니다.

```sh
npm ci
npm run dev
```

[localhost:8081](http://localhost:8081)에서 플레이할 수 있습니다.

| 명령어          | 용도             |
| --------------- | ---------------- |
| `npm test`      | 게임 규칙 테스트 |
| `npm run build` | 배포용 빌드      |

## 제작 정보

React · Phaser · TypeScript · Vite

아이콘: [Pixelarticons](https://github.com/halfmage/pixelarticons) · 글꼴: [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)

코드는 [PolyForm Noncommercial 1.0.0](LICENSE)을 따릅니다. 상업적 이용은 라이선스의 허용 범위 밖이라면 [개발자](https://github.com/phykn)의 별도 허가가 필요합니다. 외부 라이브러리와 글꼴에는 각자의 라이선스가 적용됩니다.
