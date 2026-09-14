window.CHAPTERS=[{"id": "about", "group": null}, {"id": "rollout", "group": "grp:rollout"}, {"id": "roles", "group": "grp:roles"}, {"id": "role-operator", "group": "grp:roles"}, {"id": "role-ceo", "group": "grp:roles"}, {"id": "role-supervisor", "group": "grp:roles"}, {"id": "role-agent", "group": "grp:roles"}, {"id": "role-courier", "group": "grp:roles"}, {"id": "role-merch", "group": "grp:roles"}, {"id": "money", "group": "grp:money"}, {"id": "faq", "group": "grp:help"}, {"id": "glossary", "group": "grp:help"}];window.TITLES={"ru": {"doc": "Warehouse Pro — руководство дистрибьютора", "grp:rollout": "Внедрение", "grp:roles": "Рабочий день роли", "grp:money": "Как система считает", "grp:help": "Помощь", "about": "Как пользоваться этой книгой", "rollout": "Часть 1. Внедрение за пять дней", "roles": "Часть 2. Рабочий день каждой роли", "role-operator": "Оператор офиса и склад", "role-ceo": "Директор", "role-supervisor": "Супервайзер", "role-agent": "Торговый агент (телефон)", "role-courier": "Курьер (телефон)", "role-merch": "Мерчандайзер (телефон)", "money": "Часть 3. Деньги и остаток — как система считает", "faq": "Часть 4. Что делать, если", "glossary": "Словарь терминов"}, "uz": {"doc": "Warehouse Pro — distribyutor qo'llanmasi", "grp:rollout": "Joriy etish", "grp:roles": "Rolning ish kuni", "grp:money": "Tizim qanday hisoblaydi", "grp:help": "Yordam", "about": "Bu kitobdan qanday foydalanish", "rollout": "1-qism. Besh kunda joriy etish", "roles": "2-qism. Har bir rolning ish kuni", "role-operator": "Ofis operatori va ombor", "role-ceo": "Direktor", "role-supervisor": "Supervayzer", "role-agent": "Savdo agenti (telefon)", "role-courier": "Kuryer (telefon)", "role-merch": "Merchandayzer (telefon)", "money": "3-qism. Pul va qoldiq — tizim qanday hisoblaydi", "faq": "4-qism. Agar … bo'lsa, nima qilish kerak", "glossary": "Atamalar lug'ati"}};window.LBL={"ru": {"sections": "Разделы", "search": "Поиск по руководству", "iam": "Я —", "print": "Печать / PDF", "prev": "Назад", "next": "Дальше", "of": "из", "nothing": "Ничего не найдено", "menu": "Меню", "toTop": "Наверх", "doc": "руководство"}, "uz": {"sections": "Bo'limlar", "search": "Qo'llanma bo'yicha qidiruv", "iam": "Men —", "print": "Chop etish / PDF", "prev": "Orqaga", "next": "Keyingi", "of": "/", "nothing": "Hech narsa topilmadi", "menu": "Menyu", "toTop": "Yuqoriga", "doc": "qo'llanma"}};

