#!/usr/bin/env python3
"""
musicToSongs.py — Discord Activity data generator.

Outputs (relative to this file):
  game_songs.json       Unique songs, no day field — client uses modulo on days-since-epoch
  game_motifs.json      Guessable leitmotifs with rarity
  song_downloads.csv    slug,url,source  (feed to download-audio.py)
  image_downloads.csv   slug,url         (feed to download-images.py)

Client date logic:
  EPOCH = 2023-08-09
  song = songs[daysSinceEpoch % songs.length]

New songs are inserted right after today's modulo position so they appear
in the rotation as soon as possible.

Resumable: existing game_songs.json and CSV rows are preserved; only new
slugs are appended.

Usage:
  python3 musicToSongs.py
  python3 musicToSongs.py --groups canmt umspaf   # daily pool limited to these groups
"""

import argparse
import csv
import datetime
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Optional

import yaml

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

COUNTED_REFERENCE_GROUPS = ['Official Discography', 'group:official']
INCLUDED_GROUPS = [*COUNTED_REFERENCE_GROUPS, 'Fandom']
EXCLUDED_GROUPS = ['Desynced']

EXCLUDED_ALBUMS = [
    'hiveswap-act-1-ost', 'hiveswap-act-2-ost', 'hiveswap-friendsim',
    'the-grubbles', 'homestuck-vol-1-4', 'genesis-frog', 'sburb',
    'call-and-new', 'call-and-new-2-locomotif', 'c-a-n-w-a-v-e', 'c-a-n-w-a-v-e-2',
]

EXCLUDED_SONGS = [
    'lame-and-old-webcomic-voluem-10-mega-milx',
    'special-delivery',
    'please-help-me-i-am-in-pain',
    'crystalmegamix',
    'waste-of-a-track-slot',
    'credit-shack',
    'licord-nacrasty',
    'im-not-saying-anything',
]

DISCARDED_MOTIFS = [
    'the-nutshack-intro',
    'bowmans-credit-score',
    'snow-halation',
    'dk-rap',
    'meet-the-flintstones',
]

# The epoch date: songs[0] corresponds to this day.
EPOCH = datetime.date(2023, 8, 9)

# Gameplay filter thresholds (unchanged from original)
COMMON_THRESHOLD   = 20
UNCOMMON_THRESHOLD = 10
RARE_THRESHOLD     = 4
MIN_LEITMOTIFS     = 3
MAX_LEITMOTIFS     = 999

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT       = Path(__file__).parent
OLD_APP    = ROOT / 'old-app'
ALBUM_PATH = OLD_APP / 'hsmusic-data' / 'album'

GAME_SONGS_OUT   = ROOT / 'client' / 'public' / 'game_songs.json'
GAME_MOTIFS_OUT  = ROOT / 'client' / 'public' / 'game_motifs.json'
SONG_DL_CSV      = ROOT / 'song_downloads.csv'
IMAGE_DL_CSV     = ROOT / 'image_downloads.csv'

# Legacy: old songs with their original day-sorted ordering
OLD_GAME_SONGS   = OLD_APP / 'static' / 'game_songs_old.json'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_yaml(path: Path) -> list:
    with open(path, 'r', encoding='utf8') as f:
        return [doc for doc in yaml.load_all(f, Loader=yaml.SafeLoader)]


def normalize_wiki_string(s: str) -> str:
    if s == 'MeGaLoVania':
        return 'MeGaLoVania'
    if s == 'iRRRRRRRRECONCILA8LE':
        return 'iRRRRRRRRECONCILA8LE'
    s = '-'.join(s.split(' '))
    s = re.sub('&', 'and', s)
    s = re.sub(r'[^a-zA-Z0-9\-]', '', s)
    s = re.sub(r'-{2,}', '-', s)
    return re.sub(r'^-+|-+$', '', s).lower()


def best_download_url(urls: list) -> tuple:
    """Bandcamp > YouTube > SoundCloud."""
    urls = [u for u in (urls or []) if u]
    for u in urls:
        if 'bandcamp' in u:
            return u, 'bandcamp'
    for u in urls:
        if 'youtu' in u:
            return u, 'youtube'
    for u in urls:
        if 'soundcloud' in u:
            return u, 'soundcloud'
    return None, None


