#!/usr/bin/env python3
# ============================================================
# Fusion couverture + corps → PDF final unique (Phase 6, étape 3/3)
# download/VOLTRIX_blind_test_JUNE_JULY_AUGUST_2026.pdf
# Normalisation A4 de chaque page + métadonnées.
# ============================================================
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

COVER = '/home/z/my-project/scripts/blindtest/data/cover.pdf'
BODY = '/home/z/my-project/scripts/blindtest/data/rapport-body.pdf'
OUT = '/home/z/my-project/download/VOLTRIX_blind_test_JUNE_JULY_AUGUST_2026.pdf'


def normalize_page_to_a4(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
        page.mediabox.lower_left = (0, 0)
        page.mediabox.upper_right = (A4_W, A4_H)
    return page


writer = PdfWriter()
cover_page = PdfReader(COVER).pages[0]
writer.add_page(normalize_page_to_a4(cover_page))
for page in PdfReader(BODY).pages:
    writer.add_page(normalize_page_to_a4(page))
writer.add_metadata({
    '/Title': 'VOLTRIX_blind_test_JUNE_JULY_AUGUST_2026',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': "Rapport d'audit — simulation aveugle de validation du modèle VOLTRIX (juin-juillet-août 2026)",
})
with open(OUT, 'wb') as f:
    writer.write(f)
print('PDF final :', OUT, '-', len(writer.pages), 'pages')
