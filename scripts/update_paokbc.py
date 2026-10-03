"""Player photos and profile details from the club site (paokbc.gr) into data/paokbc.json.

Run: python scripts/update_paokbc.py
Photos are linked from paokbc.gr, not copied into this repo.
"""
import html
import json
import os
import re
import urllib.request

BASE = "https://paokbc.gr"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "paokbc.json")


def fetch(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "Mozilla/5.0 (paok-basketball-site)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def text(fragment):
    return html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split()


def main():
    page = fetch("/en/the-team/players")
    players = {}
    for block in page.split('class="w3-cell player"')[1:]:
        link = re.search(r'href="(/en/the-team/players/player/\d+)"', block)
        photo = re.search(r'<img src="([^"]+/images/players/[^"]+)"', block)
        first = re.search(r'player-first-name">([^<]*)<', block)
        last = re.search(r'player-last-name">(.*?)</div>', block, re.S)
        if not (link and last):
            continue
        surname = " ".join(text(last.group(1)))
        name = f"{html.unescape(first.group(1)).strip()} {surname}".strip()
        entry = {"name": name, "photo": photo.group(1) if photo else None, "profile": BASE + link.group(1)}
        try:
            words = text(fetch(link.group(1)).split("BIOGRAPHY")[0])
            def after(label):
                parts = label.split()
                for i in range(len(words) - len(parts)):
                    if words[i:i + len(parts)] == parts:
                        nxt = words[i + len(parts):i + len(parts) + 3]
                        stop = {"DATE", "PLACE", "HEIGHT", "NATIONALITY", "BKT", "STOIXIMAN"}
                        out = []
                        for w in nxt:
                            if w in stop:
                                break
                            out.append(w)
                        return " ".join(out)
                return ""
            entry.update({"nationality": after("NATIONALITY"), "birthplace": after("PLACE OF BIRTH"),
                          "born": after("DATE OF BIRTH"), "height": after("HEIGHT")})
        except Exception as e:
            print("profile unavailable for", name, e)
        # key: surname letters only ("Mitrou - Long" -> "mitroulong"), matched the same way on the site
        players[re.sub(r"[^a-z]", "", surname.lower())] = entry
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(players, f, ensure_ascii=False, indent=1)
    print(f"paokbc.gr: {len(players)} players")


if __name__ == "__main__":
    main()