(function () {
  var html = document.documentElement;
  var CH = window.CHAPTERS;            // [{id, group}]
  var TITLES = window.TITLES;          // {lang: {id: title, "grp:…": title, doc: title}}
  var LBL = window.LBL;
  var state = { lang: "ru", id: CH[0].id };
  try { state.lang = localStorage.getItem("wp-manual-lang") || state.lang; } catch (e) {}

  function known(id) { return CH.some(function (c) { return c.id === id; }); }
  function parseHash() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!h) return null;
    var parts = h.split("/"), lang = null, id = parts[0], sub = parts[1] || null;
    if (parts[0] === "ru" || parts[0] === "uz") { lang = parts[0]; id = parts[1] || CH[0].id; sub = parts[2] || null; }
    if (!known(id)) {
      // Ссылка прямо на подраздел: role-operator-2 → глава role-operator
      var m = id.match(/^(.*)-\d+$/);
      if (m && known(m[1])) { sub = id; id = m[1]; } else id = CH[0].id;
    }
    return { lang: lang, id: id, sub: sub };
  }
  function idx() { for (var i = 0; i < CH.length; i++) if (CH[i].id === state.id) return i; return 0; }

  var side = document.querySelector(".side"), backdrop = document.querySelector(".backdrop");
  function closeSide() { side.classList.remove("open"); backdrop.classList.remove("open"); }

  function render(sub, push) {
    html.setAttribute("data-ui", state.lang);
    html.lang = state.lang;
    try { localStorage.setItem("wp-manual-lang", state.lang); } catch (e) {}
    var L = LBL[state.lang], i = idx();
    document.querySelectorAll("section.chapter").forEach(function (s) { s.classList.toggle("on", s.dataset.id === state.id); });
    document.querySelectorAll(".side a").forEach(function (a) {
      var on = a.dataset.id === state.id && ((a.dataset.sub || "") === (sub || ""));
      a.classList.toggle("on", on);
      if (a.classList.contains("sub")) a.classList.toggle("hide", a.dataset.id !== state.id);
    });
    document.querySelectorAll(".chips button").forEach(function (b) { b.classList.toggle("on", b.dataset.id === state.id); });
    document.querySelectorAll(".lang button").forEach(function (b) { b.classList.toggle("on", b.dataset.lang === state.lang); });
    var input = document.querySelector(".search input");
    input.placeholder = input.getAttribute("data-ph-" + state.lang); input.setAttribute("aria-label", input.placeholder);
    var grp = CH[i].group ? (TITLES[state.lang][CH[i].group] + " › ") : "";
    document.querySelector(".crumb .where").textContent = grp + TITLES[state.lang][state.id];
    document.querySelector(".crumb .pos").textContent = (i + 1) + " " + L.of + " " + CH.length;
    document.querySelectorAll("section.chapter.on .pager").forEach(function (p) {
      var prev = p.querySelector(".prev"), next = p.querySelector(".next");
      prev.disabled = i === 0; next.disabled = i === CH.length - 1;
      if (i > 0) { prev.dataset.id = CH[i - 1].id; prev.innerHTML = "← " + L.prev + "<small>" + TITLES[state.lang][CH[i - 1].id] + "</small>"; }
      if (i < CH.length - 1) { next.dataset.id = CH[i + 1].id; next.innerHTML = L.next + " →<small>" + TITLES[state.lang][CH[i + 1].id] + "</small>"; }
    });
    document.title = TITLES[state.lang][state.id] + " — " + TITLES[state.lang].doc;
    var hash = "#" + state.lang + "/" + state.id + (sub ? "/" + sub : "");
    if (push && location.hash !== hash) history.pushState(null, "", hash);
    closeSide();
    if (sub) {
      var el = document.querySelector("section.chapter.on [id='" + sub + "']");
      if (el) { el.scrollIntoView({ block: "start" }); return; }
    }
    window.scrollTo({ top: 0 });
  }
  function go(id, sub, lang) { if (lang) state.lang = lang; state.id = id; render(sub || null, true); }

  document.querySelector(".menu-btn").addEventListener("click", function () { side.classList.toggle("open"); backdrop.classList.toggle("open"); });
  backdrop.addEventListener("click", closeSide);

  // Снимок во весь экран
  var lb = document.querySelector(".lightbox");
  function openLightbox(img) { lb.querySelector("img").src = img.src; lb.querySelector(".cap").textContent = img.alt; lb.classList.add("open"); }
  function closeLightbox() { lb.classList.remove("open"); }

  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-go]");
    if (a) { e.preventDefault(); if (!a.disabled) go(a.dataset.id, a.dataset.sub || null, a.dataset.lang || null); return; }
    var img = e.target.closest("figure img");
    if (img) { openLightbox(img); return; }
    if (e.target.closest(".lightbox")) closeLightbox();
  });
  document.querySelectorAll(".lang button").forEach(function (b) { b.addEventListener("click", function () { state.lang = b.dataset.lang; render(null, true); }); });
  document.querySelector(".print-btn").addEventListener("click", function () { window.print(); });
  window.addEventListener("popstate", function () { var p = parseHash(); if (!p) return; if (p.lang) state.lang = p.lang; state.id = p.id; render(p.sub, false); });

  // Клавиши: ← → между разделами, / — в поиск, Esc — закрыть
  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") { if (e.key === "Escape") { e.target.blur(); closeResults(); } return; }
    if (e.key === "ArrowRight" && idx() < CH.length - 1) go(CH[idx() + 1].id);
    else if (e.key === "ArrowLeft" && idx() > 0) go(CH[idx() - 1].id);
    else if (e.key === "/") { e.preventDefault(); document.querySelector(".search input").focus(); }
    else if (e.key === "Escape") { closeLightbox(); closeSide(); }
  });

  // Поиск по тексту текущего языка: заголовки, абзацы, шаги, таблицы, подписи
  var input = document.querySelector(".search input"), results = document.querySelector(".results");
  function closeResults() { results.classList.remove("open"); }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function search(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) { closeResults(); return; }
    var out = [], n = 0, re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    document.querySelectorAll("[data-lang='" + state.lang + "'] section.chapter").forEach(function (sec) {
      var chId = sec.dataset.id, head = TITLES[state.lang][chId], sub = null, subTitle = null;
      sec.querySelectorAll("h3, p, li, td, figcaption").forEach(function (el) {
        if (el.tagName === "H3") { sub = el.id; subTitle = el.textContent; }
        var text = el.textContent, pos = text.toLowerCase().indexOf(q);
        if (pos < 0 || n >= 40) return;
        n++;
        var from = Math.max(0, pos - 60), to = Math.min(text.length, pos + q.length + 90);
        var snip = (from ? "…" : "") + text.slice(from, to) + (to < text.length ? "…" : "");
        var hl = esc(snip).replace(re, function (m) { return "<mark>" + m + "</mark>"; });
        out.push("<a href='#' data-go data-id='" + chId + "' data-sub='" + (sub || "") + "'><span class='where'>" + esc(head) + (subTitle ? " › " + esc(subTitle) : "") + "</span>" + hl + "</a>");
      });
    });
    results.innerHTML = out.length ? out.join("") : "<div class='none'>" + LBL[state.lang].nothing + "</div>";
    results.classList.add("open");
  }
  input.addEventListener("input", function () { search(input.value); });
  input.addEventListener("focus", function () { if (input.value.trim().length >= 2) search(input.value); });
  document.addEventListener("click", function (e) { if (!e.target.closest(".search")) closeResults(); });
  results.addEventListener("click", function () { closeResults(); input.blur(); });

  var toTop = document.querySelector(".to-top");
  window.addEventListener("scroll", function () { toTop.classList.toggle("show", window.scrollY > 600); }, { passive: true });
  toTop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });

  var p = parseHash();
  if (p) { if (p.lang) state.lang = p.lang; state.id = p.id; }
  render(p ? p.sub : null, false);
})();
