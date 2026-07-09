# 히어로 셰이더 학습 노트

> 이 문서는 사이트 배경에서 돌아가는 WebGL 프래그먼트 셰이더를
> **Unity CG/HLSL 경험자 기준**으로 해설합니다. 목표는 "이 셰이더는
> 제가 설명하고 수정할 수 있는 제 코드다"라고 말할 수 있는 상태입니다.
> 실제 코드는 [assets/main.js](assets/main.js) 안에 주석과 함께 있습니다.

---

## 1. WebGL과 Unity의 대응 관계

WebGL은 브라우저에서 돌아가는 OpenGL ES 2.0입니다. Unity에서 하던 일과 1:1로 대응됩니다.

| Unity | WebGL (이 사이트) |
|---|---|
| Mesh (쿼드) | 정점 버퍼 — 화면을 덮는 삼각형 1개 |
| Material + Shader | Program (버텍스 + 프래그먼트 셰이더 쌍) |
| `material.SetFloat("_T", t)` | `gl.uniform1f(loc, t)` |
| `_Time.y` | 직접 만든 `uniform float uTime` |
| `_ScreenParams.xy` | `uniform vec2 uRes` |
| `Graphics.Blit` 풀스크린 패스 | `gl.drawArrays(TRIANGLES, 0, 3)` |

핵심 차이: **Unity가 자동으로 채워주던 내장 변수(`_Time` 등)를 WebGL에서는
JS에서 매 프레임 직접 넣어준다**는 것뿐입니다. 셰이더 본문의 사고방식은 동일합니다.

### 풀스크린 삼각형 트릭

쿼드(정점 4개) 대신 정점 3개 `(-1,-1), (3,-1), (-1,3)`으로 화면보다 큰 삼각형을
그립니다. 화면 밖은 클리핑되고, 사각형 2개를 이어 붙일 때 생기는 대각선 이음매가
없어서 풀스크린 패스의 표준 기법입니다. (Unity의 최신 Blit도 내부적으로 이렇게 합니다.)

## 2. GLSL ↔ HLSL 문법 대응표

거의 이름만 다릅니다. 이 표만 알면 HLSL 코드를 그대로 옮길 수 있습니다.

| HLSL (Unity CG) | GLSL (WebGL) | 비고 |
|---|---|---|
| `float2/3/4` | `vec2/3/4` | |
| `float2x2` | `mat2` | 곱셈 순서 주의: GLSL은 `m * v` |
| `lerp(a,b,t)` | `mix(a,b,t)` | |
| `saturate(x)` | `clamp(x, 0.0, 1.0)` | GLSL엔 saturate 없음 |
| `frac(x)` | `fract(x)` | |
| `fmod(x,y)` | `mod(x,y)` | 음수 처리 방식 다름 |
| `tex2D(s, uv)` | `texture2D(s, uv)` | |
| `SV_POSITION` | `gl_Position` (버텍스) | |
| 픽셀 좌표 | `gl_FragCoord.xy` | Unity의 `VPOS`와 동일 |
| 반환값이 색 | `gl_FragColor` | |

주의점 두 가지:
- GLSL(ES 2.0)은 **타입에 엄격**합니다. `float f = 1;` 은 에러 — 반드시 `1.0`.
- y축 방향: `gl_FragCoord`는 **아래가 0**입니다. 마우스 y를 `1 - y`로 뒤집는 이유.

## 3. 셰이더 구조 — 큰 그림

```
hash()        좌표 → 난수 하나
  ↓
noise()       난수 4개를 보간 → 부드러운 노이즈 (value noise)
  ↓
fbm()         노이즈를 5옥타브 누적 → 구름 같은 디테일
  ↓
도메인 워핑    fbm으로 fbm의 입력 좌표를 두 번 비틈 → 유체 느낌
  ↓
팔레트        밝기 f 를 기준으로 3색을 섞음
  ↓
후처리        비네트(가장자리 어둡게) + 그레인(밴딩 제거)
```

## 4. 한 줄씩 해설

### 4-1. hash — GPU 의사난수

```glsl
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
```

