(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- back to top ---------- */
  var navMark = document.querySelector(".nav-mark");
  if (navMark) {
    navMark.addEventListener("click", function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  /* ---------- mobile nav ---------- */
  var toggle = document.getElementById("navToggle");
  var mobile = document.getElementById("navMobile");
  if (toggle && mobile) {
    toggle.addEventListener("click", function () {
      var open = mobile.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    mobile.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        mobile.classList.remove("open");
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------- generic reveal-on-scroll ---------- */
  var revealTargets = document.querySelectorAll(".reveal, .hero-h1");

  function activate(el) {
    if (el.classList.contains("in-view")) return;
    el.classList.add("in-view");

    // gauge fills (circular)
    el.querySelectorAll(".gauge-fill[data-offset]").forEach(function (g) {
      var offset = g.getAttribute("data-offset");
      requestAnimationFrame(function () {
        g.style.strokeDashoffset = offset;
      });
    });
    if (el.matches && el.matches(".gauge-fill[data-offset]")) {
      var off = el.getAttribute("data-offset");
      requestAnimationFrame(function () { el.style.strokeDashoffset = off; });
    }

    // radial arc gauges
    el.querySelectorAll(".gauge-fill-arc[data-offset]").forEach(function (g) {
      var offset = g.getAttribute("data-offset");
      requestAnimationFrame(function () { g.style.strokeDashoffset = offset; });
    });

    // priority bars
    el.querySelectorAll(".bar-fill[data-w]").forEach(function (b) {
      var w = b.getAttribute("data-w");
      requestAnimationFrame(function () { b.style.width = w + "%"; });
    });

    // count-up numbers
    el.querySelectorAll(".bento-num[data-count]").forEach(function (n) {
      animateCount(n);
    });
  }

  if (reduceMotion) {
    revealTargets.forEach(activate);
  } else if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            activate(entry.target);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" }
    );
    revealTargets.forEach(function (el) { io.observe(el); });
  } else {
    revealTargets.forEach(activate);
  }

  /* ---------- count-up ---------- */
  function animateCount(node) {
    var target = parseFloat(node.getAttribute("data-count"), 10);
    var prefix = node.getAttribute("data-prefix") || "";
    var suffix = node.getAttribute("data-suffix") || "";
    var format = node.getAttribute("data-format");
    var duration = 1400;
    var start = null;

    function frame(ts) {
      if (start === null) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var value = Math.round(target * eased);
      node.textContent = prefix + formatNumber(value, format) + suffix;
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        node.textContent = prefix + formatNumber(target, format) + suffix;
      }
    }
    requestAnimationFrame(frame);
  }

  function formatNumber(value, format) {
    if (format === "comma") {
      return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    return value.toString();
  }

  /* ---------- active nav link on scroll ---------- */
  var navLinks = document.querySelectorAll(".nav-links a[href^='#']");
  var sections = Array.prototype.map.call(navLinks, function (a) {
    var id = a.getAttribute("href").slice(1);
    return document.getElementById(id);
  }).filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    var navIO = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var id = entry.target.id;
          var link = document.querySelector('.nav-links a[href="#' + id + '"]');
          if (!link) return;
          if (entry.isIntersecting) {
            navLinks.forEach(function (l) { l.style.color = ""; });
            link.style.color = "var(--ink)";
          }
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    sections.forEach(function (s) { navIO.observe(s); });
  }
  /* ---------- scroll progress bar + hero scroll fade ---------- */
  var progressBar = document.getElementById("scrollProgressBar");
  var heroSection = document.querySelector(".hero");
  var heroFadeTargets = heroSection
    ? heroSection.querySelectorAll(".hero-inner, .hero-gauge-wrap")
    : [];
  var doHeroFade = heroSection && heroFadeTargets.length && !reduceMotion;

  if (progressBar || doHeroFade) {
    var scrollTicking = false;

    var updateProgressBar = function () {
      if (!progressBar) return;
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      progressBar.style.width = Math.max(0, Math.min(100, pct)) + "%";
    };

    // Same curve as the reference site's Hero: scrollYProgress runs 0 to 1 as
    // the hero scrolls from "top at viewport top" to "bottom at viewport top".
    // opacity: [0, 0.8] -> [1, 0], y: [0, 1] -> [0, 180]
    var updateHeroFade = function () {
      if (!doHeroFade) return;
      var rect = heroSection.getBoundingClientRect();
      var progress = rect.height > 0 ? -rect.top / rect.height : 0;
      progress = Math.max(0, Math.min(1, progress));

      if (progress <= 0) {
        // at rest, hand control back to CSS so the on-load reveal animation
        // (e.g. hero-gauge-wrap's own fade/slide in) isn't fought over
        heroFadeTargets.forEach(function (el) {
          el.style.transition = "";
          el.style.opacity = "";
          el.style.transform = "";
        });
        return;
      }

      var opacityProgress = Math.max(0, Math.min(1, progress / 0.8));
      var opacity = 1 - opacityProgress;
      var y = progress * 180;

      heroFadeTargets.forEach(function (el) {
        el.style.transition = "none";
        el.style.opacity = String(opacity);
        el.style.transform = "translateY(" + y + "px)";
      });
    };

    var onScroll = function () {
      if (!scrollTicking) {
        scrollTicking = true;
        requestAnimationFrame(function () {
          updateProgressBar();
          updateHeroFade();
          scrollTicking = false;
        });
      }
    };

    updateProgressBar();
    updateHeroFade();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  }
})();