def get_track_slug(song: dict, album: dict, album_name: str) -> str:
    """Compute the canonical slug for a track, respecting hsmusic's Suffix Directory rules."""
    name_slug = song.get('Directory') or normalize_wiki_string(song['Track'])
    # Per-track opt-in
    track_suffix = song.get('Suffix Directory')
    # Album-wide opt-in (can be overridden per-track with Suffix Directory: false)
    album_suffix = album.get('Suffix Track Directories', False)
    use_suffix = (track_suffix is True) or (album_suffix and track_suffix is not False)
    if use_suffix:
        suffix = album.get('Directory Suffix') or album_name
        return f'{name_slug}-{suffix}'
    return name_slug


def get_is_official(album_object: dict, song: dict, album_name: str = '') -> bool:
    exceptions = [('penumbra-phantasm', 'Toby Fox')]
    if any(g in COUNTED_REFERENCE_GROUPS for g in album_object.get('Groups', [])):
        return True
    slug = get_track_slug(song, album_object, album_name)
    return any(slug == ex[0] and ex[1] in song.get('Artists', []) for ex in exceptions)


def today_index(pool_size: int) -> int:
    """Index into the song pool that corresponds to today."""
    return (datetime.date.today() - EPOCH).days % pool_size

# ---------------------------------------------------------------------------
# Load all slugs (for leitmotif resolution, regardless of group filter)
# ---------------------------------------------------------------------------

def load_all_slugs() -> dict:
    slugs = {}
    for yaml_file in sorted(ALBUM_PATH.glob('*.yaml')):
        docs = load_yaml(yaml_file)
        album = next((d for d in docs if d and 'Album' in d), None)
        if not album:
            continue
        album_lacks_art = album.get('Has Track Art') is False
        album_name = yaml_file.stem
        for song in docs:
            if not song or 'Track' not in song:
                continue
            slug = get_track_slug(song, album, album_name)
            is_official = get_is_official(album, song, album_name)
            is_fandom = not is_official and 'Fandom' in album.get('Groups', [])
            if album_lacks_art or song.get('Has Cover Art') is False:
                image_url = f'https://media.hsmusic.wiki/album-art/{album_name}/cover.small.jpg'
            else:
                image_url = f'https://media.hsmusic.wiki/album-art/{album_name}/{slug}.small.jpg'
            key = f'track:{slug}'
            entry = {
                'name': song['Track'],
                'albumName': album['Album'],
                'isOfficial': is_official,
                'isFandom': is_fandom,
                'imageUrl': image_url,
            }
            if key not in slugs:
                slugs[key] = entry
    return slugs


# ---------------------------------------------------------------------------
# Scan valid songs from hsmusic-data
# ---------------------------------------------------------------------------

