# 이미지 생성 목록

새로 생성해야 할 이미지와 프롬프트, 적용 방법을 정리한 문서입니다. 아직 생성하거나 코드에 연결한 이미지는 없습니다.

| 우선순위 | 항목                | 수량 | 현재 상태                                                      | 소스 파일 (제안)                           |
| -------- | ------------------- | ---- | -------------------------------------------------------------- | ------------------------------------------ |
| 1        | 중간보스 스프라이트 | 4    | 중성자 구체를 3배로 확대해 사용                                | `assets/boss-art/middle-source.png`        |
| 1        | 막보스 스프라이트   | 1    | 같은 구체를 4배로 확대해 사용                                  | `assets/boss-art/final-source.png`         |
| 1        | 새 스킬 아이콘      | 2    | 정전기 표식은 축전, 공명 코일은 연속 번개 아이콘을 임시로 사용 | `assets/icon-art/late-game-source.png`     |
| 1        | 개편 스킬 아이콘    | 2    | 전기 그물·질량 분출이 예전 궤도 장벽·질량 환원 그림을 사용     | `assets/icon-art/late-game-source.png`     |
| 1        | 대가 카드 아이콘    | 3    | 공격력, 이동 속도, 공격 속도 아이콘을 재사용                   | `assets/icon-art/late-game-source.png`     |
| 2        | 진화 아이콘         | 4    | 원래 스킬 아이콘에 `EVO` 표시와 금색 테두리만                  | `assets/icon-art/late-game-source.png`     |
| 2        | 파비콘과 앱 아이콘  | 1    | 없음. `index.html`에 아이콘 링크가 없음                        | `assets/icon-art/app-icon-source.png`      |
| 3        | 링크 공유 이미지    | 1    | 없음. `index.html`에 `og:image`가 없음                         | `assets/icon-art/share-source.png`         |
| 보류     | 배경                | 1    | 단색 `#080a0e`                                                 | 입자 군집 가독성을 해칠 수 있어 권장 안 함 |

스킬 아이콘 4개, 대가 아이콘 3개, 진화 아이콘 4개는 한 장으로 생성하는 편이 좋습니다. 스타일이 맞기 때문입니다. 개편 아이콘 2개는 기존 칸을 덮어쓰고, 나머지 9개를 기존 21칸 뒤에 붙이면 `skills.png`는 7×5 격자(30칸 사용)가 됩니다.

## 공통 규칙

기존 아이콘과 같은 방식입니다. 자세한 기록은 [assets/icon-art/README.md](assets/icon-art/README.md)와 [assets/icon-art/prompts.md](assets/icon-art/prompts.md)에 있습니다.

- 생성할 때 `assets/icon-art/skill-source.png`를 스타일 참고 이미지로 첨부합니다.
- 소스는 크게 생성해서 저장하고, 게임에는 최근접 샘플링으로 줄인 아틀라스만 넣습니다. 기존 소스는 1254×1254, 1774×887입니다.
- 배경은 투명해야 합니다. 글자, 틀, 패널, 번짐, 안개 효과는 넣지 않습니다.
- 칸이 여러 개면 크기를 똑같이 하고, 그림끼리 닿지 않게 여백을 둡니다.
- 최종 크기에서 직접 확인합니다. 아이콘은 32px와 24px, 보스는 게임 화면에서 봅니다.
- 작성한 프롬프트와 선택 결과는 해당 폴더의 `prompts.md`에 남깁니다.

공통 스타일 문구입니다. 아래 프롬프트마다 앞에 붙입니다.

```text
Polished pixel art for SINGULARITY, a dark electron survival game, as if drawn by the same artist as the attached style reference. Transparent background. Stepped dark contours, compact 4-5 tone bevels, one small ivory upper-left highlight. Clean deliberate low-resolution pixel clusters. No text, frames, panels, background, blur, glow mist, or scattered grain.
```

## 1. 중간보스 스프라이트

**이유:** 16px 구체를 확대해서 픽셀이 주변보다 눈에 띄게 굵습니다. 일반 중성자와 색과 모양이 같아, 붉은 테두리와 크기로만 구분됩니다. 4마리의 차이도 보이지 않습니다.

**규격**

- 네 마리 모두 최종 크기 48×48, 4×1 시트 하나로 만듭니다.
- 그림이 칸의 약 90%를 채워야 합니다. 충돌 크기(`boss.size`)는 칸 크기와 무관하게 14로 고정입니다.
- 윤곽이 뚜렷해야 합니다. 맞을 때 스프라이트 전체를 흰색으로 칠하는 효과가 있습니다.

