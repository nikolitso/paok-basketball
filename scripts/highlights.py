"""Find PAOK highlight videos on the two channels that post them and add them to data/highlights.json.

Run after update_eurocup.py and update_gbl.py:  python scripts/highlights.py

- EuroCup games: the Novasports channel (titles like "Μπόσνα - ΠΑΟΚ: 72-75 (MD 2, 06/10/2026)")
- Greek League / cups: the SPORT FM TV channel (titles like "ΠΑΟΚ - Δόξα Λευκάδας 86-73 | HIGHLIGHTS | ...")

A video is matched to a played PAOK game by its final score (in the right home/away order) and the side PAOK is on
in the title. Existing entries (including ones added by hand) are never changed. Only the channels' latest uploads
are checked, so this runs nightly.
"""
import json
import os
import re
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "highlights.json")

CHANNELS = [
    # (handle, competitions it covers)
    ("novasports", {"EuroCup"}),
    ("sportfmtv", {"GBL", "Greek Cup", "Greek Super Cup"}),
]
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": "SOCS=CAI; CONSENT=YES+cb",  # skip the cookie-consent page
}


def plain(s):
    return "".join(ch for ch in unicodedata.normalize("NFD", s.upper()) if unicodedata.category(ch) != "Mn")


def latest_videos(handle, search=None):
    """(video id, title) for the channel's most recent uploads (Videos page), or for a search within the channel."""
    url = f"https://www.youtube.com/@{handle}/videos"
    if search:
        url = f"https://www.youtube.com/@{handle}/search?query={urllib.parse.quote(search)}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        page = r.read().decode("utf-8", errors="replace")
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", page, re.S)
    if not m:
        return []
    found, seen = [], set()

    def walk(node):
        if isinstance(node, dict):
            lockup = node.get("lockupViewModel")  # current channel-page layout
            if isinstance(lockup, dict) and lockup.get("contentId") not in seen:
                text = (((lockup.get("metadata") or {}).get("lockupMetadataViewModel") or {}).get("title") or {}).get("content")
                if text:
                    seen.add(lockup["contentId"])
                    found.append((lockup["contentId"], text))
            vid = node.get("videoId")
            title = node.get("title")
            if vid and isinstance(title, dict) and vid not in seen:
                text = title.get("simpleText") or "".join(run.get("text", "") for run in title.get("runs", []))
                if text:
                    seen.add(vid)
                    found.append((vid, text))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(json.loads(m.group(1)))
    return found


def match(title, games):
    """The played game a highlight title refers to, or None."""
    t = plain(title)
    if "ΠΑΟΚ" not in t and "PAOK" not in t:
        return None
    if "WBL" in t or "ΓΥΝΑΙΚ" in t:  # women's league
        return None
    pairs = [(int(a), int(b)) for a, b in re.findall(r"(?<!\d)(\d{2,3})\s*[-–]\s*(\d{2,3})(?!\d)", t)]
    if not pairs:
        return None
    # the dash between the team names has spaces around it ("Μπόσνα - ΠΑΟΚ", "ΜΥΚΟΝΟΣ – ΠΑΟΚ"); the score's dash doesn't
    sep = re.search(r"\s[-–]\s", t)
    pos = t.find("ΠΑΟΚ") if "ΠΑΟΚ" in t else t.find("PAOK")
    paok_first = sep is None or pos < sep.start()
    for a, b in pairs:
        us, them = (a, b) if paok_first else (b, a)
        hits = [g for g in games if g["played"] and g["us"] == us and g["them"] == them]
        if len(hits) == 1:
            return hits[0]
    return None


def main():
    games = []
    for name in ("eurocup.json", "gbl.json"):
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            games += json.load(f)["games"]
    highlights = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            highlights = json.load(f)
    added = 0
    import sys
    wanted = set(sys.argv[1:]) or {"EuroCup", "GBL"}
    for handle, comps in CHANNELS:
        if not comps & (wanted | ({"Greek Cup", "Greek Super Cup"} if "GBL" in wanted else set())):
            continue
        try:
            # latest uploads plus a channel search for PAOK (busy channels push older highlights off the first page)
            videos = latest_videos(handle) + latest_videos(handle, search="ΠΑΟΚ")
        except Exception as e:
            print(f"{handle}: unavailable ({e})")
            continue
        pool = [g for g in games if g["comp"] in comps]
        for vid, title in videos:
            if handle == "sportfmtv" and "HIGHLIGHTS" not in plain(title):
                continue  # the channel also posts single-play clips with the game in the title
            g = match(title, pool)
            if g and str(g["code"]) not in highlights:
                highlights[str(g["code"])] = f"https://www.youtube.com/watch?v={vid}"
                added += 1
                print(f"{handle}: {g['comp']} {g['round']} vs {g['opp']} -> {title}")
        print(f"{handle}: checked {len(videos)} videos")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(highlights, f, ensure_ascii=False, indent=1)
    print(f"highlights: {added} added, {sum(1 for k in highlights if not k.startswith('_'))} games with a video")


if __name__ == "__main__":
    main()
