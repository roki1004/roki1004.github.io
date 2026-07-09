/* ============================================================
   main.js — hero shader / lazy video embeds / filters / reveal

   [셰이더 학습 노트]
   이 파일의 프래그먼트 셰이더는 SHADER_NOTES.md 에서 한 줄씩
   해설합니다. Unity CG/HLSL 경험 기준으로 GLSL을 설명하니
   그 문서와 함께 읽으세요.
   ============================================================ */

(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================================================
     1. WebGL 히어로 셰이더
     ------------------------------------------------------------
     Unity와의 대응 관계:
       - Mesh + Material        ↔  버퍼(정점) + 프로그램(셰이더 쌍)
       - _Time, _ScreenParams   ↔  uniform uTime, uRes (직접 전달)
       - Graphics.Blit 풀스크린 ↔  화면을 덮는 삼각형 1개 그리기
     ============================================================ */

  var canvas = document.getElementById("gl");
  var gl = canvas && canvas.getContext("webgl", { antialias: false, alpha: false });

  if (gl) {
    /* ---- 정점 셰이더 ----------------------------------------
       화면 전체를 덮는 삼각형의 정점을 그대로 클립 공간에 놓는다.
       HLSL의 `float4 vert(float4 v:POSITION):SV_POSITION` 과 동일한 역할. */
    var VS = "attribute vec2 aP;void main(){gl_Position=vec4(aP,0.,1.);}";

    /* ---- 프래그먼트 셰이더 -----------------------------------
       구조: value noise → fbm(옥타브 합성) → 도메인 워핑 2회
             → 밝기값 f 로 3색 팔레트 믹스 → 비네트 + 그레인
       HLSL 대응: lerp→mix, saturate→clamp(x,0.,1.), frac→fract */
    var FS = [
      "precision highp float;",
      "uniform vec2 uRes;",      // 캔버스 해상도(px). HLSL의 _ScreenParams.xy
      "uniform float uTime;",    // 경과 시간(초).    HLSL의 _Time.y
      "uniform vec2 uMouse;",    // 마우스 위치 0..1

      /* hash: 좌표 → 의사난수(0..1). sin 의 큰 배수에서 소수부만 취하는
         고전적인 GPU 난수. Unity 노이즈 스터디에서 쓰는 것과 같은 기법. */
      "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}",

      /* value noise: 격자점 4곳의 난수를 부드럽게 보간.
         u=f*f*(3-2f) 는 smoothstep 곡선 — 보간의 경계를 매끄럽게 한다. */
      "float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);",
      " return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}",

      /* fbm (fractal Brownian motion): 노이즈를 옥타브마다
         주파수 2배(행렬 m: 회전+스케일), 진폭 1/2로 5회 누적.
         회전을 섞는 이유는 축 정렬된 격자 무늬를 감추기 위해서. */
      "float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);",
      " for(int i=0;i<5;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}",

      "void main(){",
      /* uv: 픽셀좌표 → 중심 원점, 세로 기준 정규화(가로 비율 유지) */
      " vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;",
      " float t=uTime*.045;",          // 전체 흐름 속도
      " vec2 m=(uMouse-.5)*.7;",       // 마우스를 -0.35..0.35 로 매핑
      " vec2 p=uv*1.55;",              // 노이즈 공간 스케일(패턴 크기)

      /* 도메인 워핑: '노이즈로 노이즈의 입력 좌표를 비튼다'.
         q = 1차 워프(시간이 흐르는 방향이 서로 달라 유체처럼 보임)
         r = 2차 워프(q 결과로 다시 비틀고, 마우스 m 을 더해 반응성 부여)
         f = 최종 밝기 필드 */
      " vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t*.7));",
      " vec2 r=vec2(fbm(p+3.2*q+vec2(1.7,9.2)+m),fbm(p+3.2*q+vec2(8.3,2.8)-m));",
      " float f=fbm(p+3.0*r);",

      /* 팔레트: 어두운 바탕→네이비를 f 로, 하이라이트는 r.x·f 가 큰
         능선에만 시안, q.y·f 가 큰 곳에 마젠타를 소량 얹는다.
         smoothstep(a,b,x) 는 HLSL 과 동일. */
      " vec3 base=vec3(.039,.055,.086);",   // #0A0E16
      " vec3 mid =vec3(.078,.153,.259);",   // 네이비
      " vec3 cyan=vec3(.435,.843,1.);",     // #6FD7FF 홀로그램 시안
      " vec3 mag =vec3(.851,.482,.910);",   // #D97BE8
      " vec3 c=mix(base,mid,smoothstep(.2,.9,f));",
      " c=mix(c,cyan,smoothstep(.5,.95,r.x*f)*.6);",
      " c=mix(c,mag, smoothstep(.55,1.,q.y*f)*.28);",

      /* 비네트: 중심에서 멀수록 어둡게(dot(uv,uv)=거리 제곱) */
      " c*=1.-.32*dot(uv,uv);",
      /* 필름 그레인: 픽셀+시간 기반 난수를 살짝 더해 밴딩 제거 */
      " c+=(hash(gl_FragCoord.xy+fract(uTime))-.5)*.028;",
      " gl_FragColor=vec4(c,1.);",
      "}"
    ].join("\n");

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        // 셰이더 문법 오류는 콘솔에서 확인
        console.error(gl.getShaderInfoLog(s));
      }
      return s;
    }

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    /* 풀스크린 삼각형: 화면(-1..1)을 넉넉히 덮는 정점 3개.
       사각형(정점 4개+인덱스)보다 싸고 이음매도 없다. */
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aP = gl.getAttribLocation(prog, "aP");
    gl.enableVertexAttribArray(aP);
    gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog, "uRes");
    var uTimeU = gl.getUniformLocation(prog, "uTime");
    var uMouseU = gl.getUniformLocation(prog, "uMouse");

    /* 마우스는 목표값(tmx)과 현재값(mx)을 분리해 매 프레임 6%씩
       따라가게 한다(지수 감쇠 보간) — Unity의 Vector2.Lerp 관성과 동일. */
    var mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5;
    var time = reduce ? 9.0 : 0;   // 모션 최소화 설정이면 시간 고정
    var last = 0, visible = true;
    var frames = 0, fpsAt = 0;

    function resize() {
      // DPR 1.5 제한: 고해상도 모니터에서 픽셀 수(=GPU 비용) 폭증 방지
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
    }
    window.addEventListener("resize", resize);

    var hero = document.querySelector("header.hero");
    hero.addEventListener("pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      tmx = (e.clientX - r.left) / r.width;
      tmy = 1 - (e.clientY - r.top) / r.height; // GL은 y가 아래→위
    });

    // 히어로가 화면 밖이면 그리기를 건너뛴다(배터리 절약)
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }, { threshold: 0 }).observe(hero);

    var elT = document.getElementById("uTime");
    var elM = document.getElementById("uMouse");
    var elF = document.getElementById("uFps");

    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible || document.hidden) { last = now; return; }
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!reduce) time += dt;
      mx += (tmx - mx) * 0.06;
      my += (tmy - my) * 0.06;
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTimeU, time);
      gl.uniform2f(uMouseU, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (elT) elT.textContent = time.toFixed(2);
      if (elM) elM.textContent = mx.toFixed(2) + ", " + my.toFixed(2);
      frames++;
      if (now - fpsAt > 1000) { if (elF) elF.textContent = String(frames); frames = 0; fpsAt = now; }
    }
    requestAnimationFrame(frame);
  } else if (canvas) {
    // WebGL 미지원 폴백: 정적 그라데이션
    canvas.style.background = "radial-gradient(120% 100% at 30% 20%, #14283F, #0A0E16)";
  }

  /* ============================================================
     2. 비디오 지연 로딩 — 재생 버튼을 누를 때만 iframe 생성
     ============================================================ */
  var EMBED = {
    youtube: function (id) {
      return "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0";
    },
    linkedin: function (id) {
      return "https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:" + id + "?compact=1";
    }
  };

  document.querySelectorAll(".media[data-embed]").forEach(function (media) {
    var btn = media.querySelector(".play");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var kind = media.getAttribute("data-embed");
      var id = media.getAttribute("data-id");
      if (!EMBED[kind]) return;
      var iframe = document.createElement("iframe");
      iframe.src = EMBED[kind](id);
      iframe.title = btn.getAttribute("aria-label") || "video";
      iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
      iframe.setAttribute("allowfullscreen", "");
      media.innerHTML = "";
      media.appendChild(iframe);
    });
  });

  /* ============================================================
     3. 아카이브 필터
     ============================================================ */
  var btns = document.querySelectorAll(".filters button");
  var cards = document.querySelectorAll(".grid .card");
  btns.forEach(function (b) {
    b.addEventListener("click", function () {
      btns.forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
      var f = b.getAttribute("data-f");
      cards.forEach(function (c) {
        var show = f === "all" || (c.getAttribute("data-tags") || "").split(" ").indexOf(f) >= 0;
        if (show) c.removeAttribute("hidden"); else c.setAttribute("hidden", "");
      });
    });
  });

  /* ============================================================
     4. 스크롤 리빌
     ============================================================ */
  if (!reduce && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
  }
})();
