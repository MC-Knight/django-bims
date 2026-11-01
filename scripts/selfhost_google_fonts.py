"""
Download the Google Fonts used by the templates and write a local stylesheet.

Usage: python scripts/selfhost_google_fonts.py bims/static/vendor/fonts
"""
import hashlib
import os
import re
import sys
import urllib.request

OUT = sys.argv[1]  # e.g. bims/static/vendor/fonts
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0 Safari/537.36')
CSS_URL = (
    'https://fonts.googleapis.com/css?family='
    'Alegreya:400,400i,500,500i,700,700i'
    '|Roboto:100,300,400,400i,500,500i,700,700i'
    '|Roboto+Condensed:100,100i,300,300i,400,400i,500,500i,700,700i'
    '&display=swap'
)
KEEP = {'latin', 'latin-ext'}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


css = get(CSS_URL).decode()
blocks = re.findall(r'/\* ([\w-]+) \*/\s*(@font-face \{.*?\})', css, re.S)
os.makedirs(os.path.join(OUT, 'files'), exist_ok=True)
out, n = [], 0
for subset, block in blocks:
    if subset not in KEEP:
        continue
    fam = re.search(r"font-family: '([^']+)'", block).group(1)
    style = re.search(r'font-style: (\w+)', block).group(1)
    weight = re.search(r'font-weight: (\d+)', block).group(1)
    url = re.search(r'url\((https://[^)]+\.woff2)\)', block).group(1)
    # Google serves variable fonts: several weights share one file. Name by
    # URL so each file is stored (and downloaded by browsers) only once.
    name = '{}-{}-{}-{}.woff2'.format(
        fam.lower().replace(' ', '-'), style, subset,
        hashlib.md5(url.encode()).hexdigest()[:8])
    path = os.path.join(OUT, 'files', name)
    if not os.path.exists(path):
        with open(path, 'wb') as f:
            f.write(get(url))
    n += 1
    out.append('/* {} */\n'.format(subset) +
               block.replace(url, 'files/' + name))

header = ('/* Self-hosted copy of Google Fonts (latin, latin-ext) used by the\n'
          ' * templates, so pages don\'t wait on fonts.googleapis.com.\n'
          ' * Regenerate: python scripts/selfhost_google_fonts.py bims/static/vendor/fonts */\n')
with open(os.path.join(OUT, 'google-fonts.css'), 'w') as f:
    f.write(header + '\n'.join(out) + '\n')
print('faces:', n, 'families:',
      sorted({re.search(r"font-family: '([^']+)'", b).group(1) for _, b in blocks}))