```text
Exactly FOUR equal columns and ONE row, four isolated giant particle bosses centered in equal square cells with generous transparent gutters. Each is designed for a 48x48 logical grid with a bold round silhouette. Shared body palette: slate blue #34495a, #56758b, #88a5bb, #c0d4df, with warning red #ff536b accents, so they read as a heavier, hostile kind of neutron.
Left to right, the threat grows while the round silhouette stays the same:
1 Smooth armored sphere with ONE thin red seam.
2 Sphere with TWO crossing red seams and a small open vent.
3 Sphere with heavy plates, THREE red seams, and two small orbiting shards fixed close to the body.
4 Cracked sphere with a bright red core visible through the plates and FOUR short angular shards fixed close to the body.
```

**적용**

1. `src/art/assets/bosses.png`로 패킹합니다. `scripts/art.mjs`의 `packIcons`는 현재 32px 칸 기준이라 칸 크기를 받도록 확장해야 합니다.
2. `src/render/ElectronScene.ts`의 보스 그리기에서 `target.particle` 대신 단계별 프레임을 쓰고, 배율을 1로 낮춥니다. `Target`에 보스 단계 정보가 필요합니다.
3. 입자 도감 등 `ParticleIcon`은 그대로 둡니다.

## 2. 막보스 스프라이트

**이유:** 현재 중간보스와의 차이는 크기와 2px 테두리뿐입니다. 승패를 가르는 적인데 처음 봐서는 막보스인지 알기 어렵습니다.

**규격**

- 최종 크기 64×64, 한 장입니다.
- 그림이 칸의 약 90%를 채워야 합니다. 충돌 크기(`boss.final.size`)는 18로 고정입니다.
- 중간보스와 색 구성이 달라야 합니다. 무한 모드의 보라색(`#b0a0ff`)과 충전 전자의 금색(`#f9d894`)도 다른 뜻으로 이미 쓰이므로 주조색으로 쓰지 않습니다.

```text
ONE isolated final boss centered in a single square cell with a transparent margin, designed for a 64x64 logical grid. A colossal collapsing particle: near-black charcoal plates #14161c and #2a2e38 fractured over a blazing warning red #ff536b and white-hot core visible through the cracks. A thick broken ring of angular shards wraps tightly around the body. Bold round silhouette that stays readable when fully filled with white. Obviously more dangerous than a slate-blue giant particle, and not violet or gold.
```

**적용:** 중간보스와 같습니다. `src/art/assets/bosses.png`의 별도 칸 또는 별도 파일로 넣고, `target.final`일 때 사용합니다.

## 3. 스킬, 대가 카드, 진화 아이콘

**이유**

- 새 스킬 정전기 표식(`mark`)과 공명 코일(`tempo`)은 아직 그림이 없어 축전과 연속 번개 아이콘을 빌려 씁니다(`src/art/skills.ts`의 `borrowed`). 카드에서 다른 스킬과 구분되지 않습니다.
- 궤도 장벽은 전기 그물로, 질량 환원은 질량 분출로 바뀌었는데 아이콘은 예전 효과(밀어내기 장벽, 질량 감소)를 그립니다.
- 대가 카드는 위험을 감수하는 선택인데, 일반 스탯 카드와 아이콘이 같습니다.
- 진화 카드도 원래 스킬과 아이콘이 같습니다.

**규격:** 최종 크기 32×32, 4×3 시트 한 장에 11개, 마지막 칸은 비웁니다. 진화 대상은 연쇄, 갈래, 관통, 위성 넷입니다. 개편·진화 아이콘은 기존 실루엣을 알아볼 수 있어야 하므로 `skill-source.png`를 함께 첨부합니다. 색은 스킬 색(`src/art/palette.ts`의 `skillColors`)을 따릅니다.

