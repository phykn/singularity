## 2026-11-04 — 6. particle-source

Tool: built-in image_gen.

```text
Polished pixel art for SINGULARITY, a dark electron survival game where lightning pops swarms of subatomic particles. Same artist as the attached style reference. Transparent background. Stepped dark contours, compact 4-5 tone bevels, one small ivory upper-left highlight. Clean deliberate low-resolution pixel clusters with bold readable silhouettes. No text, letters, numbers, frames, panels, background, blur, glow mist, or scattered grain.

Exactly SIX equal columns and ONE row: six isolated tiny particle sprites centered in equal square cells with transparent gutters, each designed on a TRUE 16x16 logical grid with very few large pixels. Extremely simple: no inner texture, only silhouette, a 1-pixel dark contour, 3 shades and one highlight pixel. They must stay distinct when hundreds overlap on a dark background.
Left to right:
1 QUARK: the SMALLEST, a tiny round dot about 7 pixels wide, muted rose red (#54283a, #8a3e50, #c4657a, #f0a3ad).
2 PROTON: a large circle about 12 pixels wide with a small "+" cross notch in its center, orange (#5a3418, #9a5a26, #d98b45, #f6c48a).
3 MUON: an ELLIPSE about 11x7 pixels stretched horizontally, violet (#3a2c58, #62509a, #9a86d4, #d2c6f2).
4 NEUTRON: a large plain circle about 13 pixels wide with a THICK 2-pixel dark rim and no mark, slate blue (#24323e, #3e5566, #6a8aa0, #a9c0d0).
5 NEUTRINO: a HOLLOW ring about 11 pixels wide with a transparent center, pale mint (#2e5a50, #5f9e8c, #9fd8c4, #e4fff5), lighter and ghostlier than the others. Not sky blue or cyan.
6 MESON: two small dots touching side by side like a dumbbell, about 12x6 pixels, left dot rose red like the quark and right dot lime green (#3c5020, #6a8a34, #a6cc5c, #dcf2a0).
Use case: stylized-concept. References are style only; do not copy their subjects or layout.
Generate large PNG: square cells in the exact requested grid, at least 1024 pixels on the long edge. Keep all art strictly inside its cell with clear transparent edge margins. No labels.
```

재생성 1회: 6:1 정사각 셀, 고리/플러스/아령 명료화. 재생성 후보는 불투명 체크 배경이 있어 폐기하고 첫 후보 선택. 사용자 승인 알파<=2 정리. 저장 전 16px 최근접 검사. 남은 문제: 출력 2172x724(3:1), 요청 6:1과 다름. 16px 정사각 축소 시 납작하고 민트 고리가 약함. 디자인 참고용으로만 사용 권장.

재생성 프롬프트 전문:

```text
Polished pixel art for SINGULARITY, a dark electron survival game where lightning pops swarms of subatomic particles. Same artist as the attached style reference. Transparent background. Stepped dark contours, compact 4-5 tone bevels, one small ivory upper-left highlight. Clean deliberate low-resolution pixel clusters with bold readable silhouettes. No text, letters, numbers, frames, panels, background, blur, glow mist, or scattered grain.

Exactly SIX equal columns and ONE row: six isolated tiny particle sprites centered in equal square cells with transparent gutters, each designed on a TRUE 16x16 logical grid with very few large pixels. Extremely simple: no inner texture, only silhouette, a 1-pixel dark contour, 3 shades and one highlight pixel. They must stay distinct when hundreds overlap on a dark background.
Left to right:
1 QUARK: the SMALLEST, a tiny round dot about 7 pixels wide, muted rose red (#54283a, #8a3e50, #c4657a, #f0a3ad).
2 PROTON: a large circle about 12 pixels wide with a small "+" cross notch in its center, orange (#5a3418, #9a5a26, #d98b45, #f6c48a).
3 MUON: an ELLIPSE about 11x7 pixels stretched horizontally, violet (#3a2c58, #62509a, #9a86d4, #d2c6f2).
4 NEUTRON: a large plain circle about 13 pixels wide with a THICK 2-pixel dark rim and no mark, slate blue (#24323e, #3e5566, #6a8aa0, #a9c0d0).
5 NEUTRINO: a HOLLOW ring about 11 pixels wide with a transparent center, pale mint (#2e5a50, #5f9e8c, #9fd8c4, #e4fff5), lighter and ghostlier than the others. Not sky blue or cyan.
6 MESON: two small dots touching side by side like a dumbbell, about 12x6 pixels, left dot rose red like the quark and right dot lime green (#3c5020, #6a8a34, #a6cc5c, #dcf2a0).
Use case: stylized-concept. References are style only; do not copy their subjects or layout.
Generate large PNG: square cells in the exact requested grid, at least 1024 pixels on the long edge. Keep all art strictly inside its cell with clear transparent edge margins. No labels.
Correction: generate a SIX TO ONE wide canvas (3072x512), six SQUARE equal cells. Each sprite occupies central 65% of its cell and absolutely never touches another cell. Quark is much smaller than proton/neutron. Neutrino must be a full closed hollow mint ring; Proton has a clear plus; Meson is two distinct touching circular dots. Extremely few big pixels. Avoid vertically stretched output and do not decorate.
```

