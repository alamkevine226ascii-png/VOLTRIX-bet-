#!/usr/bin/env python3
"""Patch pieds de page du dossier de suivi VOLTRIX (compat WPS) :
   - instrText PAGE -> PAGE \\* ROMAN (section sommaire) / PAGE \\* arabic (section corps)
   - suppression des <w:pgNumType/> vides (section couverture)
   Méthode : associer chaque sectPr (ordre du document) à ses footerReference via
   word/_rels/document.xml.rels, en fonction du fmt de pgNumType."""
import re
import shutil
import sys
import zipfile

DOCX = "/home/z/my-project/download/VOLTRIX-bet-Dossier-de-suivi-projet.docx"
TMP = DOCX + ".tmp"

with zipfile.ZipFile(DOCX, "r") as z:
    names = z.namelist()
    data = {n: z.read(n) for n in names}

doc_xml = data["word/document.xml"].decode("utf-8")
rels_xml = data["word/_rels/document.xml.rels"].decode("utf-8")

# 1. Supprimer les pgNumType vides (couverture)
before = doc_xml.count("<w:pgNumType/>")
doc_xml = doc_xml.replace("<w:pgNumType/>", "")
print(f"pgNumType vides supprimés : {before}")

# 2. Cartographier rId -> cible footer
rel_map = {}
for m in re.finditer(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*/>', rels_xml):
    rel_map[m.group(1)] = m.group(2)

# 3. Pour chaque sectPr, lire fmt et footerReference
plan = {}  # footer file -> 'ROMAN' | 'arabic'
for sect in re.finditer(r"<w:sectPr[ >].*?</w:sectPr>", doc_xml, re.S):
    s = sect.group(0)
    fmt_m = re.search(r'<w:pgNumType[^>]*w:fmt="([^"]+)"', s)
    foot_refs = re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', s)
    if not foot_refs:
        continue
    fmt = (fmt_m.group(1) if fmt_m else "decimal")
    style = "ROMAN" if "oman" in fmt.lower() else "arabic"
    for rid in foot_refs:
        target = rel_map.get(rid, "")
        fname = "word/" + target.lstrip("/")
        plan[fname] = style

print("Plan de patch :", plan)

# 4. Appliquer le patch sur chaque footer
for fname, style in plan.items():
    if fname not in data:
        print(f"AVERTISSEMENT : {fname} absent")
        continue
    xml = data[fname].decode("utf-8")
    new_xml, n = re.subn(
        r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
        rf"\1 PAGE \\* {style} \\* MERGEFORMAT \2",
        xml,
    )
    if n:
        data[fname] = new_xml.encode("utf-8")
        print(f"{fname}: {n} champ(s) PAGE -> \\* {style}")
    else:
        print(f"{fname}: aucun champ PAGE nu trouvé (déjà patché ?)")

data["word/document.xml"] = doc_xml.encode("utf-8")

with zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED) as z:
    for n in names:
        z.writestr(n, data[n])
shutil.move(TMP, DOCX)
print("Patch terminé.")
