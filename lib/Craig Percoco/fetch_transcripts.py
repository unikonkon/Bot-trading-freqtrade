#!/usr/bin/env python3
"""Pull English captions of a channel's latest videos into one Markdown file per video (text only).

Usage:
    python3 fetch_transcripts.py                      # latest 10 of @craig_percoco
    python3 fetch_transcripts.py --count 20
    python3 fetch_transcripts.py --channel https://www.youtube.com/@xyz/videos --out ./xyz

Videos whose .md already exists in the output folder are skipped, so re-running only fetches what is missing.
HTTP 429 (YouTube rate limit) is retried with a growing wait; if it still fails, run again later.
Needs yt-dlp on PATH.
"""
import argparse, html, json, os, re, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))


def list_latest(channel, count):
    r = subprocess.run(['yt-dlp', '--no-update', '--flat-playlist', '--playlist-end', str(count),
                        '--print', '%(id)s', channel], capture_output=True, text=True)
    ids = [l.strip() for l in r.stdout.splitlines() if l.strip()]
    if not ids: sys.exit(f'could not list videos:\n{r.stderr}')
    return ids


def fetch_subs(vid, workdir, tries, wait):
    """Download <vid>.en.vtt + <vid>.info.json into workdir; True on success."""
    for k in range(1, tries + 1):
        r = subprocess.run(['yt-dlp', '--no-update', '--skip-download', '--write-subs', '--write-auto-subs',
                            '--sub-langs', 'en', '--sub-format', 'vtt', '--write-info-json',
                            '-o', os.path.join(workdir, '%(id)s.%(ext)s'), '--',
                            f'https://www.youtube.com/watch?v={vid}'], capture_output=True, text=True)
        if os.path.exists(os.path.join(workdir, f'{vid}.en.vtt')): return True
        err = re.search(r'HTTP Error \d+[^\n]*|ERROR:[^\n]*', r.stderr)
        err = err.group(0) if err else 'no English captions'
        if '429' not in err:
            print(f'  {vid}: {err}'); return False
        if k < tries:
            print(f'  {vid}: 429, wait {wait * k}s (try {k}/{tries})'); time.sleep(wait * k)
    print(f'  {vid}: still 429 after {tries} tries'); return False


def sec(ts):
    h, m, s = ts.split(':'); return int(h) * 3600 + int(m) * 60 + float(s)


def fmt(s):
    return f'{int(s // 3600):02d}:{int(s % 3600 // 60):02d}:{int(s % 60):02d}'


def to_markdown(vid, workdir):
    info = json.load(open(os.path.join(workdir, f'{vid}.info.json'), encoding='utf-8'))
    manual = any(k.startswith('en') for k in info.get('subtitles', {}))
    segs, prev = [], None
    for b in open(os.path.join(workdir, f'{vid}.en.vtt'), encoding='utf-8').read().split('\n\n'):
        lines = b.strip('\n').split('\n')
        if not lines or '-->' not in lines[0]: continue
        start, body = sec(lines[0].split(' --> ')[0]), lines[1:]
        if not manual:  # rolling auto captions: only the line carrying word timings is new text
            body = [l for l in body if '<c>' in l or re.search(r'<\d\d:', l)]
        for l in body:
            t = html.unescape(re.sub(r'<[^>]+>', '', l)).strip()
            if t and t != prev: segs.append((start, t)); prev = t
    paras, cur, cs = [], [], None  # 60 s paragraphs
    for s, t in segs:
        if cs is None or s - cs >= 60:
            if cur: paras.append((cs, ' '.join(cur)))
            cur, cs = [], s
        cur.append(t.lstrip('> ').strip())
    if cur: paras.append((cs, ' '.join(cur)))
    ud = info.get('upload_date') or ''
    date = f'{ud[:4]}-{ud[4:6]}-{ud[6:]}' if ud else '-'
    out = [f"# {info['title']}", '',
           f"- Channel: {info.get('channel', '')}",
           f"- Link: https://www.youtube.com/watch?v={vid}",
           f"- Date: {date}",
           f"- Length: {info.get('duration_string', '-')}",
           f"- Source: YouTube {'manual' if manual else 'auto-generated'} English captions"
           + ('' if manual else ' — may contain mis-heard words'),
           '', '---', '']
    for s, text in paras: out += [f'[{fmt(s)}] {text}', '']
    title = re.sub(r'[\\/:*?"<>|]+', ' ', info['title']).strip()[:90]
    return f'{date} {title} - {vid}.md', '\n'.join(out) + '\n', len(paras)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--channel', default='https://www.youtube.com/@craig_percoco/videos')
    ap.add_argument('--count', type=int, default=10)
    ap.add_argument('--out', default=HERE)
    ap.add_argument('--tries', type=int, default=4)
    ap.add_argument('--wait', type=int, default=90, help='seconds; grows ×try on each 429')
    ap.add_argument('--gap', type=int, default=20, help='seconds between videos')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    have = {m.group(1) for f in os.listdir(a.out) if (m := re.search(r' - ([\w-]{11})\.md$', f))}
    ids = list_latest(a.channel, a.count)
    todo = [v for v in ids if v not in have]
    print(f'{len(ids)} latest, {len(ids) - len(todo)} already saved, {len(todo)} to fetch')
    ok = 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, vid in enumerate(todo):
            if i: time.sleep(a.gap)
            if not fetch_subs(vid, tmp, a.tries, a.wait): continue
            name, text, n = to_markdown(vid, tmp)
            open(os.path.join(a.out, name), 'w', encoding='utf-8').write(text)
            ok += 1; print(f'  OK {name} ({n} paragraphs)')
    print(f'done: {ok}/{len(todo)} fetched' + ('' if ok == len(todo) else ' — run again later for the rest'))


if __name__ == '__main__':
    main()
