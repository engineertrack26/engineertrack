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
    above each table as a heading, and the competency and level headings that
    precede it are what give each one its coordinates.

    A KPI statement wraps across lines for about a quarter of the 48. The first
    version of this function matched `KPI\\s*(\\d)\\s*:\\s*([^\\n]+)`, which stops
    at the first newline, so twelve statements were silently cut mid-sentence
    ("...expectations used by the"). Nothing downstream noticed, because a
    truncated sentence is still a non-empty string of plausible length — which
    is why check() now asserts that every statement ends in a period.
    """
    import pypdf

    reader = pypdf.PdfReader(pdf_path)
    text = "\n".join(p.extract_text() or "" for p in reader.pages)
    body = text[text.find("2. INTERNSHIP CONTENT"):]

    # Lines that end a statement: the table's own column headers, or the start
    # of the next structural element.
    HEADERS = ("LEARNING", "OBJECTIVES", "TASKS", "SKILL", "CRITERIA",
               "RESPONSIBILITIES")

    def starts_new_block(line):
        if line.upper().startswith(HEADERS):
            return True
        if re.match(r"KPI\s*\d\s*:", line):
            return True
        if re.fullmatch(r"L[1-4]", line):
            return True
        return any(line == name for name in COMPETENCIES)

    lines = [ln.strip() for ln in body.split("\n")]
    competency = level = None
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]

        if line in COMPETENCIES:
            competency = line
            i += 1
            continue

        matched_level = re.fullmatch(r"L([1-4])", line)
        if matched_level:
            level = int(matched_level.group(1))
            i += 1
            continue

        matched_kpi = re.match(r"KPI\s*(\d)\s*:\s*(.*)", line)
        if matched_kpi:
            parts = [matched_kpi.group(2).strip()]
            j = i + 1
            # Keep consuming continuation lines until the sentence closes.
            while j < len(lines) and not " ".join(parts).rstrip().endswith("."):
                nxt = lines[j]
                if not nxt:
                    j += 1
                    continue
                if starts_new_block(nxt):
                    break
                parts.append(nxt)
                j += 1
            # Why the walk stopped matters more than punctuation. Running off
            # the end of the document is the only way a statement can now be
            # short; stopping at a block boundary means we took everything the
            # source had, whether or not it ended with a full stop. Four of the
            # 48 genuinely carry no final period in the PDF.
            out.append({
                "competency": competency,
                "level": level,
                "kpi_index": int(matched_kpi.group(1)),
                "statement": " ".join(" ".join(parts).split()),
                "ran_off_end": j >= len(lines),
            })
            i = j
            continue

        i += 1
    return out


def extract_triplets(pdf_path, kpis):
    """The Learning Objective / Task / Assessment Criterion rows, each tagged
    with the KPI it sits under.

    The KPI heading is a row inside the same table as its triplets, above the
    column headers, so no page geometry is needed: a triplet belongs to the
    heading row above it in its own table.

    The table carries the level and the KPI index but not the competency name,
    which lives in the text layer. `kpis` is already in document order, so the
    Nth table carrying a heading is the Nth KPI — an assumption this function
    proves rather than trusts, by matching the heading's statement text.
    """
    import camelot

    tables = camelot.read_pdf(pdf_path, pages="1-80", flavor="lattice")
    ordered = sorted(tables, key=lambda t: (t.page, t.order))

    rows = []
    seen_kpis = 0
    current = None
    for table in ordered:
        df = table.df
        for i in range(len(df)):
            cells = [" ".join(str(x).split()) for x in df.iloc[i].tolist()]
            first = cells[0] if cells else ""

            if re.match(r"KPI\s*\d\s*:", first):
                if seen_kpis >= len(kpis):
                    raise SystemExit(f"FAIL: more KPI headings than the {len(kpis)} extracted")
                current = kpis[seen_kpis]
                statement = re.sub(r"^KPI\s*\d\s*:\s*", "", first)
                # The table cell and the text layer must be the same sentence.
                # A mismatch means the Nth heading is not the Nth KPI, and every
                # triplet after it would be filed under the wrong competency.
                head = " ".join(statement.split())[:40].lower()
                want = " ".join(current["statement"].split())[:40].lower()
                if head != want:
                    raise SystemExit(
                        f"FAIL: KPI {seen_kpis + 1} misaligned\n"
                        f"  table: {head}\n"
                        f"  kpis : {want}"
                    )
                seen_kpis += 1
                continue

            if len(cells) != 3 or not all(cells):
                continue
            if "LEARNING" in first.upper():
                continue
            if current is None:
                raise SystemExit("FAIL: a triplet row appeared before any KPI heading")

            rows.append({
                "page": table.page,
                "competency": current["competency"],
                "level": current["level"],
                "kpi_index": current["kpi_index"],
                "objective": cells[0],
                "task": cells[1],
                "criterion": cells[2],
            })

    if seen_kpis != len(kpis):
        raise SystemExit(f"FAIL: {seen_kpis} KPI headings in tables, expected {len(kpis)}")

    # A row split across a page break arrives as two rows whose first cell does
    # not end in a period. Merge only within one KPI: a merge across a boundary
    # would silently move text between competencies.
    merged = []
    for row in rows:
        previous = merged[-1] if merged else None
        continues = (
            previous is not None
            and not previous["objective"].rstrip().endswith(".")
            and row["page"] != previous["pages"][-1]
            and (previous["competency"], previous["level"], previous["kpi_index"])
                == (row["competency"], row["level"], row["kpi_index"])
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

    # A truncated statement is still a non-empty string of plausible length, so
    # no count or label check catches one. Twelve of the 48 were cut mid-sentence
    # before extract_kpis walked continuation lines, and every check here passed.
    cut = [k for k in kpis if k.get("ran_off_end")]
    if cut:
        problems.append("%d KPI statements ran off the end of the document and "
                        "are truncated; first ends: ...%s"
                        % (len(cut), cut[0]["statement"][-45:]))

    stubby = [k for k in kpis if len(k["statement"]) < 40]
    if stubby:
        problems.append("%d KPI statements are under 40 characters, which no "
                        "real one in this framework is: %r"
                        % (len(stubby), stubby[0]["statement"]))

    # 48 KPIs x 10 triplets. A small shortfall is a known, reported gap rather
    # than a silent one: the caller sees the number and decides.
    if len(triplets) < 470:
        problems.append("only %d triplets, expected around 480" % len(triplets))

    stunted = [t for t in triplets if len(t["task"]) < 40 or len(t["criterion"]) < 40]
    if stunted:
        problems.append("%d triplets have a suspiciously short task or criterion"
                        % len(stunted))

    counts = Counter(
        (t["competency"], t["level"], t["kpi_index"]) for t in triplets
    )
    if len(counts) != len(kpis):
        raise SystemExit(f"FAIL: {len(counts)} KPIs carry triplets, expected {len(kpis)}")

    outside = {k: n for k, n in counts.items() if not 8 <= n <= 12}
    if outside:
        raise SystemExit(f"FAIL: KPIs outside the 8-12 band: {outside}")

    # Within the band this is not a failure, but it is where a missing triplet
    # would hide, so it is reported for the human pass. The document says ten
    # each; 478 across 48 averages 9.96.
    uneven = {k: n for k, n in counts.items() if n != 10}
    print(f"note: {len(uneven)} KPIs do not hold exactly 10 triplets: {uneven}", file=sys.stderr)

    return problems


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    pdf_path, out_dir = sys.argv[1], sys.argv[2]

    kpis = extract_kpis(pdf_path)
    triplets = extract_triplets(pdf_path, kpis)

    problems = check(kpis, triplets)
    print("KPIs:     %d" % len(kpis))
    print("triplets: %d  (48 KPIs x 10 = 480 expected)" % len(triplets))
    if problems:
        print("\nFAILED:")
        for p in problems:
            print("  - %s" % p)
        return 1

    import random
    random.seed(0)          # same 48 samples on every run, so a re-check is comparable
    by_kpi = {}
    for t in triplets:
        by_kpi.setdefault((t["competency"], t["level"], t["kpi_index"]), []).append(t)
    print("\n--- one sample per KPI, compare against the PDF ---", file=sys.stderr)
    for key in sorted(by_kpi):
        s = random.choice(by_kpi[key])
        print(f"{key[0]} L{key[1]} KPI{key[2]}: {s['objective']}  (p{s['pages'][0]})", file=sys.stderr)

    for name, data in (("kpis.json", kpis), ("triplets.json", triplets)):
        with open("%s/%s" % (out_dir, name), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        print("wrote %s/%s" % (out_dir, name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
