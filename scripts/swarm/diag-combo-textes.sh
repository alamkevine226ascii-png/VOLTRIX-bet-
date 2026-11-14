#!/usr/bin/env bash
# Diagnostic : d'où viennent les entrées lowContrast ratio=1 du
# combinateur (textes d'un écran caché ?) — capture la pile pour
# chaque entrée signalée par l'audit.
set -u
cd /home/z/my-project
DB='postgresql://neondb_owner:npg_D1OymYeRSnr2@ep-round-cloud-ae3m3lka-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require'
pkill -f "standalone/server.js" 2>/dev/null; pkill -f agent-browser 2>/dev/null; sleep 1
DATABASE_URL="$DB" NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 nohup bun .next/standalone/server.js > /tmp/prodserver.log 2>&1 &
for i in $(seq 1 30); do code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:3000 2>/dev/null || echo 000); [ "$code" = "200" ] && break; sleep 1; done
echo "Serveur $code"
S=diag
agent-browser open http://127.0.0.1:3000 --session $S >/dev/null 2>&1
agent-browser set viewport 390 844 --session $S >/dev/null 2>&1
sleep 9
agent-browser eval "document.querySelector('button[aria-label*=\"Combinateur\"]')?.click(); 1" --session $S >/dev/null 2>&1
sleep 2
agent-browser eval "(() => { [...document.querySelectorAll('button')].find(b => /analyser/i.test(b.innerText))?.click(); return 1; })()" --session $S >/dev/null 2>&1
sleep 25
agent-browser eval "
(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE']);
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim();
    if (!t || t.length < 3) continue;
    const el = node.parentElement;
    if (!el || SKIP.has(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) continue;
    const cx = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2));
    const cy = Math.max(0, Math.min(innerHeight - 1, r.top + Math.min(r.height / 2, 14)));
    const stack = document.elementsFromPoint(cx, cy) || [];
    const top = stack[0];
    const related = !top || top === el || top.contains(el) || el.contains(top);
    /* n'intéresse que les textes noir/franc sur les écrans non-combo */
    if (/^(ESTONIA|BULGARIA|MOLDOVA|LITHUANIA|FAROE)/i.test(t) || /^\d{2}:\d{2}$/.test(t)) {
      out.push({
        t: t.slice(0, 14), fs: cs.fontSize, color: cs.color,
        y: Math.round(r.top), related,
        top: top ? top.tagName + '.' + String(top.className).split(' ').slice(0, 2).join('.').slice(0, 40) : 'null',
        chemin: (() => {
          let e = el, hops = [];
          while (e && hops.length < 5) {
            hops.push(e.tagName + (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label').slice(0, 18) + ']' : ''));
            e = e.parentElement;
          }
          return hops.join(' > ').slice(0, 110);
        })(),
      });
    }
  }
  return JSON.stringify(out.slice(0, 10), null, 1);
})()" --session $S 2>/dev/null | python3 -c "import sys,json; print(json.dumps(json.loads(json.loads(sys.stdin.read())), ensure_ascii=False, indent=1))" 2>/dev/null || echo "(eval vide — analyse peut-être non terminée)"
agent-browser close --session $S >/dev/null 2>&1
pkill -f "standalone/server.js" 2>/dev/null; pkill -f agent-browser 2>/dev/null
