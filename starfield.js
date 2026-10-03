/* ==========================================================================
   starfield.js
   Ambient space background: stars that flicker and drift, with regular
   shooting stars.

   How it works
   - Every section listed in SECTIONS gets its own <canvas class="sky"> as its
     first child. The canvas sits behind the section's content (z-index -1
     inside the section's own stacking context), so text stays crisp and
     clickable.
   - Only sections near the viewport are allocated and drawn. One shared
     requestAnimationFrame loop drives everything.
   - prefers-reduced-motion: stars are drawn once, still. No loop at all.

   Everything you are likely to want to tweak is in CONFIG and LAYERS below.
   ========================================================================== */
(function () {
  "use strict";

  var CONFIG = {
    // sections that get a sky. Add or remove selectors freely.
    SECTIONS: ".hero-wrap, .about, .experience, .dashboard, .projects, .project, .skills, .log, .contact",

    // stars per CSS pixel squared (1 / N). Smaller N = more stars.
    DENSITY: 1 / 2000,
    MAX_STARS: 650,
    MOBILE_FACTOR: 0.65,         // multiplier on touch / narrow screens

    // max canvas backing-store pixels per section. Lower = faster, softer stars.
    PIXEL_BUDGET: 1500000,

    ALPHA: 1,                    // peak brightness of a star (0 to 1)
    DRIFT: 1,                    // 1 = default drift speed, 0 = no drift
    TWINKLE: 1,                  // 1 = default flicker speed
    POINTER_PARALLAX: 22,        // px of mouse parallax on the nearest stars
    SCROLL_PARALLAX: 0.07,       // how much farther stars lag behind the page

    METEORS: true,
    METEOR_FIRST_MS: 1200,       // first shooting star after load
    METEOR_MIN_S: 3,             // then one every MIN..MAX seconds
    METEOR_MAX_S: 8
  };

  var TAU = Math.PI * 2;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  /* star colours, as [r, g, b, weight] */
  var PALETTE = [
    [243, 241, 233, 0.58],   // warm white (matches --text-on-ink)
    [170, 200, 255, 0.26],   // cool blue-white
    [240, 166, 59, 0.16]     // amber (matches --signal)
  ];
  var COLOURS = PALETTE.map(function (c) { return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"; });

  /* depth layers: far, mid, near. speed is px/s of drift, par is parallax strength */
  var LAYERS = [
    { share: 0.55, rMin: 0.55, rMax: 1.0, speed: [7, 12],  par: 0.3 },
    { share: 0.33, rMin: 0.9,  rMax: 1.5, speed: [12, 20], par: 0.6 },
    { share: 0.12, rMin: 1.3,  rMax: 2.0, speed: [20, 34], par: 1.0 }
  ];

  var skies = [];
  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  var nextMeteorAt = 0;
  var lastFrame = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function pickColour() {
    var r = Math.random(), acc = 0;
    for (var i = 0; i < PALETTE.length; i++) {
      acc += PALETTE[i][3];
      if (r <= acc) return i;
    }
    return 0;
  }

  /* ---------- sky creation ---------- */
  function createSky(el) {
    var canvas = document.createElement("canvas");
    canvas.className = "sky";
    canvas.width = canvas.height = 1;      // real size is allocated only when the section is near the viewport
    canvas.setAttribute("aria-hidden", "true");
    var ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) return null;

    el.classList.add("has-sky");
    el.insertBefore(canvas, el.firstChild);

    return {
      el: el,
      canvas: canvas,
      ctx: ctx,
      // .projects only needs stars behind its heading, the articles below paint their own sky
      until: el.classList.contains("projects") ? el.querySelector(".project") : null,
      w: 0,
      h: 0,
      scale: 1,
      visible: false,
      dirty: true,
      stars: [],
      meteor: null
    };
  }

  /* ---------- layout + seeding ---------- */
  function measure(sky) {
    var w = sky.el.clientWidth;
    var h = sky.el.clientHeight;
    if (sky.until) {
      h = Math.max(0, Math.round(sky.until.getBoundingClientRect().top - sky.el.getBoundingClientRect().top));
    }
    return { w: w, h: h };
  }

  function layout(sky) {
    var size = measure(sky);
    if (size.w < 2 || size.h < 2) { sky.w = 0; sky.h = 0; sky.dirty = false; return false; }

    var changed = size.w !== sky.w || size.h !== sky.h || sky.canvas.width <= 1;
    if (changed) {
      // render at device resolution when the canvas is small (phones), and
      // closer to 1x when it is big. Pixel count is what costs frame time,
      // not star count.
      var scale = Math.max(0.75, Math.min(DPR, Math.sqrt(CONFIG.PIXEL_BUDGET / (size.w * size.h))));
      sky.scale = scale;
      sky.w = size.w;
      sky.h = size.h;
      sky.canvas.width = Math.round(size.w * scale);
      sky.canvas.height = Math.round(size.h * scale);
      if (sky.until) {
        sky.canvas.style.bottom = "auto";
        sky.canvas.style.height = size.h + "px";
      }
      seed(sky);
    }
    sky.dirty = false;
    return true;
  }

  function seed(sky) {
    var small = !finePointer || window.innerWidth < 700;
    var density = CONFIG.DENSITY * (small ? CONFIG.MOBILE_FACTOR : 1);
    var count = Math.min(CONFIG.MAX_STARS, Math.round(sky.w * sky.h * density));
    var stars = [];

    for (var i = 0; i < count; i++) {
      var roll = Math.random(), acc = 0, li = 0;
      for (var k = 0; k < LAYERS.length; k++) {
        acc += LAYERS[k].share;
        if (roll <= acc) { li = k; break; }
      }
      var L = LAYERS[li];
      var speed = rand(L.speed[0], L.speed[1]) * CONFIG.DRIFT;
      stars.push({
        x: Math.random() * sky.w,
        y: Math.random() * sky.h,
        r: rand(L.rMin, L.rMax),
        vx: speed,
        vy: -speed * 0.26,              // gentle rise to the right
        a: rand(0.55, 1) * CONFIG.ALPHA,
        t1: rand(1.1, 4.2) * CONFIG.TWINKLE,   // main flicker, rad/s
        t2: rand(0.4, 1.8) * CONFIG.TWINKLE,   // slower secondary flicker
        ph: Math.random() * TAU,
        c: pickColour(),
        l: li,
        par: L.par
      });
    }
    // group by colour so we change fillStyle as rarely as possible
    stars.sort(function (a, b) { return a.c - b.c; });
    sky.stars = stars;
  }

  /* ---------- drawing ---------- */
  function wrap(v, max) { return ((v % max) + max) % max; }

  function draw(sky, t, still) {
    var ctx = sky.ctx;
    var w = sky.w, h = sky.h;
    var rect = sky.el.getBoundingClientRect();
    var vh = window.innerHeight;

    ctx.setTransform(sky.scale, 0, 0, sky.scale, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // part of the canvas that is actually on screen (canvas coords)
    var yMin = -rect.top - 30;
    var yMax = vh - rect.top + 30;

    // parallax offsets
    var scrollOff = still ? 0 : (vh / 2 - (rect.top + h / 2)) * CONFIG.SCROLL_PARALLAX;
    var px = still ? 0 : -pointer.x * CONFIG.POINTER_PARALLAX;
    var py = still ? 0 : -pointer.y * CONFIG.POINTER_PARALLAX;

    var stars = sky.stars;
    var lastC = -1;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var x = wrap(s.x + s.vx * t + px * s.par, w);
      var y = wrap(s.y + s.vy * t + (py + scrollOff) * s.par, h);
      if (y < yMin || y > yMax) continue;

      var f, alpha;
      if (still) {
        f = 0.85;
        alpha = s.a * 0.85;
      } else {
        f = 0.5 + 0.5 * Math.sin(t * s.t1 + s.ph);
        var g = Math.sin(t * s.t2 * 3.1 + s.ph * 2.3);
        alpha = s.a * (0.1 + 0.9 * f * (0.7 + 0.3 * g));     // deep flicker: stars really do dim out and pop back
      }
      if (alpha < 0.03) continue;

      if (s.c !== lastC) { ctx.fillStyle = COLOURS[s.c]; lastC = s.c; }

      // soft halo on the bigger stars when they are bright
      if (s.l === 2 || (s.l === 1 && f > 0.7)) {
        ctx.globalAlpha = alpha * (s.l === 2 ? 0.16 : 0.1);
        ctx.beginPath();
        ctx.arc(x, y, s.r * 3.4, 0, TAU);
        ctx.fill();
      }

      ctx.globalAlpha = alpha;
      if (s.l === 0 && s.r < 0.9) {
        ctx.fillRect(x - s.r, y - s.r, s.r * 2, s.r * 2);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, TAU);
        ctx.fill();
      }

      // cross-shaped sparkle at the brightest moment of the bigger stars
      if (s.l >= 1 && f > (s.l === 2 ? 0.7 : 0.88)) {
        var len = s.r * (s.l === 2 ? 4.8 : 3.6) * f;
        ctx.globalAlpha = alpha * 0.65;
        ctx.fillRect(x - len, y - 0.45, len * 2, 0.9);
        ctx.fillRect(x - 0.45, y - len, 0.9, len * 2);
      }
    }
    ctx.globalAlpha = 1;

    if (sky.meteor) drawMeteor(sky, t);
  }

  /* ---------- shooting stars ---------- */
  function spawnMeteor(sky) {
    var rect = sky.el.getBoundingClientRect();
    var vh = window.innerHeight;
    var top = Math.max(0, -rect.top);
    var bottom = Math.min(sky.h, vh - rect.top);
    if (bottom - top < 120) return;

    var dir = Math.random() < 0.5 ? 1 : -1;
    var angle = rand(0.35, 0.62);                       // radians below horizontal
    var speed = rand(620, 900);
    sky.meteor = {
      x: rand(0.1, 0.9) * sky.w,
      y: top + rand(0.04, 0.5) * (bottom - top),
      vx: Math.cos(angle) * speed * dir,
      vy: Math.sin(angle) * speed,
      len: rand(150, 260),
      born: -1,
      life: rand(0.9, 1.35)
    };
  }

  function drawMeteor(sky, t) {
    var m = sky.meteor;
    if (m.born < 0) m.born = t;
    var age = t - m.born;
    var p = age / m.life;
    if (p >= 1) { sky.meteor = null; return; }

    var ctx = sky.ctx;
    var hx = m.x + m.vx * age;
    var hy = m.y + m.vy * age;
    var mag = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
    var tx = hx - (m.vx / mag) * m.len;
    var ty = hy - (m.vy / mag) * m.len;
    var env = Math.sin(p * Math.PI);                    // fade in, fade out

    var grad = ctx.createLinearGradient(hx, hy, tx, ty);
    grad.addColorStop(0, "rgba(255,250,240," + env + ")");
    grad.addColorStop(0.2, "rgba(255,214,150," + (0.6 * env) + ")");
    grad.addColorStop(1, "rgba(240,166,59,0)");

    ctx.lineCap = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // glowing head
    ctx.fillStyle = "rgb(255,248,235)";
    ctx.globalAlpha = env * 0.22;
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = env;
    ctx.beginPath();
    ctx.arc(hx, hy, 1.8, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function maybeSpawnMeteor(nowMs) {
    if (!CONFIG.METEORS || reduceMotion || nowMs < nextMeteorAt) return;
    var pool = skies.filter(function (s) { return s.visible && !s.meteor && s.w; });
    nextMeteorAt = nowMs + rand(CONFIG.METEOR_MIN_S, CONFIG.METEOR_MAX_S) * 1000;
    if (!pool.length) { nextMeteorAt = nowMs + 1000; return; }
    spawnMeteor(pool[Math.floor(Math.random() * pool.length)]);
  }

  /* ---------- lifecycle ---------- */
  function release(sky) {
    sky.visible = false;
    sky.meteor = null;
    sky.canvas.width = 1;          // free the backing store while off screen
    sky.canvas.height = 1;
    sky.w = 0;
    sky.h = 0;
  }

  function frame(nowMs) {
    requestAnimationFrame(frame);
    var t = nowMs / 1000;
    var dt = Math.min(t - lastFrame, 0.1);
    lastFrame = t;

    if (finePointer) {
      var k = Math.min(1, dt * 3);
      pointer.x += (pointer.tx - pointer.x) * k;
      pointer.y += (pointer.ty - pointer.y) * k;
    }

    maybeSpawnMeteor(nowMs);

    for (var i = 0; i < skies.length; i++) {
      var sky = skies[i];
      if (!sky.visible) continue;
      if ((sky.dirty || !sky.w) && !layout(sky)) continue;
      draw(sky, t, false);
    }
  }

  function renderStillFrames() {
    skies.forEach(function (sky) {
      if (!sky.visible) return;
      if (layout(sky)) draw(sky, 0, true);
    });
  }

  function skyFor(el) {
    return skies.filter(function (s) { return s.el === el; })[0];
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll(CONFIG.SECTIONS), function (el) {
      var sky = createSky(el);
      if (sky) skies.push(sky);
    });
    if (!skies.length) return;

    // allocate / free canvases as sections scroll near the viewport
    var io = "IntersectionObserver" in window
      ? new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            var sky = skyFor(entry.target);
            if (!sky) return;
            if (entry.isIntersecting) {
              sky.visible = true;
              sky.dirty = true;
            } else if (sky.visible) {
              release(sky);
            }
          });
          if (reduceMotion) renderStillFrames();
        }, { rootMargin: "160px 0px 160px 0px" })
      : null;

    skies.forEach(function (sky) {
      if (io) io.observe(sky.el); else { sky.visible = true; sky.dirty = true; }
    });

    // re-measure when a section changes height (fonts, wrapping, resize)
    if ("ResizeObserver" in window) {
      var ro = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          var sky = skyFor(entry.target);
          if (sky) sky.dirty = true;
        });
        if (reduceMotion) renderStillFrames();
      });
      skies.forEach(function (sky) { ro.observe(sky.el); });
    }

    if (reduceMotion) {
      renderStillFrames();
      return;
    }

    if (finePointer) {
      window.addEventListener("pointermove", function (e) {
        pointer.tx = e.clientX / window.innerWidth - 0.5;
        pointer.ty = e.clientY / window.innerHeight - 0.5;
      }, { passive: true });
    }

    nextMeteorAt = performance.now() + CONFIG.METEOR_FIRST_MS;
    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
