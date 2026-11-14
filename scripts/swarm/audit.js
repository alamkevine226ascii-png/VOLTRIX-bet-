/**
 * Audit mécanique de design/responsivité — injecté via agent-browser eval.
 * v4 : l'app navigue par PILE d'écrans (l'accueil reste monté derrière
 * le combinateur) — un texte n'est audité que s'il est réellement
 * visible : le premier élément sous son centre (elementsFromPoint)
 * doit lui appartenir. Trois cas :
 *   visible   → audits police/contraste normaux ;
 *   floating  → couvert par une barre flottante semi-transparente
 *               (pastille de navigation en bas, en-tête dégradé en
 *               haut) → catégorie dédiée « défile sous les barres » ;
 *   covered   → masqué par un autre écran → ignoré.
 * Couleurs : rgb/rgba (virgules ou espaces), hsl/hsla, hex ; les
 * dégradés comptent le dernier stop opaque comme fond.
 */
(() => {
  const de = document.documentElement;
  const res = {
    url: location.pathname,
    vw: innerWidth,
    vh: innerHeight,
    overflowX: de.scrollWidth > de.clientWidth + 1,
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    issues: { overflowEls: [], smallTaps: [], smallFonts: [], lowContrast: [], brokenImgs: [], underFloating: [] },
    counts: { buttons: 0, texts: 0, imgs: 0, sections: 0 },
  };

  const inHScrollContainer = (el) => {
    let e = el.parentElement;
    while (e && e !== document.body) {
      const ox = getComputedStyle(e).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
      e = e.parentElement;
    }
    return false;
  };

  const parse = (s) => {
    if (!s || typeof s !== "string") return null;
    let m = s.match(/rgba?\(\s*([\d.]+)[, ]\s*([\d.]+)[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+))?\s*\)/);
    if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
    m = s.match(/hsla?\(\s*([\d.]+)(?:deg)?[, ]\s*([\d.]+)%[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+))?\s*\)/);
    if (m) {
      const h = +m[1] % 360, sa = +m[2] / 100, l = +m[3] / 100;
      const c = (1 - Math.abs(2 * l - 1)) * sa;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const mm = l - c / 2;
      let r = 0, g = 0, b = 0;
      if (h < 60) [r, g, b] = [c, x, 0];
      else if (h < 120) [r, g, b] = [x, c, 0];
      else if (h < 180) [r, g, b] = [0, c, x];
      else if (h < 240) [r, g, b] = [0, x, c];
      else if (h < 300) [r, g, b] = [x, 0, c];
      else [r, g, b] = [c, 0, x];
      return [Math.round((r + mm) * 255), Math.round((g + mm) * 255), Math.round((b + mm) * 255), m[4] == null ? 1 : +m[4]];
    }
    m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    return null;
  };

  const bgFromChain = (chain) => {
    for (const e of chain) {
      if (!e || e.nodeType !== 1) continue;
      const cs = getComputedStyle(e);
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0.5) return [c[0], c[1], c[2]];
      const g = cs.backgroundImage || "";
      if (g && g !== "none" && g.includes("gradient")) {
        const stops = [...g.matchAll(/(rgba?|hsla?)\([^)]+\)/g)].map((m) => parse(m[0])).filter(Boolean);
        const opaques = stops.filter((s) => s && s[3] > 0.5);
        if (opaques.length > 0) {
          const s = opaques[opaques.length - 1];
          return [s[0], s[1], s[2]];
        }
      }
    }
    return null;
  };

  const ancestorsOf = (el) => {
    const a = [];
    let e = el;
    while (e) { a.push(e); e = e.parentElement; }
    return a;
  };

  /** 'visible' | 'floating' | 'covered' pour un rect donné. */
  const visibilityAt = (el, r) => {
    const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, 14)));
    let stack = [];
    try { stack = document.elementsFromPoint(cx, cy) || []; } catch (e) { stack = []; }
    const top = stack[0];
    if (!top || top === el || top.contains(el) || el.contains(top)) return { state: "visible", stack, cx, cy };
    /* couvert par une barre flottante semi-transparente ? */
    if (r.top > innerHeight - 80 || r.top < 92) return { state: "floating", stack, cx, cy };
    return { state: "covered", stack, cx, cy };
  };

  /* --- éléments qui débordent horizontalement --- */
  for (const el of document.querySelectorAll("body *")) {
    if (res.issues.overflowEls.length >= 12) break;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
    if (cs.position === "fixed") continue;
    if (inHScrollContainer(el)) continue;
    if (r.right > de.clientWidth + 3 || r.left < -3) {
      res.issues.overflowEls.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 50),
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }
  }

  /* --- cibles tactiles trop petites (visibles uniquement) --- */
  const tappables = document.querySelectorAll("button, a, [role=button]");
  res.counts.buttons = tappables.length;
  for (const b of tappables) {
    if (res.issues.smallTaps.length >= 15) break;
    const r = b.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.top >= innerHeight - 2 || r.bottom <= 2) continue;
    if (r.width >= 40 && r.height >= 40) continue;
    if (visibilityAt(b, r).state === "covered") continue;
    res.issues.smallTaps.push({
      label: (b.getAttribute("aria-label") || b.innerText || "?").trim().slice(0, 28),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }

  /* --- textes : polices fines, contrastes, sous-barres --- */
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };

  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META"]);
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim();
    if (!t || t.length < 2) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    if (SKIP.has(el.tagName) || el.closest("script, style, noscript")) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    /* hors du viewport visible : sous le pli (leur point serait
     * bloqué au bord bas et audité contre la pastille) ou au-dessus */
    if (r.top >= innerHeight - 2 || r.bottom <= 2) continue;
    const vis = visibilityAt(el, r);
    if (vis.state === "covered") continue;
    res.counts.texts++;
    const fs = parseFloat(cs.fontSize);
    if (vis.state === "floating") {
      if (res.issues.underFloating.length < 15) {
        res.issues.underFloating.push({ t: t.slice(0, 22), fs, y: Math.round(r.top) });
      }
      continue;
    }
    if (fs < 9 && res.issues.smallFonts.length < 15) {
      res.issues.smallFonts.push({ t: t.slice(0, 22), fs: Math.round(fs * 10) / 10 });
    }
    if (res.issues.lowContrast.length < 15 && t.length >= 3) {
      const fg = parse(cs.color);
      if (fg) {
        const bg = bgFromChain(vis.stack) || bgFromChain(ancestorsOf(el)) || [20, 20, 20];
        const L1 = lum(fg.slice(0, 3));
        const L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const bold = parseInt(cs.fontWeight) >= 700;
        const large = fs >= 18.66 || (fs >= 14 && bold);
        const min = large ? 3 : 4.5;
        if (ratio < min) {
          res.issues.lowContrast.push({
            t: t.slice(0, 22),
            ratio: Math.round(ratio * 100) / 100,
            fs,
            y: Math.round(r.top),
          });
        }
      }
    }
  }

  /* --- images cassées --- */
  res.counts.imgs = document.images.length;
  for (const i of document.images) {
    if (res.issues.brokenImgs.length >= 8) break;
    if (i.complete && i.naturalWidth === 0 && i.src) {
      res.issues.brokenImgs.push(i.src.slice(-40));
    }
  }

  res.counts.sections = document.querySelectorAll("section[aria-label]").length;
  return JSON.stringify(res);
})()