### 최종 캔버스 정렬 검사 (2026-11-04)

새 이미지의 그림 픽셀을 확대/축소/다시 그리지 않고 투명 여백만 재배치하여 모든 칸을 같은 정사각형으로 정렬. 재생성 횟수에 해당하지 않는 캔버스 포장. 아이콘 448px/320px/400px 셀, 중간보스 512px 셀(2560×512), 일반 입자 384px 셀(2304×384). 최종 크기 최근접 미리보기 재검사. 이전의 알파/비율/눌림 문제는 해결됨. 일반 입자 민트 고리도 16px에서 식별됨. 이전 문제 기록은 포장 전 결과. 보스 경고 장식 개수, 진화 연속 3줄 및 작은 세부 요소는 여전히 남음. 그림 내용은 바뀌지 않아 기존 참조 이미지와 동일한 디자인을 유지함.

최종 남은 문제: 민트 고리의 반투명 표현은 약함. 16px 형태 구분과 고리의 투명한 중심은 확인됨.

## 수정 — 2026-11-04 proton

16px의 크림색 +를 굵기2/길이6으로 확대. 추가 재생성1회(첫 후보의 +가4px).
참고: /tmp/singularity-image-fixes-20261104/proton-before.png. 최종 크기 최근접 비교 확인. 지정 칸 외 픽셀 동일 검증 통과.

```text
Polished pixel art for SINGULARITY, a dark electron survival game. Same artist as the attached reference. Transparent background. Stepped dark contours, compact 4-5 tone bevels, one small ivory upper-left highlight. Clean deliberate low-resolution pixel clusters with bold readable silhouettes. No text, letters, numbers, frames, panels, background, blur, glow mist, or scattered grain.
EDIT ONLY this single PROTON sprite. Keep its centered position and orange circular body silhouette, diameter 12 pixels within a TRUE 16x16 logical square (75% of canvas width), and the orange palette of the reference. Replace the tiny center mark by a VERY CLEAR pale ivory cream PLUS SIGN #fff1cc, brighter than #f6c48a. The plus sign has exactly 2 logical pixels thickness and 6 logical pixels length in BOTH directions, centered. At 16px output it must unmistakably be a PLUS, not one bright dot. No other inner markings. Large 1024px square PNG but every shape aligned to a 16x16 logical grid. Transparent outer margin. One sprite only.
```

```text
Polished pixel art for SINGULARITY, a dark electron survival game. Same artist as the attached reference. Transparent background. Stepped dark contours, compact 4-5 tone bevels, one small ivory upper-left highlight. Clean deliberate low-resolution pixel clusters with bold readable silhouettes. No text, letters, numbers, frames, panels, background, blur, glow mist, or scattered grain.
EDIT ONLY this single PROTON sprite. Keep its centered position and orange circular body silhouette, diameter 12 pixels within a TRUE 16x16 logical square (75% of canvas width), and the orange palette of the reference. Replace the tiny center mark by a VERY CLEAR pale ivory cream PLUS SIGN #fff1cc, brighter than #f6c48a. The plus sign has exactly 2 logical pixels thickness and 6 logical pixels length in BOTH directions, centered. At 16px output it must unmistakably be a PLUS, not one bright dot. No other inner markings. Large 1024px square PNG but every shape aligned to a 16x16 logical grid. Transparent outer margin. One sprite only.
CORRECTION: the PLUS in the reference is much too small. Make the cross overall HALF THE DIAMETER OF THE ORANGE BODY, explicitly six of the sixteen logical pixels across and six tall, with a two pixel wide stem. The cross footprint is a 6x6 logical square: top two rows '..++..', middle two rows '++++++', bottom two rows '..++..'. Every '+' in this footprint is solid bright ivory #fff1cc, not orange. The body is 12 pixels diameter. Preserve body dimensions. Very large cream plus dominates the center.
```

## 수정 — 2026-11-04 neutron

16px의 어두운 2px 테두리와 밝은 회청 몸통. 추가 재생성0회.
참고: /tmp/singularity-image-fixes-20261104/neutron-before.png. 최종 크기 최근접 비교 확인. 지정 칸 외 픽셀 동일 검증 통과.

```text
Polished pixel art for SINGULARITY. Same artist as the attached sprite reference. Transparent background. Clean deliberate 16x16 logical pixel clusters, stepped dark contours, 3 body shades, one small ivory upper-left highlight. No text, letters, numbers, frames, panels, background, blur, glow mist, scattered grain.
EDIT this ONE NEUTRON sprite only. Keep the same center and size, a plain round slate-blue circle diameter 13 pixels in a TRUE 16x16 logical square. Absolutely no plus sign or internal marking. Give it a continuous TWO LOGICAL PIXEL THICK extremely dark blue-grey rim #111e29, clearly darker than #24323e, around the entire circular body. Body inside must be one tone brighter slate blue #819fb3 so the dark 2px rim contrasts strongly at 16px. Dark border is a defining massive thick shell, never thin 1px. Preserve round silhouette and current visual scale. Generate large 1024px square transparent PNG, aligned to only 16x16 logical pixels. One sprite, no other objects.
```
