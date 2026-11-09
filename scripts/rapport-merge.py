# -*- coding: utf-8 -*-
"""Fusion couverture + corps → PDF final normalisé A4."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

def normalize(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page

writer = PdfWriter()
cover = PdfReader('/tmp/rapport-cover.pdf').pages[0]
writer.add_page(normalize(cover))
for p in PdfReader('/tmp/rapport-body.pdf').pages:
    writer.add_page(normalize(p))

writer.add_metadata({
    '/Title': 'VOLTRIX — Rapport technique et test utilisateur',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': "Fonctionnement de l'application, formules des pronostics football et MMA, "
                "test utilisateur complet et points à revoir",
})
OUT = '/home/z/my-project/download/Rapport_VOLTRIX_fonctionnement_pronostics_test.pdf'
with open(OUT, 'wb') as f:
    writer.write(f)
print('PDF final :', OUT, '|', len(writer.pages), 'pages')