좌표 `p`를 임의의 방향 벡터에 내적 → sin으로 -1..1 진동 → 큰 수를 곱해
소수부만 취하면 사실상 예측 불가능한 0..1 값이 됩니다. 텍스처 없이 난수를
만드는 셰이더의 고전 기법으로, HLSL에서도 글자 하나 안 바꾸고 동작합니다
(`frac` → `fract`만 주의).

### 4-2. value noise — 부드러운 난수

```glsl
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);      // 격자 칸 번호 / 칸 안의 위치
  vec2 u = f*f*(3.0-2.0*f);             // smoothstep 곡선 (에르미트 보간)
  return mix( mix(hash(i),           hash(i+vec2(1,0)), u.x),
              mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
```

격자의 네 모서리 난수를 이중 선형 보간(bilinear)하되, 보간 계수를
`3t²-2t³` 곡선으로 왜곡해 격자 경계에서 기울기가 0이 되게 합니다.
이게 없으면 격자 무늬가 그대로 보입니다. Unity에서 Perlin noise를
직접 구현해봤다면 같은 아이디어의 단순화 버전입니다(gradient 대신 value).

### 4-3. fbm — 옥타브 누적

```glsl
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);   // ≈ 2배 확대 + 37° 회전
  for(int i = 0; i < 5; i++){
    v += a * noise(p);                  // 현재 옥타브 더하기
    p = m * p;                          // 주파수 ↑ (패턴이 절반 크기로)
    a *= 0.5;                           // 진폭 ↓
  }
  return v;                             // 대략 0..1
}
```

"큰 파도 + 중간 파도 + 잔물결"을 겹치는 것. 행렬 `m`은 스케일 2배에
회전을 섞은 것인데, **회전 없이 스케일만 하면 옥타브들의 격자가 정렬되어
십자 무늬 아티팩트**가 보입니다. 회전이 그걸 숨깁니다.

### 4-4. 도메인 워핑 — 이 셰이더의 심장

```glsl
vec2 q = vec2( fbm(p + t),                    fbm(p + vec2(5.2,1.3) - t*0.7) );
vec2 r = vec2( fbm(p + 3.2*q + vec2(1.7,9.2) + m), fbm(p + 3.2*q + vec2(8.3,2.8) - m) );
float f = fbm(p + 3.0*r);
```

`fbm(p)`는 구름이지만, `fbm(p + fbm(p))`는 **연기와 유체**가 됩니다.
노이즈의 결과로 노이즈의 입력 좌표를 비틀기 때문입니다(도메인 워핑,
Inigo Quilez가 정리한 기법).

- `q`: 1차 워프. 두 성분의 시간 방향(`+t` / `-0.7t`)을 다르게 줘서
  전체가 한 방향으로 밀리지 않고 "휘도는" 느낌을 만듭니다.
- `r`: 2차 워프. `q`로 이미 비틀린 좌표를 다시 비틀고, 여기에 마우스
  오프셋 `m`을 더해 커서가 필드를 밀어내는 상호작용을 만듭니다.
- `vec2(5.2, 1.3)` 같은 상수들은 수학적 의미 없이 두 fbm 호출이 서로
  다른 무늬를 갖게 하는 시드(seed)입니다. 아무 값이나 넣어도 됩니다.
- `f`: 최종 밝기 필드. 이 한 개의 float가 화면의 모든 형태를 결정합니다.

### 4-5. 팔레트 — 디자인이 개입하는 곳

```glsl
vec3 c = mix(base, mid, smoothstep(0.2, 0.9, f));        // 바탕→네이비
c = mix(c, cyan, smoothstep(0.5, 0.95, r.x*f) * 0.6);    // 능선에만 시안
c = mix(c, mag,  smoothstep(0.55, 1.0, q.y*f) * 0.28);   // 마젠타는 더 희귀하게
```

포인트는 시안을 `f`가 아니라 `r.x * f`에 걸었다는 것 — 두 필드가 **동시에**
높은 좁은 능선에만 하이라이트가 떨어져서, 전체가 파랗게 물드는 대신
가는 빛줄기처럼 보입니다. 마지막 곱(`*0.6`, `*0.28`)은 최대 기여량 제한.
Unity에서 램프 텍스처로 하던 일을 수식으로 하는 것과 같습니다.

