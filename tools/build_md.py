#!/usr/bin/env python3
"""Rebuild index.md (the markdown version for agents) from index.html.

Usage: python3 tools/build_md.py
The HTML is the source of truth. This reads <main>, keeps headings, paragraphs,
list items and links, and drops everything decorative (logos, portals, lenses).
"""
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://enjalot.github.io/'


class MD(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out, self.buf, self.href = [], [], None
        self.on = False       # inside header/main/footer
        self.skip = 0         # inside an element we drop
        self.block = None
        self.quote = False    # inside a quoted tweet

    def flush(self, prefix='', suffix='\n\n'):
        text = re.sub(r'\s+', ' ', ''.join(self.buf)).strip()
        text = re.sub(r'\s+([,.:;)])', r'\1', text)
        self.buf = []
        if self.block == 'job':
            # "Company", "Role", "2020 to 2022" -> one line
            text = ', '.join(t.strip() for t in text.split('|') if t.strip())
        if text:
            self.out.append(('> ' if self.quote else '') + prefix + text + suffix)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('header', 'main', 'footer'):
            self.on = True
        if not self.on or tag in ('img', 'br'):
            return
        if tag == 'button' or a.get('class') in ('hint', 'logo', 'tweets') or self.skip:
            self.skip += 1
            return
        if tag == 'blockquote':
            self.quote = True
        if tag in ('h2', 'p', 'li', 'nav', 'cite') or a.get('class') in ('job', 'name'):
            self.flush()
            self.block = 'nav' if tag == 'nav' else a.get('class') or tag
        if tag == 'a':
            href = a.get('href', '')
            self.href = href if re.match(r'https?:', href) else SITE + href
            self.buf.append('[')

    def handle_endtag(self, tag):
        if tag in ('header', 'main', 'footer'):
            self.flush()
            self.on = False
        if not self.on:
            return
        if self.skip:
            self.skip -= 1
            return
        if tag == 'a' and self.href is not None:
            self.buf.append(f']({self.href})')
            self.href = None
            if self.block == 'nav':
                self.buf.append(' · ')
            if self.block == 'job':
                self.buf.append('|')
        elif tag == 'span' and self.block == 'job':
            self.buf.append('|')
        elif tag == 'cite':
            self.flush()
        elif tag == 'blockquote':
            self.quote = False
        elif tag == 'h2':
            self.flush('## ')
        elif tag == 'li':
            self.flush('- ', '\n')
        elif tag == 'ul':
            self.out.append('\n')
        elif tag == 'nav':
            self.buf = [re.sub(r'\s*·\s*$', '', ''.join(self.buf).strip())]
            self.flush()
        elif tag == 'p':
            self.flush(suffix='\n' if self.quote else '\n\n')
        elif tag == 'span' and self.block == 'name':
            self.flush('# ')
            self.block = None
        elif tag == 'div' and self.block == 'job':
            # "Company 2020 to 2022" -> a third-level heading
            self.flush('### ')
            self.block = None

    def handle_data(self, data):
        if self.on and not self.skip:
            self.buf.append(data)


p = MD()
# the map section only exists while the dots are showing
p.feed(re.sub(r'<section id="explore">.*?</section>', '', (ROOT / 'index.html').read_text(), flags=re.S))
md = re.sub(r'\n{3,}', '\n\n', ''.join(p.out)).strip() + '\n'
(ROOT / 'index.md').write_text(md)
print(f'wrote index.md ({len(md)} bytes)')
