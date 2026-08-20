#!/usr/bin/env python3
"""
Extract the Engineering Internship Competency Framework from
INTERNSHIP-CONTENT-DRAFT.pdf into JSON.

Produces two files:
  kpis.json      — the 48 KPI statements, each tagged with competency and level
  triplets.json  — the Learning Objective / Task / Assessment Criterion rows

WHY CAMELOT AND NOT pdfplumber
The document's tables are ruled — they have real drawn borders — which is
exactly what camelot's `lattice` flavour reads. pdfplumber was tried first with
four different table_settings and could not do it: it recovers the three column
headers but shreds each cell into one row per visual line, so a 10-triplet page
came back as 22 fragments averaging 24 characters. Camelot returns whole cells
(74/153/138 characters on the same page) at 99.4% reported accuracy.

Raw text extraction is worse still and is what the first attempt used: in the
numbered sections the objective and task run together on one line, and in the
unnumbered sections the three columns interleave completely.

THE PAGE-BREAK MERGE
A triplet whose cell text crosses a page boundary comes back as two rows. They
are rejoined by a deliberately narrow rule — the previous objective does not end
in a period AND the next row is on a different page. A looser rule was tried
first (merge whenever the objective does not look like a fresh one) and collapsed
499 rows into 160, gluing one objective into 16857 characters. Narrow wins.

Run:  python scripts/extract-internship-content.py <path-to-pdf> <out-dir>
"""
import json
import re
import sys
import warnings
from collections import Counter

warnings.filterwarnings("ignore")

COMPETENCIES = [
    "Engineering Problem Solving",
    "Technical Documentation",
    "Professional Communication",
    "Digital Tool Proficiency",
    "Responsibility & Ethics",
    "Collaboration & Teamwork",
]


def extract_kpis(pdf_path):
    """The 48 KPI statements, tagged with competency and level.

    These come from the raw text layer rather than the tables: the KPI line sits
    above each table as a heading, and it extracts cleanly there — all 48, none
    truncated. The competency and level headings that precede it are what give
    each one its coordinates.
    """
    import pypdf

    reader = pypdf.PdfReader(pdf_path)
    text = "\n".join(p.extract_text() or "" for p in reader.pages)
    body = text[text.find("2. INTERNSHIP CONTENT"):]

    pattern = (
        r"(" + "|".join(re.escape(c) for c in COMPETENCIES) + r")"
        r"|(?:\n\s*(L[1-4])\s*\n)"
        r"|KPI\s*(\d)\s*:\s*([^\n]+)"
    )
    competency = level = None
    out = []
    for comp, lvl, idx, statement in re.findall(pattern, body):
        if comp:
            competency = comp
        elif lvl:
            level = lvl
        elif idx:
            out.append({
                "competency": competency,
                "level": int(level[1]),
                "kpi_index": int(idx),
                "statement": " ".join(statement.split()),
            })
    return out


def extract_triplets(pdf_path):
    """The Learning Objective / Task / Assessment Criterion rows."""
    import camelot

    tables = camelot.read_pdf(pdf_path, pages="1-80", flavor="lattice")
    rows = []
    for table in tables:
        df = table.df
        for i in range(len(df)):
            cells = [" ".join(str(x).split()) for x in df.iloc[i].tolist()]
            if len(cells) != 3 or not all(cells):
                continue
            head = cells[0].upper()
            if "LEARNING" in head or head.startswith("KPI"):
                continue
            rows.append({
                "page": table.page,
                "objective": cells[0],
                "task": cells[1],
                "criterion": cells[2],
            })

    merged = []
    for row in rows:
        previous = merged[-1] if merged else None
        continues = (
            previous is not None
            and not previous["objective"].rstrip().endswith(".")
            and row["page"] != previous["pages"][-1]
        )
        if continues:
            for key in ("objective", "task", "criterion"):
                previous[key] = (previous[key] + " " + row[key]).strip()
            previous["pages"] = sorted(set(previous["pages"] + [row["page"]]))
        else:
            entry = dict(row)
            entry["pages"] = [entry.pop("page")]
            merged.append(entry)
    return merged


def check(kpis, triplets):
    """Fail loudly rather than emit a short or mis-shaped extraction."""
    problems = []

    if len(kpis) != 48:
        problems.append("expected 48 KPIs, got %d" % len(kpis))

    per_competency = Counter(k["competency"] for k in kpis)
    for name in COMPETENCIES:
        if per_competency.get(name) != 8:
            problems.append("%s has %d KPIs, expected 8"
                            % (name, per_competency.get(name, 0)))

    per_level = Counter(k["level"] for k in kpis)
    for lvl in (1, 2, 3, 4):
        if per_level.get(lvl) != 12:
            problems.append("level %d has %d KPIs, expected 12"
                            % (lvl, per_level.get(lvl, 0)))

    unlabelled = [k for k in kpis if not k["competency"] or not k["level"]]
    if unlabelled:
        problems.append("%d KPIs missing a competency or level" % len(unlabelled))

    # 48 KPIs x 10 triplets. A small shortfall is a known, reported gap rather
    # than a silent one: the caller sees the number and decides.
    if len(triplets) < 470:
        problems.append("only %d triplets, expected around 480" % len(triplets))

    stunted = [t for t in triplets if len(t["task"]) < 40 or len(t["criterion"]) < 40]
    if stunted:
        problems.append("%d triplets have a suspiciously short task or criterion"
                        % len(stunted))

    return problems


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    pdf_path, out_dir = sys.argv[1], sys.argv[2]

    kpis = extract_kpis(pdf_path)
    triplets = extract_triplets(pdf_path)

    problems = check(kpis, triplets)
    print("KPIs:     %d" % len(kpis))
    print("triplets: %d  (48 KPIs x 10 = 480 expected)" % len(triplets))
    if problems:
        print("\nFAILED:")
        for p in problems:
            print("  - %s" % p)
        return 1

    for name, data in (("kpis.json", kpis), ("triplets.json", triplets)):
        with open("%s/%s" % (out_dir, name), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        print("wrote %s/%s" % (out_dir, name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