```text
Exactly FOUR equal columns and THREE equal rows, 11 isolated icons and the LAST cell fully EMPTY. Each subject is centered in its cell with generous transparent gutters and designed for a 32x32 logical grid, readable at 24px.
Row 1, skills:
1 STATIC MARK: three small round particles, each tagged with a tiny cyan #8ff0ff spark, joined in sequence by one short jagged cyan bolt that pops the last one into a few pixel shards.
2 TEMPO COIL: a compact pink #ffc4e8 coil spring with three evenly spaced beat ticks above it and a curved sweep arc running along its top.
3 ORBIT NET: a short curved section of orbit drawn as a periwinkle #9bafff electric mesh, with one small particle caught in it and two tiny zap marks.
4 MASS BURST: a small faceted dark core with one sage #c8dd96 shockwave ring leaving it and three particles at the ring's edge breaking into shards.
Row 2, pact icons. Warning red #ff536b is dominant, with dark charcoal accents, and they read as dangerous bargains rather than ordinary upgrades:
5 OVERLOAD: a heavy sword cracked with red energy, weighed down by a small dark mass hanging from its hilt. Not the coral sword from the reference.
6 GREED: a clawed hand closing over a glowing red energy shard, with a small speed streak behind it.
7 OVERCLOCK: a cracked clock-like dial with its needle forced past the red zone.
8 CHAIN EVOLVED: the reference Chain icon's two green nodes and bent lightning path, now closed into a LOOP, with a small gold accent.
Row 3:
9 FORK EVOLVED: the reference Fork icon's gold three-prong fork, with its three tips joined by a thin crosslink arc.
10 PIERCE EVOLVED: the reference Pierce icon's violet arrow through two rings, leaving a bright broken trail behind it.
11 SATELLITE EVOLVED: the reference Satellite icon's cyan electron and moons, with the moons connected by a closed bright ring.
12 EMPTY: completely transparent unused cell.
```

**적용**

1. `scripts/art.mjs`에 새 소스를 추가하고, 전기 그물과 질량 분출은 기존 `bridge`, `vent` 칸을 덮어씁니다. 아틀라스 크기 검사를 224×96에서 224×160으로 바꿉니다.
2. `src/art/skills.ts`에서 `borrowed`를 지우고 `mark`, `tempo`가 자기 칸을 쓰게 합니다. 대가 아이콘이 기존 스탯 칸을 빌려 쓰는 부분도 새 칸으로 바꾸고, 진화 아이콘 칸을 추가합니다.
3. `SkillIcon`(`src/ui/icons.tsx`)에 진화 여부를 전달하고, `Choices.tsx`, `Loadout.tsx`, `SkillDetails.tsx`에서 넘깁니다.
4. `assets/icon-art/README.md`의 소스 표와 Runtime order를 갱신합니다.
5. `npm run build:art`로 생성한 뒤 `npm run check:late-game`, `npm run check:languages`로 확인합니다.

## 4. 파비콘과 앱 아이콘

**이유:** 브라우저 탭 아이콘이 없고, 개발 서버 로그에도 파비콘 404가 찍힙니다.

**규격:** 정사각형 한 장으로 생성해서 32×32, 180×180, 512×512로 줄입니다. 이 아이콘만 배경을 채웁니다.

```text
ONE app icon filling a square, on a solid near-black #080a0e background. A thin pale teal circular orbit with one bright cyan electron at the upper right, around a small faceted dark core at the center. Bold and minimal, readable at 32x32. Ignore the transparent-background rule for this image only.
```

**적용:** `public/`에 넣고 `index.html`에 `<link rel="icon">`과 `<link rel="apple-touch-icon">`을 추가합니다.

## 5. 링크 공유 이미지

**이유:** 링크를 공유할 때 미리보기 이미지가 나오지 않습니다. 파비콘보다는 급하지 않습니다.

**규격:** 1200×630. 배경을 채웁니다. 제목은 이미지 생성에 맡기면 글자가 깨질 수 있으므로, 왼쪽을 비워 두고 나중에 게임 폰트로 합성합니다.

```text
A wide 1200x630 pixel-art key image on a solid near-black #080a0e background. On the right, a thin teal circular orbit with one bright cyan electron firing a jagged lightning strand into a dense ring of small pastel red, violet, gold and slate-blue spheres, with one giant cracked sphere approaching the small dark core at the center. Keep the LEFT 40% empty for a title added later. No text. Ignore the transparent-background rule for this image only.
```

**적용:** `public/`에 넣고 `index.html`에 `og:image`와 `twitter:card` 메타 태그를 추가합니다. `og:image`에는 공개 사이트의 전체 URL을 씁니다.

## 생성하지 않는 것

아래는 코드로 그리거나 자동으로 만들어지므로 이미지 생성 대상이 아닙니다.

| 대상                                       | 만드는 곳                                                     |
| ------------------------------------------ | ------------------------------------------------------------- |
| 번개 줄기, 타격, 강한 타격, 소멸 이펙트    | `assets/effect-art/sprites.mjs`에서 그린 뒤 스킬 색을 입힘    |
| 일반 입자와 전자                           | `src/art/particles.ts`                                        |
| 핵, 블랙홀, 궤도, 엔딩 연출                | `src/render/ElectronScene.ts`, `src/render/singularity.ts` 등 |
| 데미지 숫자                                | `src/render/damageFont.ts`                                    |
| README 스크린샷 (`docs/images/gameplay-*`) | 실제 게임 화면을 캡처한 것. 생성 이미지로 대체하지 않음       |