def scan_valid_songs(slugs_dict: dict, group_whitelist: Optional[list]) -> tuple:
    """
    Returns (songs, leitmotif_counter, official_slugs).
    songs: list of dicts with _dlUrl, _dlSource, _imageUrl private fields.
    group_whitelist: if set, only songs from these groups are included in songs list.
                     All albums are still scanned for leitmotif counting.
    """
    valid_songs = []
    official_slugs = []
    leitmotif_counter = Counter()

    for yaml_file in sorted(ALBUM_PATH.glob('*.yaml')):
        album_name = yaml_file.stem
        if album_name in EXCLUDED_ALBUMS:
            continue
        docs = load_yaml(yaml_file)
        album = next((d for d in docs if d and 'Album' in d), None)
        if not album:
            continue
        groups = album.get('Groups', [])
        if not any(g in INCLUDED_GROUPS for g in groups) or any(g in EXCLUDED_GROUPS for g in groups):
            continue

        album_lacks_art = album.get('Has Track Art') is False
        album_artists = docs[0].get('Artists', []) if docs else []

        for song in docs:
            if not song or 'Originally Released As' in song:
                continue
            if 'Track' not in song or 'URLs' not in song:
                continue

            song_name = song['Track']
            slug = get_track_slug(song, album, album_name)
            track_key = f'track:{slug}'
            is_official = get_is_official(album, song, album_name)
            is_fandom = not is_official and 'Fandom' in groups

            if is_official:
                official_slugs.append(track_key)

            # Leitmotif counting happens for ALL albums regardless of whitelist
            artists = list(song.get('Artists', album_artists))
            for i, a in enumerate(artists):
                if 'artist:' not in a:
                    artists[i] = f"artist:{normalize_wiki_string(re.sub(r'\([^)]*\)', '', a).strip())}"

            leitmotifs = []
            for ref in song.get('Referenced Tracks', []):
                lkey = ref if ref in slugs_dict else f'track:{normalize_wiki_string(ref)}'
                leitmotif_counter[lkey] += 1
                leitmotifs.append(lkey)

            samples = []
            for s in song.get('Sampled Tracks', []):
                samples.append(s if s in slugs_dict else f'track:{normalize_wiki_string(s)}')

            # Apply group whitelist for daily song eligibility
            in_whitelist = (
                group_whitelist is None
                or any(g in groups for g in group_whitelist)
            )
            if not in_whitelist:
                continue

            dl_url, dl_source = best_download_url(song['URLs'])
            if dl_url is None or slug in EXCLUDED_SONGS:
                continue

            wiki_url = f'https://hsmusic.wiki/track/{slug}'
            if album_lacks_art or song.get('Has Cover Art') is False:
                image_url = f'https://media.hsmusic.wiki/album-art/{album_name}/cover.small.jpg'
            else:
                image_url = f'https://media.hsmusic.wiki/album-art/{album_name}/{slug}.small.jpg'

            entry = {
                'slug': slug,
                'name': song_name,
                'artist': artists,
                'albumName': album['Album'],
                'leitmotifs': leitmotifs,
                'samples': samples,
                'nLeitmotifs': len(leitmotifs),
                'wikiUrl': wiki_url,
                'url': f'/audio/{slug}.mp3',
                'urlType': 'local',
                'imageUrl': f'/images/{slug}.jpg',
                'isOfficial': is_official,
                'isFandom': is_fandom,
                '_dlUrl': dl_url,
                '_dlSource': dl_source,
                '_imageUrl': image_url,
            }
            if slug not in {s['slug'] for s in valid_songs}:
                valid_songs.append(entry)

    return valid_songs, leitmotif_counter, official_slugs


# ---------------------------------------------------------------------------
# Filter songs to playable set
# ---------------------------------------------------------------------------

def filter_songs(songs: list, existing_slugs: set, leitmotif_counter: Counter,
                 official_slugs: list) -> list:
    official_counter = {
        lm: c for lm, c in leitmotif_counter.items()
        if lm in official_slugs and c >= RARE_THRESHOLD
    }
    common   = {lm for lm, c in leitmotif_counter.items() if c >= COMMON_THRESHOLD}
    uncommon = {lm for lm, c in leitmotif_counter.items() if UNCOMMON_THRESHOLD <= c < COMMON_THRESHOLD}
    rare     = {lm for lm, c in leitmotif_counter.items() if RARE_THRESHOLD <= c < UNCOMMON_THRESHOLD}
    guessable = common | uncommon | rare
    official_leitmotifs = {lm for lm in guessable if lm in official_counter}

    filtered = []
    for song in songs:
        if song.get('isOfficial'):
            continue  # Official (non-CC) songs are not playable; they may still appear as motifs
        if song['slug'] in existing_slugs:
            continue
        song_lms = set(song['leitmotifs'])
        for dm in DISCARDED_MOTIFS:
            song_lms.discard(f'track:{dm}')
        if len(song_lms) < MIN_LEITMOTIFS or song['nLeitmotifs'] > MAX_LEITMOTIFS:
            continue
        full_lms = set(song['leitmotifs'])
        n_official  = len(full_lms & official_leitmotifs)
        n_common_un = len((full_lms & common) - official_leitmotifs)
        if n_official >= 2 or (n_official >= 1 and n_common_un >= 2):
            filtered.append(song)

    return filtered


# ---------------------------------------------------------------------------
# Guesses array
# ---------------------------------------------------------------------------

