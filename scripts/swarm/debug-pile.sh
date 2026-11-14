#!/usr/bin/env bash
# Debug ciblé : pile elementsFromPoint sur un nom d'équipe.
set -u
cd /home/z/my-project
DB='postgresql://neondb_owner:npg_D1OymYeRSnr2@ep-round-cloud-ae3m3lka-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require'
pkill -f "standalone/server.js" 2>/dev/null; pkill -f agent-browser 2>/dev/null; sleep 1
DATABASE_URL="$DB" NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 nohup bun .next/standalone/server.js > /tmp/prodserver.log 2>&1 &
for i in $(seq 1 30); do code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:3000 2>/dev/null || echo 000); [ "$code" = "200" ] && break; sleep 1; done
echo "Serveur $code"
S=dbg
agent-browser open http://127.0.0.1:3000 --session $S >/dev/null 2>&1
agent-browser set viewport 390 844 --session $S >/dev/null 2>&1
sleep 9
agent-browser eval "document.querySelector('button[aria-label*="Combinateur"]')?.click(); 1" --session $S >/dev/null 2>&1
sleep 2
agent-browser eval "(() => { [...document.querySelectorAll('button')].find(b => /analyser/i.test(b.innerText))?.click(); return 1; })()" --session $S >/dev/null 2>&1
sleep 22
agent-browser eval "
(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node; const out = [];
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim();
    if (/^(ESTONIA|BULGARIA)$/i.test(t)) {
      const el = node.parentElement;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + Math.min(r.height / 2, 14));
      const stack = (document.elementsFromPoint(cx, cy) || []).slice(0, 6).map((e) => {
        const c = getComputedStyle(e);
        return e.tagName + '.' + String(e.className).split(' ').slice(0, 3).join('.') +
          ' bg=' + c.backgroundColor + ' grad=' + (c.backgroundImage || 'none').slice(0, 60);
      });
      out.push({
        texte: t, couleur: cs.color, fs: cs.fontSize, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        point: [cx, cy], top: stack[0] ? stack[0].tagName + '.' + String(stack[0].className).split(' ').slice(0,2).join('.') : 'rien',
      });
    }
  }
  return JSON.stringify(out.slice(0, 6), null, 1);
})()" --session $S 2>/dev/null | head -60
agent-browser close --session $S >/dev/null 2>&1
pkill -f "standalone/server.js" 2>/dev/null; pkill -f agent-browser 2>/dev/null
