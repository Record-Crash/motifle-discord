#!/usr/bin/env python3
"""
resize-images.py — Resize all thumbnails in server/images/ to 60x60.

Safe to interrupt and re-run: skips files already at 60x60.

Usage:
  python3 resize-images.py
  python3 resize-images.py --size 120   # different target size
"""

import argparse
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent
IMAGE_DIR = ROOT / 'server' / 'images'

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--size', type=int, default=60, help='Target square size in px (default: 60)')
    args = parser.parse_args()
    size = (args.size, args.size)

    images = sorted(IMAGE_DIR.glob('*.jpg'))
    print(f'Found {len(images)} images in {IMAGE_DIR}')

    done = skip = fail = 0
    for path in images:
        try:
            with Image.open(path) as img:
                if img.size == size:
                    skip += 1
                    continue
                resized = img.convert('RGB').resize(size, Image.LANCZOS)
                resized.save(path, 'JPEG', quality=85, optimize=True)
                done += 1
        except Exception as e:
            print(f'  FAIL {path.name}: {e}')
            fail += 1

    print(f'Resized: {done}  already correct size: {skip}  failed: {fail}')

if __name__ == '__main__':
    main()