def get_guesses_array(slugs_dict: dict, leitmotif_counter: Counter) -> list:
    guesses = []
    for slug, song in slugs_dict.items():
        if slug not in leitmotif_counter:
            continue
        count = leitmotif_counter[slug]
        entry = dict(song)
        entry['slug'] = slug
        bare = slug.replace('track:', '')
        # Use local image path (served by Express / CDN) instead of external URL
        entry['imageUrl'] = f'/images/{bare}.jpg'
        if count == 1:
            entry['rarity'] = 1
        elif count >= COMMON_THRESHOLD:
            entry['rarity'] = 5
        elif count >= UNCOMMON_THRESHOLD:
            entry['rarity'] = 4
        elif count >= RARE_THRESHOLD:
            entry['rarity'] = 3
        else:
            entry['rarity'] = 2
        if not entry['isOfficial']:
            entry['rarity'] = max(1, entry['rarity'] - 1)
        guesses.append(entry)
    return sorted(guesses, key=lambda k: (-k['rarity'], k['name']))


# ---------------------------------------------------------------------------
# CSV helpers (append-only)
# ---------------------------------------------------------------------------

def load_csv_slugs(path: Path) -> set:
    if not path.exists():
        return set()
    with open(path, newline='', encoding='utf8') as f:
        return {row['slug'] for row in csv.DictReader(f)}


