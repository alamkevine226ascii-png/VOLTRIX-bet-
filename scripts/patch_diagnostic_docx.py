#!/usr/bin/env python3
"""Post-traitement du docx généré :
1. Supprime les <w:pgNumType/> vides (section couverture).
2. Ajoute le commutateur de format aux champs PAGE des pieds de page :
   - section en numérotation romaine  -> PAGE \\* ROMAN \\* MERGEFORMAT
   - section en numérotation décimale -> PAGE \\* arabic \\* MERGEFORMAT
"""
import re
import shutil
import sys
import zipfile

path = sys.argv[1]
tmp = path + ".tmp"

with zipfile.ZipFile(path, "r") as zin:
    names = zin.namelist()
    data = {n: zin.read(n) for n in names}

doc = data["word/document.xml"].decode("utf-8")

# 1. Supprimer les pgNumType vides (fusion de l'espace possible)
doc = re.sub(r"<w:pgNumType\s*/>", "", doc)

# 1bis. Supprimer l'entrée hyperlink résiduelle dans le premier paragraphe du champ TOC
# (docx-js émet une entrée hyperlink par titre dans le champ ; le script de placeholders
#  ne nettoie que les paragraphes ENTRES separate et end, pas le contenu du premier
#  paragraphe — d'où une entrée dupliquée sans numéro de page.)
from lxml import etree
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
root = etree.fromstring(doc.encode("utf-8"))
removed_links = 0
for p in root.iter(f"{{{W}}}p"):
    instrs = [it.text or "" for it in p.findall(f"{{{W}}}r/{{{W}}}instrText")]
    if instrs and any("TOC" in t and "PAGEREF" not in t for t in instrs):
        # paragraphe porteur du début du champ TOC : retirer les hyperlinks internes
        for hl in p.findall(f"{{{W}}}hyperlink"):
            p.remove(hl)
            removed_links += 1
        # compacter ce paragraphe désormais vide (simple garde visuelle)
        ppr = p.find(f"{{{W}}}pPr")
        if ppr is not None:
            sp = ppr.find(f"{{{W}}}spacing")
            if sp is None:
                sp = etree.SubElement(ppr, f"{{{W}}}spacing")
            sp.set(f"{{{W}}}before", "0")
            sp.set(f"{{{W}}}after", "0")
            sp.set(f"{{{W}}}line", "240")
            sp.set(f"{{{W}}}lineRule", "auto")
        break
doc = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True).decode("utf-8")

# 2. Pour chaque sectPr, retrouver le format de numérotation et les références de pied de page
rels = data["word/_rels/document.xml.rels"].decode("utf-8")
rel_map = dict(re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels))

sect_blocks = re.findall(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc, flags=re.S)
footer_fmt = {}  # nom de fichier -> "roman" | "arabic"
for block in sect_blocks:
    m = re.search(r'<w:pgNumType[^>]*w:fmt="([^"]+)"', block)
    if not m:
        continue
    fmt = m.group(1)
    for rid in re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', block):
        target = rel_map.get(rid, "")
        fname = "word/" + target.lstrip("/") if not target.startswith("word/") else target
        if fmt in ("upperRoman", "lowerRoman"):
            footer_fmt[fname] = "ROMAN"
        elif fmt in ("decimal",):
            footer_fmt[fname] = "arabic"

patched = []
for fname, style in footer_fmt.items():
    if fname not in data:
        continue
    xml = data[fname].decode("utf-8")
    new_xml, n = re.subn(
        r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
        r"\g<1> PAGE \\* " + style + r" \\* MERGEFORMAT \g<2>",
        xml,
    )
    if n:
        data[fname] = new_xml.encode("utf-8")
        patched.append((fname, style, n))

data["word/document.xml"] = doc.encode("utf-8")

with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for n in names:
        zout.writestr(n, data[n])
shutil.move(tmp, path)

print("pgNumType vides supprimés ; hyperlinks TOC résiduels retirés :", removed_links, "; pieds de page patchés :", patched if patched else "aucun")
