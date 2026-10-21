import pathlib, json, hashlib, re, collections, urllib.request, shutil

# Publicly volunteered research sample; raw DNA is downloaded locally, never committed.
REPO = pathlib.Path(__file__).resolve().parent.parent
SOURCE = "https://raw.githubusercontent.com/gedankenstuecke/genotyping_23andme/b5160492a1fad18c7180d7ee88b54807b1712c8e/genome_Bastian_Greshake_Full_20110503120911.txt"
SHA256 = "65d5965670d8eb1072f187ab408c9044b0fdc88846d1b0132b0f5c4a3249a92e"
root = REPO / ".test-data/public-sample"
root.mkdir(parents=True, exist_ok=True)
sample = root / "23andme-public.txt"
if not sample.exists():
    with urllib.request.urlopen(SOURCE, timeout=120) as response:
        sample.write_bytes(response.read())
if hashlib.sha256(sample.read_bytes()).hexdigest() != SHA256:
    raise SystemExit("Public sample checksum mismatch")
source = (root / "23andme-public.txt").read_text()
g = {}
total = 0
for line in source.splitlines():
    if not line or line.startswith("#"):
        continue
    total += 1
    c = line.split()
    if len(c) < 4:
        continue
    rs, ch, pos, gt = c[:4]
    if (
        not rs.startswith("rs")
        or ch not in [str(i) for i in range(1, 23)] + ["X", "Y", "MT", "M", "26"]
        or not pos.isdigit()
        or int(pos) == 0
    ):
        continue
    if gt == "-":
        gt = "--"
    if gt == "--" or (len(gt) == 2 and all(x in "ATGCID-" for x in gt)):
        g[rs] = gt
studies = json.loads((REPO / "tests/fixtures/public-sample-studies.json").read_text())
(root / "studies.json").write_text(json.dumps(studies, indent=2))
expected = []
for s in studies:
    allele = (s.get("strongest_snp_risk_allele") or "").split("-")
    if len(allele) < 2 or not allele[1]:
        continue
    snp, base = allele[:2]
    gt = g.get(snp, "")
    if not re.fullmatch("[ACGT]{2}", gt) or base not in gt:
        continue
    if snp not in re.split(r"[;,\s]+", s.get("snps") or ""):
        continue
    value = s.get("or_or_beta") or "1"
    ci = (s.get("ci_text") or "").lower()
    effect = "beta" if "increase" in ci or "decrease" in ci else "OR"
    match = re.match(r"\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)", str(value))
    if not match:
        score = 1
        direction = "neutral"
    else:
        size = float(match[1])
        size = -abs(size) if "decrease" in ci and "increase" not in ci else size
        dosage = gt.count(base)
        score = size * dosage if effect == "beta" else size**dosage
        direction = (
            ("increased" if size > 0 else "decreased")
            if effect == "beta"
            else ("neutral" if size == 1 else "increased" if size > 1 else "decreased")
        )
    expected.append(
        dict(
            studyId=s["id"],
            matchedSnp=snp,
            userGenotype=gt,
            effectType=effect,
            riskScore=score,
            riskLevel=direction,
        )
    )
expected.sort(key=lambda r: r["studyId"])
result = {
    "totalRows": total,
    "parsedVariants": len(g),
    "parsedNoCalls": sum(gt == "--" for gt in g.values()),
    "studies": len(studies),
    "matches": len(expected),
    "directions": dict(collections.Counter(r["riskLevel"] for r in expected)),
    "results": expected,
}
(root / "expected.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({k: v for k, v in result.items() if k != "results"}, indent=2))

for dest in [
    REPO / "apps/android/app/src/androidTest/assets/public-sample",
    REPO / "apps/ios/TestData",
]:
    dest.mkdir(parents=True, exist_ok=True)
    for name in ["23andme-public.txt", "studies.json", "expected.json"]:
        shutil.copyfile(root / name, dest / name)
