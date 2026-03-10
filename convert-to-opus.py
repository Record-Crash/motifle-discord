#!/usr/bin/env python3
"""
Convert downloaded audio files to Opus at 64 kbps.

Reads all files in server/audio/ and converts them to .opus using ffmpeg.
Skips files that already have a .opus counterpart — safe to interrupt and re-run.

After conversion, update musicToSongs.py AUDIO_EXT to '.opus' and re-run it
to regenerate game_songs.json with the correct file extension.

Usage:
  python3 convert-to-opus.py                  # convert, keep originals
  python3 convert-to-opus.py --delete-source  # remove source files after conversion

Requirements:
  ffmpeg on PATH
"""

import argparse
import subprocess
import sys
from pathlib import Path

AUDIO_DIR = Path(__file__).parent / 'server' / 'audio'
BITRATE   = '64k'

CONVERTIBLE = {'.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.webm'}


def convert(src: Path, delete_source: bool) -> bool:
    dst = src.with_suffix('.opus')
    cmd = [
        'ffmpeg',
        '-i', str(src),
        '-c:a', 'libopus',
        '-b:a', BITRATE,
        '-vbr', 'on',
        '-compression_level', '10',
        '-y',           # overwrite if somehow already exists
        str(dst),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if r.returncode == 0:
            if delete_source:
                src.unlink()
            return True
        err = (r.stderr or '').strip().splitlines()
        print(f'    error: {err[-1] if err else "unknown"}', file=sys.stderr)
        return False
    except subprocess.TimeoutExpired:
        print('    error: timed out', file=sys.stderr)
        return False
    except FileNotFoundError:
        print('ffmpeg not found — install it and ensure it is on PATH.', file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--delete-source', action='store_true',
                        help='Delete source file after successful conversion')
    args = parser.parse_args()

    if not AUDIO_DIR.exists():
        print(f'Audio directory not found: {AUDIO_DIR}', file=sys.stderr)
        sys.exit(1)

    sources = sorted(p for p in AUDIO_DIR.iterdir() if p.suffix in CONVERTIBLE)
    if not sources:
        print('No convertible audio files found.')
        return

    total = len(sources)
    n_done = n_skip = n_fail = 0

    print(f'Converting {total} files → Opus {BITRATE}  ({AUDIO_DIR})')
    if args.delete_source:
        print('  Source files will be deleted after conversion.')

    for i, src in enumerate(sources, 1):
        dst = src.with_suffix('.opus')
        if dst.exists():
            n_skip += 1
            continue
        print(f'[{i:4}/{total}] {src.name}')
        if convert(src, args.delete_source):
            n_done += 1
        else:
            print(f'         FAIL  {src.name}')
            n_fail += 1

    print(f'\nDone: converted {n_done}  skipped {n_skip}  failed {n_fail}')

    if n_done > 0 and not args.delete_source:
        print('\nNext steps:')
        print('  1. Verify a few .opus files play correctly')
        print('  2. Re-run with --delete-source to remove originals')
        print('  3. In musicToSongs.py, change .mp3 → .opus in the url fields')
        print('     (search for \'/audio/{slug}.mp3\' and update to .opus)')
        print('  4. Re-run musicToSongs.py to regenerate game_songs.json')


if __name__ == '__main__':
    main()
