#!/usr/bin/env python3
"""Lightweight evidence check for Arco-based review prototypes."""

from __future__ import annotations

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

SOURCE_SUFFIXES = {'.js', '.jsx', '.ts', '.tsx'}
IGNORED_DIRS = {'build', 'dist', 'node_modules'}
OTHER_UI_IMPORTS = {
    'antd',
    '@chakra-ui',
    '@douyinfe/semi-ui',
    '@mui',
    'element-plus',
}
NATIVE_INTERACTIVE = re.compile(r'<\s*(button|dialog|input|select|textarea)\b')
ARCO_ROOT_IMPORT = re.compile(r"from\s+['\"]@arco-design/web-react['\"]")
ARCO_STYLE_IMPORT = "@arco-design/web-react/dist/css/arco.css"


class ExternalAssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.external_assets: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        asset_keys = {'src', 'poster'} if tag in {'img', 'script', 'source', 'video'} else {'href'} if tag == 'link' else set()
        for key, value in attrs:
            if key in asset_keys and value and value.startswith(('http://', 'https://', '//')):
                self.external_assets.append(value)


def source_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix in SOURCE_SUFFIXES else []
    return [
        path
        for path in root.rglob('*')
        if path.is_file()
        and path.suffix in SOURCE_SUFFIXES
        and not any(part in IGNORED_DIRS for part in path.parts)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Prototype source file or directory')
    parser.add_argument('--html', type=Path, help='Optional built review HTML')
    args = parser.parse_args()

    files = source_files(args.source)
    if not files:
        print('FAIL: no JavaScript or TypeScript source found', file=sys.stderr)
        return 1

    texts = {path: path.read_text(encoding='utf-8') for path in files}
    combined = '\n'.join(texts.values())
    errors: list[str] = []

    if not ARCO_ROOT_IMPORT.search(combined):
        errors.append("missing root import from '@arco-design/web-react'")
    if ARCO_STYLE_IMPORT not in combined:
        errors.append(f'missing Arco stylesheet import: {ARCO_STYLE_IMPORT}')

    for path, text in texts.items():
        match = NATIVE_INTERACTIVE.search(text)
        if match:
            errors.append(f'{path}: native <{match.group(1)}> bypasses Arco')
        for library in OTHER_UI_IMPORTS:
            if re.search(rf"(?:from|import)\s*['\"]{re.escape(library)}(?:/|['\"])", text):
                errors.append(f'{path}: mixed UI library import: {library}')

    if args.html:
        if not args.html.is_file():
            errors.append(f'built HTML not found: {args.html}')
        else:
            html = args.html.read_text(encoding='utf-8')
            html_parser = ExternalAssetParser()
            html_parser.feed(html)
            if html_parser.external_assets:
                errors.append('built HTML uses online assets: ' + ', '.join(html_parser.external_assets))

    if errors:
        for error in errors:
            print(f'FAIL: {error}', file=sys.stderr)
        return 1

    print(f'Arco usage validation passed ({len(files)} source files)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
