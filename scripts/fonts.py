"""Subset the bundled OFL fonts. Run after adding UI text.

Requires: pip install fonttools brotli
Source: Fusion Pixel Font 12px proportional OTF, release 2026.09.25.
Download the upstream archive into artifacts/fusion-font before running.
"""
from pathlib import Path
import json
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
source = root / 'artifacts/fusion-font'
output = root / 'public/fonts'
output.mkdir(parents=True, exist_ok=True)
text = ''.join(p.read_text(encoding='utf-8-sig') for p in (root / 'src').rglob('*') if p.suffix in ('.ts', '.tsx'))
chars = set(range(32, 127)) | {ord(c) for c in text if ord(c) >= 160} | {0x2026, 0x00d7, 0x00b0, 0x2191, 0x2193}
report = {}
for lang in ('latin', 'ko', 'zh_hans', 'ja'):
    font = TTFont(source / f'fusion-pixel-12px-proportional-{lang}.otf.woff2')
    missing = chars - set(font.getBestCmap())
    if missing:
        raise ValueError(f'{lang}: missing glyphs {sorted(chr(c) for c in missing)}')
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=chars)
    sub.subset(font)
    # Give the subset a project-specific family, preserving copyright/license names.
    for entry in font['name'].names:
        if entry.nameID in (1, 3, 4, 6, 16):
            entry.string = f'Singularity Pixel {lang}'.encode(entry.getEncoding())
    path = output / f'{lang}.woff2'
    font.save(path)
    report[lang] = {'glyphs': len(chars), 'bytes': path.stat().st_size, 'missing': []}
print(json.dumps(report, indent=2))
