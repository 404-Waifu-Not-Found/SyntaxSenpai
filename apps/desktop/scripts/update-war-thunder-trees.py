"""Refresh the bundled War Thunder Wiki research trees, RP costs, and icon atlases.

Run from the repository root with Python 3 and Pillow:
    python apps/desktop/scripts/update-war-thunder-trees.py

Pass --html-dir DIR to read wt-<category>.html files instead of downloading category pages.
Individual vehicle pages and icon images are cached in the system temporary folder.
Use --refresh-details to replace cached vehicle pages and icons with current Wiki data.
The generated file contains vehicle names, ranks, positions, prerequisites,
AB/RB/SB battle ratings, purchase prices, and research costs. Small official slot icons are
packed into local WebP atlases; no article text or full-size artwork is copied.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone
import tempfile
import time
from urllib.request import Request, urlopen

from PIL import Image, ImageOps


CATEGORIES = {
    "aviation": "https://wiki.warthunder.com/aviation",
    "helicopters": "https://wiki.warthunder.com/helicopters",
    "ground": "https://wiki.warthunder.com/ground",
    "ships": "https://wiki.warthunder.com/ships",
    "boats": "https://wiki.warthunder.com/boats",
}
OUTPUT = Path(__file__).resolve().parents[1] / "src/renderer/src/data/war-thunder-tech-trees.json"
ATLAS_DIR = Path(__file__).resolve().parents[1] / "src/renderer/src/assets/war-thunder"
ICON_WIDTH = 96
ICON_HEIGHT = 42
ATLAS_COLUMNS = 16
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


class Node:
    def __init__(self, tag, attrs):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []


class TreeParser(HTMLParser):
    def __init__(self, root_id=None, root_class=None):
        super().__init__(convert_charrefs=True)
        self.root_id = root_id
        self.root_class = root_class
        self.root = None
        self.stack = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if not self.stack:
            if tag == "div" and ((self.root_id and attributes.get("id") == self.root_id) or (self.root_class and self.root_class in attributes.get("class", "").split())):
                self.root = Node(tag, attrs)
                self.stack.append(self.root)
            return
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_endtag(self, tag):
        if not self.stack:
            return
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, value):
        if self.stack:
            self.stack[-1].children.append(value)


def descendants(node):
    for child in node.children:
        if isinstance(child, Node):
            yield child
            yield from descendants(child)


def has_class(node, class_name):
    return class_name in node.attrs.get("class", "").split()


def first(node, predicate):
    return next((child for child in descendants(node) if predicate(child)), None)


def text_content(node):
    if node is None:
        return ""
    parts = []
    for child in node.children:
        parts.append(text_content(child) if isinstance(child, Node) else child)
    return re.sub(r"\s+", " ", html.unescape("".join(parts))).strip()


def wiki_metadata(page):
    match = re.search(r"window\.WT_UnitList\s*=\s*'([^']*)';", page, re.DOTALL)
    if not match:
        raise ValueError("War Thunder Wiki unit list was not found")
    result = {}
    for row in json.loads(match.group(1)):
        details = row[7] if len(row) > 7 and isinstance(row[7], list) else []
        role = details[0][1] if details and isinstance(details[0], list) and len(details[0]) > 1 else ""
        price = details[1] if len(details) > 1 and isinstance(details[1], list) else []
        entry = {
            "name": html.unescape(str(row[1])).replace("\u00a0", " "),
            "rank": int(row[3]),
            "role": str(role),
        }
        br_codes = row[4] if isinstance(row[4], dict) else {}
        brs = {
            mode: round(1 + code // 3 + (0, 0.3, 0.7)[code % 3], 1)
            for mode in ("ab", "rb", "sb")
            for code in [br_codes.get(mode)]
            if isinstance(code, int)
        }
        if brs:
            entry["brs"] = brs
        if "rb" in brs:
            entry["rb"] = brs["rb"]
        if len(price) >= 3 and isinstance(price[0], (int, float)) and price[2] in ("w", "g"):
            entry["purchase"] = int(price[0])
            entry["currency"] = "SL" if price[2] == "w" else "GE"
        result[str(row[0])] = entry
    return result


def parse_category(category, page):
    parser = TreeParser(root_id="wt-unit-trees")
    parser.feed(page)
    if not parser.root:
        raise ValueError("War Thunder Wiki research tree was not found for " + category)
    metadata = wiki_metadata(page)
    tab_names = {}
    for tab in descendants(parser.root):
        country = tab.attrs.get("data-tree-target")
        if country:
            tab_names[country] = text_content(tab)

    used_units = {}
    groups = {}

    def register_item(item):
        unit_id = item.attrs.get("data-unit-id")
        if not unit_id:
            return None
        unit = dict(metadata.get(unit_id, {}))
        if not unit:
            label = first(item, lambda node: has_class(node, "wt-tree_item-text"))
            unit = {"name": text_content(label)}
        requirement = item.attrs.get("data-unit-req")
        if requirement:
            unit["requires"] = requirement
        icon = first(item, lambda node: has_class(node, "wt-tree_item-icon"))
        icon_style = html.unescape(icon.attrs.get("style", "")) if icon else ""
        icon_match = re.search(r"background-image\s*:\s*url\(['\"]?([^'\")]+)", icon_style)
        if icon_match:
            unit["_iconUrl"] = icon_match.group(1)
        used_units[unit_id] = unit
        return unit_id

    def parse_cell(td):
        group = first(td, lambda node: has_class(node, "wt-tree_group"))
        if group:
            group_id = group.attrs.get("data-unit-id", "")
            folder = first(group, lambda node: has_class(node, "wt-tree_group-folder_inner"))
            label = first(folder, lambda node: has_class(node, "wt-tree_item-text")) if folder else None
            group_name = text_content(label)
            group_info = {"name": group_name}
            if group.attrs.get("data-unit-req"):
                group_info["requires"] = group.attrs["data-unit-req"]
            if group_id:
                groups[group_id] = group_info
            group_items = first(group, lambda node: has_class(node, "wt-tree_group-items"))
            items = [register_item(item) for item in descendants(group_items) if has_class(item, "wt-tree_item")] if group_items else []
            cell = {"items": [item for item in items if item], "group": group_id, "label": group_name}
        else:
            items = [register_item(item) for item in descendants(td) if has_class(item, "wt-tree_item")]
            cell = {"items": [item for item in items if item]} if items else None
        if cell and td.attrs.get("colspan"):
            cell["span"] = int(td.attrs["colspan"])
        return cell

    def parse_table(table):
        if table is None:
            return []
        rows = []
        for tr in descendants(table):
            if tr.tag != "tr":
                continue
            cells = [parse_cell(td) for td in tr.children if isinstance(td, Node) and td.tag == "td"]
            if any(cell for cell in cells):
                rows.append(cells)
        return rows

    nations = []
    for tree in descendants(parser.root):
        nation_id = tree.attrs.get("data-tree-id")
        if not nation_id or not has_class(tree, "unit-tree"):
            continue
        instance = first(tree, lambda node: has_class(node, "wt-tree_instance"))
        if instance is None:
            continue
        ranks = []
        rank_name = ""
        for section in instance.children:
            if not isinstance(section, Node):
                continue
            if has_class(section, "wt-tree_r-header"):
                label = first(section, lambda node: has_class(node, "wt-tree_r-header_label"))
                match = re.search(r"Rank\s+([IVX]+)", text_content(label))
                if match:
                    rank_name = match.group(1)
            elif has_class(section, "wt-tree_rank") and rank_name:
                tables = [node for node in descendants(section) if node.tag == "table" and has_class(node, "wt-tree_rank-instance")]
                research = parse_table(tables[0]) if tables else []
                premium = parse_table(tables[1]) if len(tables) > 1 else []
                if research or premium:
                    ranks.append({"rank": rank_name, "research": research, "premium": premium})
        if ranks:
            nations.append({"id": nation_id, "name": tab_names.get(nation_id, nation_id.title()), "ranks": ranks})

    if not nations or not used_units:
        raise ValueError("No nations or vehicles were parsed for " + category)
    return {"id": category, "url": CATEGORIES[category], "nations": nations, "units": used_units, "groups": groups}


def research_cost(page):
    parser = TreeParser(root_class="game-unit_card-info")
    parser.feed(page)
    if parser.root is None:
        raise ValueError("Vehicle detail card was not found")
    for item in descendants(parser.root):
        if not has_class(item, "game-unit_card-info_item"):
            continue
        title = first(item, lambda node: has_class(node, "game-unit_card-info_title"))
        if text_content(title) != "Research":
            continue
        value = first(item, lambda node: has_class(node, "game-unit_card-info_value"))
        match = re.search(r"\b[\d,]+\b", text_content(value))
        return int(match.group().replace(",", "")) if match else None
    return None


def fetch_cached(url, path, expected_type, refresh=False):
    if not refresh and path.exists() and path.stat().st_size:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "SyntaxSenpai-WarThunderTreeSnapshot/1.0"})
            with urlopen(request, timeout=35) as response:
                content_type = response.headers.get("Content-Type", "")
                if expected_type not in content_type:
                    raise ValueError("Unexpected content type {} for {}".format(content_type, url))
                content = response.read()
            if not content:
                raise ValueError("Empty response for " + url)
            temporary = path.with_suffix(path.suffix + ".download")
            temporary.write_bytes(content)
            temporary.replace(path)
            return path
        except Exception:
            if attempt == 2:
                temporary = path.with_suffix(path.suffix + ".download")
                subprocess.check_call([
                    "curl", "--fail", "--location", "--silent", "--show-error",
                    "--retry", "3", "--max-time", "90", "--output", str(temporary), url,
                ])
                content = temporary.read_bytes()
                if expected_type == "image/png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("Invalid PNG for " + url)
                if expected_type == "text/html" and b"game-unit_card-info" not in content:
                    raise ValueError("Invalid vehicle page for " + url)
                temporary.replace(path)
                return path
            time.sleep(attempt + 1)


def enrich_category(category, cache_dir, refresh_details=False):
    units = category["units"]
    futures = {}
    with ThreadPoolExecutor(max_workers=20) as executor:
        for unit_id, unit in units.items():
            if not re.fullmatch(r"[A-Za-z0-9_.-]+", unit_id):
                raise ValueError("Unexpected vehicle ID " + unit_id)
            icon_url = unit.pop("_iconUrl", "")
            if not icon_url.startswith("https://static.encyclopedia.warthunder.com/slots/"):
                raise ValueError("Missing or unexpected icon URL for " + unit_id)
            detail_path = cache_dir / "units" / (unit_id + ".html")
            icon_path = cache_dir / "slots" / (unit_id + ".png")
            futures[executor.submit(fetch_cached, "https://wiki.warthunder.com/unit/" + unit_id, detail_path, "text/html", refresh_details)] = (unit_id, "detail")
            futures[executor.submit(fetch_cached, icon_url, icon_path, "image/png", refresh_details)] = (unit_id, "icon")
        completed = 0
        failures = []
        for future in as_completed(futures):
            unit_id, kind = futures[future]
            try:
                path = future.result()
                if kind == "detail":
                    cost = research_cost(path.read_text(encoding="utf-8"))
                    if cost is not None:
                        units[unit_id]["researchRp"] = cost
            except Exception as error:
                failures.append("{} {}: {}".format(unit_id, kind, error))
            completed += 1
            if completed % 250 == 0:
                print("{}: fetched {}/{} details/icons".format(category["id"], completed, len(futures)), flush=True)
    if failures:
        raise RuntimeError("Failed to fetch {} items:\n{}".format(len(failures), "\n".join(failures[:20])))

    atlas_width = ATLAS_COLUMNS * ICON_WIDTH
    atlas_height = ((len(units) + ATLAS_COLUMNS - 1) // ATLAS_COLUMNS) * ICON_HEIGHT
    atlas = Image.new("RGBA", (atlas_width, atlas_height), (0, 0, 0, 0))
    for index, (unit_id, unit) in enumerate(units.items()):
        with Image.open(cache_dir / "slots" / (unit_id + ".png")) as source:
            thumbnail = ImageOps.contain(source.convert("RGBA"), (ICON_WIDTH, ICON_HEIGHT), Image.Resampling.LANCZOS)
        x = (index % ATLAS_COLUMNS) * ICON_WIDTH + (ICON_WIDTH - thumbnail.width) // 2
        y = (index // ATLAS_COLUMNS) * ICON_HEIGHT + (ICON_HEIGHT - thumbnail.height) // 2
        atlas.alpha_composite(thumbnail, (x, y))
        unit["iconIndex"] = index
    ATLAS_DIR.mkdir(parents=True, exist_ok=True)
    atlas_path = ATLAS_DIR / (category["id"] + ".webp")
    atlas.save(atlas_path, format="WEBP", quality=83, method=6)
    print("{}: {} RP costs, atlas {} bytes".format(category["id"], sum("researchRp" in unit for unit in units.values()), atlas_path.stat().st_size), flush=True)


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--html-dir", type=Path, help="Read wt-<category>.html snapshots from this directory")
    arguments.add_argument("--cache-dir", type=Path, default=Path(tempfile.gettempdir()) / "syntax-senpai-war-thunder-cache", help="Cache individual vehicle pages and icons")
    arguments.add_argument("--refresh-details", action="store_true", help="Download vehicle pages and icons again even if cached")
    options = arguments.parse_args()
    categories = []
    for category, url in CATEGORIES.items():
        if options.html_dir:
            page = (options.html_dir / ("wt-" + category + ".html")).read_text(encoding="utf-8")
        else:
            page = subprocess.check_output(["curl", "--fail", "--location", "--silent", "--show-error", "--max-time", "90", url]).decode("utf-8")
        parsed = parse_category(category, page)
        enrich_category(parsed, options.cache_dir, options.refresh_details)
        categories.append(parsed)
        print("{}: {} nations, {} vehicles".format(category, len(parsed["nations"]), len(parsed["units"])))
    snapshot = {"snapshotDate": datetime.now(timezone.utc).date().isoformat(), "source": "War Thunder Wiki", "categories": categories}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("Wrote {} ({:,} bytes)".format(OUTPUT, OUTPUT.stat().st_size))


if __name__ == "__main__":
    main()
