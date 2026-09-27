# Builds the foldable theme band prototypes (A, B, C) as copies of the
# frozen d04 plugin. The product files are never touched.
import os
import re
import shutil
import sys

S = os.path.expandvars(r"%LOCALAPPDATA%\Temp\claude\C--Users-stephen-git-hwinfo-streamdeck\91b47c1b-9d80-49d5-bfea-6c93b12f0164\scratchpad")
SRC = os.path.join(S, "r3-cand-d04", "com.lawrensen.hwinfo.sdPlugin")
OUT = os.path.join(S, "themefold")
HERE = os.path.dirname(os.path.abspath(__file__))

BAND = re.compile(r"\t\t<section class=\"hw-look\" id=\"look\" aria-labelledby=\"theme-label\">.*?</section>\n", re.S)

CHANGE = '<button type="button" class="hw-link hw-look-change" id="theme-change" data-reveal="shared-theme" aria-label="Change the shared theme" hidden>Change</button>'
GALLERY = '<div class="hw-themes" id="theme-gallery" role="radiogroup" aria-labelledby="theme-label" aria-describedby="theme-desc theme-help"></div>'

# A: a standard section row above today's band.
A = f"""		<details class="hw-sec hw-look-sec" id="sec-theme" open>
			<summary><span class="hw-sec-title">Theme</span><span class="hw-look-mini" id="theme-mini"></span><span class="hw-sec-sum" id="theme-sum"></span></summary>
			<section class="hw-look" id="look" aria-labelledby="theme-label">
				<div class="hw-look-row">
					<p class="hw-look-name"><span class="hw-label" id="theme-label">Theme</span><span class="hw-look-current" id="theme-current"></span>{CHANGE}</p>
					{GALLERY}
					<span class="hw-sr-only" id="theme-desc"></span>
				</div>
				<p class="hw-help" id="theme-help"></p>
			</section>
		</details>
"""

# B and C: the theme line itself is the fold row.
BC = f"""		<details class="hw-sec hw-look hw-look-fold" id="sec-theme" open>
			<summary class="hw-look-name"><span class="hw-label" id="theme-label">Theme</span><span class="hw-look-mini" id="theme-mini"></span><span class="hw-look-current" id="theme-current"></span></summary>
			<div class="hw-look-row">
				{CHANGE}
				{GALLERY}
				<span class="hw-sr-only" id="theme-desc"></span>
			</div>
			<p class="hw-help" id="theme-help"></p>
		</details>
"""

# R: B revised after the review; the fold row carries the empty-key note.
R = BC.replace('<span class="hw-look-current" id="theme-current"></span></summary>', '<span class="hw-look-current" id="theme-current"></span><span class="hw-look-note" id="theme-note"></span></summary>')
assert R != BC
R = R.replace('<span class="hw-sr-only" id="theme-desc"></span>', '<span class="hw-sr-only" id="theme-desc" hidden></span>')

# R2 (after the approval round) is built from the working tree, so it
# carries the round-3 re-review and spacing fixes; A, B, C and R stay on
# the frozen d04 candidate. Pass variant names to build only those.
TREE = r"C:\Users\stephen\git\hwinfo-pi-density\com.lawrensen.hwinfo.sdPlugin"
ONLY = sys.argv[1:] or ["A", "B", "C", "R", "R2"]
for variant, markup in (("A", A), ("B", BC), ("C", BC), ("R", R), ("R2", R)):
	if variant not in ONLY:
		continue
	dest = os.path.join(OUT, f"proto-{variant}", "com.lawrensen.hwinfo.sdPlugin")
	if os.path.exists(dest):
		shutil.rmtree(dest)
	shutil.copytree(TREE if variant == "R2" else SRC, dest, ignore=shutil.ignore_patterns("logs"))
	ui = os.path.join(dest, "ui")
	for page in ("sensor-reading.html", "sensor-dial.html"):
		p = os.path.join(ui, page)
		s = open(p, encoding="utf-8").read()
		s, n = BAND.subn(markup, s)
		assert n == 1, (variant, page, n)
		s = s.replace('<link rel="stylesheet" href="pi.css?v=1.7.0.0-d04" />', f'<link rel="stylesheet" href="pi.css?v=1.7.0.0-d04" />\n\t\t<link rel="stylesheet" href="proto-{variant}.css" />', 1)
		s = s.replace("\t</body>", '\t\t<script src="proto.js"></script>\n\t</body>', 1)
		assert f"proto-{variant}.css" in s and "proto.js" in s, (variant, page)
		open(p, "w", encoding="utf-8", newline="").write(s)
	# A, B, C and R keep the note script the review round saw (proto-v1.js).
	shutil.copyfile(os.path.join(HERE, "proto.js" if variant == "R2" else "proto-v1.js"), os.path.join(ui, "proto.js"))
	shutil.copyfile(os.path.join(HERE, f"proto-{variant}.css"), os.path.join(ui, f"proto-{variant}.css"))
	if variant == "R":
		# Once the panel is showing, a late fold answer never folds a
		# section that holds focus (AT05, owner's call; all sections).
		p = os.path.join(ui, "pi-shell.js")
		t = open(p, encoding="utf-8").read()
		old = "\t\tfor (const section of sections) {\n\t\t\tif (typeof folds[section.id] === \"boolean\") section.open = folds[section.id];\n\t\t}"
		new = "\t\tconst showing = !document.documentElement.hasAttribute(\"data-folds-pending\");\n\t\tfor (const section of sections) {\n\t\t\tif (typeof folds[section.id] !== \"boolean\") continue;\n\t\t\tif (showing && !folds[section.id] && section.contains(document.activeElement)) continue;\n\t\t\tsection.open = folds[section.id];\n\t\t}"
		assert t.count(old) == 1, "shell loop"
		open(p, "w", encoding="utf-8", newline="").write(t.replace(old, new))
	if variant == "R2":
		# Once the panel is showing, a late fold answer never folds any
		# section: nothing closes under the person (ADR05, owner's call;
		# every section). The plugin's memory itself is untouched.
		p = os.path.join(ui, "pi-shell.js")
		t = open(p, encoding="utf-8").read()
		old = "\t\tfor (const section of sections) {\n\t\t\tif (typeof folds[section.id] === \"boolean\") section.open = folds[section.id];\n\t\t}"
		new = "\t\tconst showing = !document.documentElement.hasAttribute(\"data-folds-pending\");\n\t\tfor (const section of sections) {\n\t\t\tif (typeof folds[section.id] !== \"boolean\") continue;\n\t\t\tif (showing && !folds[section.id]) continue;\n\t\t\tsection.open = folds[section.id];\n\t\t}"
		assert t.count(old) == 1, "shell loop R2"
		open(p, "w", encoding="utf-8", newline="").write(t.replace(old, new))
	print("built", variant, dest)