### 4-6. 후처리

```glsl
c *= 1.0 - 0.32*dot(uv,uv);                              // 비네트
c += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5)*0.028; // 그레인
```

- `dot(uv,uv)` = 중심 거리의 제곱. 가장자리를 어둡게 눌러 시선을 카피 쪽으로.
- 그레인은 어두운 그라데이션에서 8bit 색 단계가 띠로 보이는 **밴딩**을
  ±1.4% 난수로 디더링해 없앱니다. 매 프레임 난수가 바뀌어 필름 노이즈처럼 보입니다.

## 5. JS 쪽 — Unity로 치면 C# 스크립트

```js
gl.uniform1f(uTimeU, time);    // material.SetFloat("_Time", t)
gl.uniform2f(uMouseU, mx, my); // material.SetVector("_Mouse", m)
gl.drawArrays(gl.TRIANGLES, 0, 3);
```

성능 장치 세 가지 (VR 최적화 경험과 같은 사고방식):
1. **DPR 1.5 제한** — 레티나에서 픽셀 수가 4배로 뛰는 걸 방지. 풀스크린
   프래그먼트 셰이더의 비용은 정확히 픽셀 수 × 셰이더 복잡도입니다.
2. **IntersectionObserver** — 히어로가 스크롤 밖이면 draw call 자체를 생략.
3. **마우스 지수 감쇠 보간** (`mx += (tmx-mx)*0.06`) — 입력을 그대로 쓰면
   커서를 튕길 때 필드가 순간이동합니다. Unity의 `Lerp(current, target, k)` 관성과 동일.

## 6. 직접 만져보기 — 추천 실험 순서

브라우저에서 `assets/main.js`의 숫자를 바꾸고 새로고침만 하면 됩니다.

1. `uv*1.55` → `3.0`으로: 패턴이 절반 크기로. (노이즈 공간 스케일)
2. `uTime*.045` → `.15`로: 흐름이 3배 빨라짐.
3. fbm 루프 `i<5` → `i<2`로: 디테일이 사라지고 뭉툭해짐. 옥타브의 역할 체감.
4. `f=fbm(p+3.0*r)` → `f=fbm(p)`로: 워핑을 끄면 그냥 구름. 워핑의 역할 체감.
5. `smoothstep(.5,.95,r.x*f)` 의 `.5`를 `.2`로: 시안이 화면을 뒤덮음.
   임계값이 하이라이트의 희소성을 조절한다는 것 체감.
6. (도전) 팔레트를 본인의 Unity 셰이더 색으로 교체 → 나만의 버전 완성.

## 7. 면접에서 "이 배경 뭐예요?" 답변 골격

> "도메인 워핑한 fbm 노이즈를 WebGL 프래그먼트 셰이더로 그린 겁니다.
> value noise를 5옥타브 누적한 fbm을 만들고, 그 fbm으로 자기 입력 좌표를
> 두 번 비틀어 유체 느낌을 냈습니다. 마우스 위치를 유니폼으로 넣어 2차
> 워프에 더했고요. 원래 Unity CG/HLSL로 셰이더를 공부해서, GLSL은
> lerp가 mix가 되는 정도의 문법 차이라 옮기는 건 어렵지 않았습니다.
> 풀스크린 셰이더라 픽셀 수가 곧 비용이어서 DPR을 1.5로 제한하고
> 화면 밖에선 드로우를 멈추게 했습니다."

여기서 어떤 꼬리 질문이 와도 (fbm이 뭔지, 왜 회전 행렬을 쓰는지, 왜
smoothstep인지) 이 문서의 4장에 답이 있습니다.

## 8. 더 공부하기

- The Book of Shaders (한국어판 있음) — noise/fbm 장이 이 셰이더와 정확히 겹칩니다.
- Inigo Quilez, "Domain Warping" — 4-4장의 원전.
- Shadertoy — 이 셰이더의 main()을 거의 그대로 붙여넣어 실험할 수 있습니다
  (`uTime`→`iTime`, `uRes`→`iResolution.xy`, `uMouse`→`iMouse.xy/iResolution.xy`).