def append_csv_rows(path: Path, fieldnames: list, rows: list):
    exists = path.exists()
    with open(path, 'a', newline='', encoding='utf8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not exists:
            writer.writeheader()
        writer.writerows(rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--groups', nargs='+', metavar='GROUP',
                        help='Whitelist groups for daily songs (e.g. canmt umspaf). '
                             'All albums are still parsed for leitmotif sourcing.')
    args = parser.parse_args()

    group_whitelist = args.groups  # None = all groups

    # Load existing game_songs.json (for resumability)
    existing_songs: list = []
    if GAME_SONGS_OUT.exists():
        existing_songs = json.loads(GAME_SONGS_OUT.read_text())
        print(f'Loaded {len(existing_songs)} existing songs from {GAME_SONGS_OUT.name}')
    else:
        # First run: seed from old_game_songs (day-sorted → preserved epoch order)
        if OLD_GAME_SONGS.exists():
            old = json.loads(OLD_GAME_SONGS.read_text())
            for s in old:
                existing_songs.append({
                    'slug': s['slug'],
                    'name': s['name'],
                    'artist': s['artist'],
                    'albumName': s['albumName'],
                    'leitmotifs': s['leitmotifs'],
                    'samples': s.get('samples', []),
                    'nLeitmotifs': s['nLeitmotifs'],
                    'wikiUrl': s['wikiUrl'],
                    'url': f'/audio/{s["slug"]}.mp3',
                    'urlType': 'local',
                    'imageUrl': f'/images/{s["slug"]}.jpg',
                    'isOfficial': s['isOfficial'],
                    'isFandom': s['isFandom'],
                })
            print(f'Seeded {len(existing_songs)} songs from legacy game_songs_old.json')

    existing_slugs = {s['slug'] for s in existing_songs}

    # Load existing CSV slugs (for resumability)
    dl_slugs_done    = load_csv_slugs(SONG_DL_CSV)
    image_slugs_done = load_csv_slugs(IMAGE_DL_CSV)

    # Scan hsmusic-data
    print('Scanning hsmusic-data…')
    slugs_dict = load_all_slugs()
    print(f'  {len(slugs_dict)} slugs indexed')

    songs, leitmotif_counter, official_slugs = scan_valid_songs(slugs_dict, group_whitelist)
    official_slugs += ['track:penumbra-phantasm', 'track:double-midnight']
    print(f'  {len(songs)} songs with downloadable URLs'
          + (f' (group filter: {group_whitelist})' if group_whitelist else ''))

    new_songs = filter_songs(songs, existing_slugs, leitmotif_counter, official_slugs)
    print(f'  {len(new_songs)} new songs after filtering')

    # Refresh leitmotifs/samples for existing songs using fresh scan data
    # (slug computation may have changed, e.g. Suffix Directory fixes)
    scanned_by_slug = {s['slug']: s for s in songs}
    refreshed = 0
    for song in existing_songs:
        fresh = scanned_by_slug.get(song['slug'])
        if fresh and (song.get('leitmotifs') != fresh['leitmotifs'] or
                      song.get('samples') != fresh.get('samples', [])):
            song['leitmotifs'] = fresh['leitmotifs']
            song['samples'] = fresh.get('samples', [])
            song['nLeitmotifs'] = len(fresh['leitmotifs'])
            refreshed += 1
    if refreshed:
        print(f'  Refreshed leitmotifs/samples for {refreshed} existing songs')

    # Insert new songs after today's current position so they appear ASAP
    if new_songs:
        if existing_songs:
            insert_pos = today_index(len(existing_songs)) + 1
        else:
            insert_pos = 0
        game_songs = existing_songs[:insert_pos] + new_songs + existing_songs[insert_pos:]
        print(f'  Inserted {len(new_songs)} songs at position {insert_pos} '
              f'(today = {insert_pos - 1 if insert_pos else 0})')
    else:
        game_songs = existing_songs
        print('  No new songs to add')

    # Build CSV maps BEFORE stripping private keys (new_songs share object refs with songs)
    scanned_dl    = {}
    scanned_image = {}
    for s in songs:
        if '_dlUrl'    in s and s['slug'] not in scanned_dl:
            scanned_dl[s['slug']]    = (s['_dlUrl'], s['_dlSource'])
        if '_imageUrl' in s and s['slug'] not in scanned_image:
            scanned_image[s['slug']] = s['_imageUrl']

    # Strip private keys from game_songs entries (mutates shared objects — done after map build)
    private_keys = {'_dlUrl', '_dlSource', '_imageUrl'}
    for s in game_songs:
        for k in private_keys:
            s.pop(k, None)

    # Write game_songs.json
    GAME_SONGS_OUT.write_text(json.dumps(game_songs, indent=2))
    print(f'Wrote {len(game_songs)} songs → {GAME_SONGS_OUT}')

    # Write game_motifs.json
    guesses = get_guesses_array(slugs_dict, leitmotif_counter)
    GAME_MOTIFS_OUT.write_text(json.dumps(guesses, indent=2))
    print(f'Wrote {len(guesses)} motifs → {GAME_MOTIFS_OUT}')

    # Fallback: old_game_songs URLs for slugs not found in current hsmusic-data scan
    old_by_slug = {}
    if OLD_GAME_SONGS.exists():
        for s in json.loads(OLD_GAME_SONGS.read_text()):
            old_by_slug[s['slug']] = s

    dl_rows    = []
    image_rows = []
    seen = set()
    for song in game_songs:
        slug = song['slug']
        if slug in seen:
            continue
        seen.add(slug)

        if slug not in dl_slugs_done:
            if slug in scanned_dl:
                url, src = scanned_dl[slug]
                dl_rows.append({'slug': slug, 'url': url, 'source': src})
            elif slug in old_by_slug and old_by_slug[slug].get('url'):
                old = old_by_slug[slug]
                dl_rows.append({'slug': slug, 'url': old['url'], 'source': old.get('urlType', 'unknown')})

        if slug not in image_slugs_done:
            if slug in scanned_image:
                image_rows.append({'slug': slug, 'url': scanned_image[slug]})
            elif slug in old_by_slug and old_by_slug[slug].get('imageUrl'):
                image_rows.append({'slug': slug, 'url': old_by_slug[slug]['imageUrl']})

    # Also queue images for motif-only tracks (leitmotifs not in playable song set)
    motif_image_rows = []
    for guess in guesses:
        bare = guess['slug'].replace('track:', '')
        if bare not in image_slugs_done and bare not in seen:
            orig_url = slugs_dict.get(guess['slug'], {}).get('imageUrl')
            if orig_url:
                motif_image_rows.append({'slug': bare, 'url': orig_url})
    image_rows.extend(motif_image_rows)

    if dl_rows:
        append_csv_rows(SONG_DL_CSV, ['slug', 'url', 'source'], dl_rows)
    if image_rows:
        append_csv_rows(IMAGE_DL_CSV, ['slug', 'url'], image_rows)

    total_dl    = len(dl_slugs_done) + len(dl_rows)
    total_image = len(image_slugs_done) + len(image_rows)
    print(f'song_downloads.csv:  {len(dl_rows)} new rows added ({total_dl} total)')
    print(f'image_downloads.csv: {len(image_rows)} new rows added ({total_image} total, {len(motif_image_rows)} motif-only)')

    # Summary
    sources = Counter(r['source'] for r in dl_rows)
    if sources:
        print(f'New sources: {dict(sources)}')


if __name__ == '__main__':
    main()
