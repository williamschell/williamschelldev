/* Renders the homepage grid and project pages from js/projects.js.
   You shouldn't need to edit this file to add projects. */
(function () {
  const SITE = window.SITE || {};
  const PROJECTS = (window.PROJECTS || []).filter(p => !p.hidden);
  const app = document.getElementById("app");

  const ICONS = {
    linkedin: '<svg viewBox="0 0 24 24" class="icon"><path d="M5.3 8.6h3v9.9h-3zM6.8 4a1.7 1.7 0 110 3.5 1.7 1.7 0 010-3.5zM10.2 8.6h2.9V10c.4-.8 1.4-1.6 2.9-1.6 3.1 0 3.7 2 3.7 4.7v5.4h-3v-4.8c0-1.2 0-2.6-1.6-2.6s-1.9 1.2-1.9 2.5v4.9h-3z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" class="icon"><path d="M21.6 7.2a2.5 2.5 0 00-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 002.4 7.2 26 26 0 002 12a26 26 0 00.4 4.8 2.5 2.5 0 001.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 001.8-1.8A26 26 0 0022 12a26 26 0 00-.4-4.8zM10 15V9l5.2 3z"/></svg>',
    email: '<svg viewBox="0 0 24 24" class="icon"><path d="M4 6h16c.6 0 1 .4 1 1v.3l-9 6-9-6V7c0-.6.4-1 1-1zm-1 3.7l9 6 9-6V17c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1z"/></svg>',
    github: '<svg viewBox="0 0 24 24" class="icon"><path d="M12 2.5a9.5 9.5 0 00-3 18.5c.5.1.7-.2.7-.5v-1.7c-2.7.6-3.2-1.2-3.2-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.1-.2-4.4-1.1-4.4-4.7 0-1 .4-1.9 1-2.6-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.6 1a9 9 0 014.7 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.6 1 2.6 0 3.7-2.3 4.5-4.4 4.7.3.3.6.9.6 1.8v2.6c0 .3.2.6.7.5A9.5 9.5 0 0012 2.5z"/></svg>',
    itch: '<svg viewBox="0 0 24 24" class="icon"><path d="M4 4.5h16l2 4.2c0 1.4-1 2.3-2.2 2.3s-2-1-2-2.1c0 1.2-1 2.1-2.2 2.1S13.5 10 13.5 8.9c0 1.1-.8 2.1-1.5 2.1s-1.5-1-1.5-2.1c0 1.1-.9 2.1-2.1 2.1S6.2 10 6.2 8.9c0 1.2-.8 2.1-2 2.1S2 10.1 2 8.7zM3.6 12.3c.4.2.8.2 1.2.2 1 0 1.7-.4 2.3-1 .6.6 1.4 1 2.2 1 .9 0 1.6-.4 2.2-1h1c.6.6 1.3 1 2.2 1 .8 0 1.6-.4 2.2-1 .6.6 1.3 1 2.3 1 .4 0 .8 0 1.2-.2.4 3 .3 5.5-.3 7-1 1.3-5 1.4-8.1 1.4s-7.1-.1-8.1-1.4c-.6-1.5-.7-4-.3-7zm6.4 2.2L8.3 16h1.4v2h4.6v-2h1.4L14 14.5z"/></svg>',
    link: '<svg viewBox="0 0 24 24" class="icon"><path d="M10.6 13.4a1 1 0 001.4 1.4l4.9-4.9a3.5 3.5 0 00-5-5l-2 2a1 1 0 001.4 1.4l2-2a1.5 1.5 0 012.2 2.2zm2.8-2.8a1 1 0 00-1.4-1.4l-4.9 4.9a3.5 3.5 0 005 5l2-2a1 1 0 00-1.4-1.4l-2 2a1.5 1.5 0 01-2.2-2.2z"/></svg>'
  };

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Deterministic placeholder colors so empty covers still look intentional.
  function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function placeholder(p, alt) {
    const h = (hue(p.slug || p.title) + (alt ? 40 : 0)) % 360;
    return `<div class="cover-ph" style="background:linear-gradient(135deg,hsl(${h} 32% ${alt ? 30 : 86}%),hsl(${(h + 30) % 360} 40% ${alt ? 18 : 72}%));color:${alt ? "#fff" : "hsl(" + h + " 30% 25%)"}"><span>${esc(p.title)}</span></div>`;
  }
  const img = (src, cls) => `<img class="${cls || ""}" src="${esc(src)}" alt="" loading="lazy">`;

  /* ---------- chrome (header / footer) ---------- */
  function renderChrome() {
    document.querySelector(".logo").textContent = SITE.name || "";
    document.querySelector(".footer-text").textContent = SITE.email || "";
    const cv = document.querySelector(".nav-cv");
    if (SITE.cv) cv.href = SITE.cv; else cv.remove();
    const socials = (SITE.socials || []).map(s => {
      const ext = !/^mailto:/.test(s.url);
      return `<li><a href="${esc(s.url)}" ${ext ? 'target="_blank" rel="noopener"' : ""} aria-label="${esc(s.label || s.type)}" title="${esc(s.label || s.type)}">${ICONS[s.type] || ICONS.link}</a></li>`;
    }).join("");
    document.querySelectorAll(".social").forEach(ul => ul.innerHTML = socials);

    const burger = document.querySelector(".hamburger");
    burger.addEventListener("click", () => {
      const open = document.body.classList.toggle("nav-open");
      burger.setAttribute("aria-expanded", open);
    });
    document.querySelectorAll("[data-home]").forEach(a => a.addEventListener("click", e => {
      e.preventDefault();
      if (location.hash) location.hash = ""; else render();
      document.body.classList.remove("nav-open");
    }));
  }

  /* ---------- homepage ---------- */
  function renderHome() {
    document.title = SITE.name || "Portfolio";
    const covers = PROJECTS.map(p => {
      const normal = p.cover ? img(p.cover) : placeholder(p, false);
      const hover = p.hoverCover ? img(p.hoverCover) : (p.cover ? "" : placeholder(p, true));
      return `
      <a class="project-cover${hover ? " has-rollover" : ""}" href="#${esc(p.slug)}">
        <div class="cover-image">
          <div class="cover cover-normal">${normal}</div>
          ${hover ? `<div class="cover cover-rollover">${hover}</div>` : ""}
        </div>
        <div class="details">
          <div class="title">${esc(p.title)}</div>
          ${p.teamSize ? `<div class="meta">Team Size: ${esc(p.teamSize)}</div>` : ""}
          ${p.roles ? `<div class="meta">Roles: ${esc(p.roles)}</div>` : ""}
          ${p.dates ? `<div class="meta">${esc(p.dates)}</div>` : ""}
        </div>
      </a>`;
    }).join("");

    app.innerHTML = `
      <section class="masthead">
        <h1>${esc(SITE.aboutTitle || "About Me")}</h1>
        <p>${esc(SITE.about || "")}</p>
      </section>
      <section class="project-covers">${covers}</section>`;
  }

  /* ---------- project page ---------- */
  function block(b) {
    switch (b.type) {
      case "heading": return `<h2 class="block-heading">${esc(b.text)}</h2>`;
      case "text": return `<div class="block-text">${String(b.text || "").split(/\n\s*\n/).map(t => `<p>${esc(t).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
      case "image": return `<figure class="block-image">${img(b.src)}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
      case "gallery": return `<div class="block-gallery">${(b.images || []).map(s => img(s)).join("")}</div>`;
      case "video":
        if (b.youtube) return `<div class="block-video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(b.youtube)}" title="Video" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
        return `<div class="block-video file"><video src="${esc(b.src)}" controls playsinline preload="metadata"></video></div>`;
      case "embed": return `<div class="block-embed"><iframe src="${esc(b.src)}" style="height:${parseInt(b.height) || 500}px" loading="lazy" allowfullscreen></iframe></div>`;
      default: return "";
    }
  }

  function renderProject(p) {
    document.title = `${p.title} — ${SITE.name || ""}`;
    const i = PROJECTS.indexOf(p);
    const prev = PROJECTS[(i - 1 + PROJECTS.length) % PROJECTS.length];
    const next = PROJECTS[(i + 1) % PROJECTS.length];
    const meta = [
      p.teamSize && `Team Size: ${esc(p.teamSize)}`,
      p.roles && `Roles: ${esc(p.roles)}`,
      p.engine && `Engine: ${esc(p.engine)}`,
      p.dates && esc(p.dates)
    ].filter(Boolean).map(m => `<div>${m}</div>`).join("");
    const links = (p.links || []).map(l => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("");

    app.innerHTML = `
      <article class="project">
        <header class="project-header">
          <h1>${esc(p.title)}</h1>
          <div class="project-meta">${meta}</div>
          ${links ? `<div class="project-links">${links}</div>` : ""}
        </header>
        <div class="project-blocks">${(p.blocks || []).map(block).join("")}</div>
        ${PROJECTS.length > 1 ? `
        <nav class="project-nav">
          <a href="#${esc(prev.slug)}">&larr; ${esc(prev.title)}</a>
          <a href="#" data-home-inline>All Projects</a>
          <a href="#${esc(next.slug)}">${esc(next.title)} &rarr;</a>
        </nav>` : ""}
      </article>`;
    app.querySelector("[data-home-inline]")?.addEventListener("click", e => { e.preventDefault(); location.hash = ""; });
  }

  function render() {
    const slug = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const p = slug && PROJECTS.find(x => x.slug === slug);
    if (p) renderProject(p); else renderHome();
    document.querySelector(".nav-games").classList.toggle("active", !p);
    window.scrollTo(0, 0);
  }

  renderChrome();
  render();
  window.addEventListener("hashchange", render);
})();
