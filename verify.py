"""Run browser and export checks without changing examples. See --help for review and recording."""
import argparse
import base64
import io
import json
import os
import random
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parent
FORMATS = [(1200, 630), (1000, 1000), (800, 1200)]
SVG = "{http://www.w3.org/2000/svg}"
OBJECTS = "#canvas g[data-id]"
BASELINE = "3df0740"
CHROME = Path(os.environ.get("CHROME_PATH", "C:/Program Files/Google/Chrome/Application/chrome.exe"))


def open_editor(page, root=ROOT):
    page.goto((root / "index.html").as_uri())
    expect(page.locator("#library button")).to_have_count(10)


def build_scene(page, mode, title):
    page.select_option("#mode", index=mode)
    page.fill("#query", title)
    page.click("#generate")


def snapshot(page):
    return page.locator(OBJECTS).evaluate_all("""layers => layers.map(node => ({
        id: node.dataset.id, key: node.dataset.key, role: node.dataset.role,
        transform: node.getAttribute('transform')
    }))""")


def geometry(page):
    return page.locator(OBJECTS).evaluate_all("""layers => layers.map(node => {
        const bounds = node.getBBox(), matrix = node.getCTM();
        const center = new DOMPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2).matrixTransform(matrix);
        return {id: node.dataset.id, center: [center.x, center.y],
          sides: [bounds.width * Math.hypot(matrix.a,matrix.b),
                  bounds.height * Math.hypot(matrix.c,matrix.d)]};
    })""")


def color_tokens(node):
    return {
        element.get(attribute).lower()
        for element in node.iter()
        for attribute in ("fill", "stroke", "stop-color")
        if re.fullmatch(r"#[0-9a-f]{6}", element.get(attribute, ""), flags=re.I)
    }


def inspect_svg(path, format_index, keys=None):
    root = ET.parse(path).getroot()
    width, height = FORMATS[format_index]
    assert root.tag == SVG + "svg", root.tag
    assert root.attrib["viewBox"].split() == ["0", "0", str(width), str(height)]
    assert (root.get("width"), root.get("height")) == (str(width), str(height))
    assert next(root.iter(SVG + "image"), None) is None, "Raster element in vector export"
    assert next(root.iter(SVG + "foreignObject"), None) is None, "Unexpected HTML element in SVG"
    assert next(root.iter(SVG + "script"), None) is None, "Script in SVG"
    ids = [element.get("id") for element in root.iter() if element.get("id")]
    assert len(ids) == len(set(ids)), "Layer/pattern IDs collide"
    references = {
        reference
        for node in root.iter()
        for value in node.attrib.values()
        for reference in re.findall(r"url\(\s*#([^)\s]+)\s*\)", value)
    }
    references.update(value[1:] for node in root.iter() for attr, value in node.attrib.items()
                      if attr.split("}")[-1] == "href" and value.startswith("#"))
    assert references <= set(ids), f"Missing SVG reference: {references - set(ids)}"
    assert all(not name.startswith("data-") for node in root.iter() for name in node.attrib)
    if keys is not None:
        layer_groups = [group for group in root.iter(SVG + "g")
                        if re.fullmatch(r"item-[a-z]+-\d+", group.get("id", ""))]
        assert [group.get("id").split("-")[1] for group in layer_groups] == keys
        for group in layer_groups:
            title = group.findtext(SVG + "title")
            assert title and title.strip()
            assert next(group.iter(SVG + "path"), None) is not None, f"Missing vector paths in {title}"
    return root


def download(page, target):
    with page.expect_download() as event:
        page.click("#save")
    event.value.save_as(target)
    return target


def click_layer(page, target):
    hit = page.locator(f'#canvas g[data-id="{target}"]').evaluate("""layer => {
        const box = layer.getBoundingClientRect();
        for (let y=0.15; y<0.9; y+=0.12) for (let x=0.15; x<0.9; x+=0.12) {
            const px=box.left+box.width*x, py=box.top+box.height*y;
            if(layer.contains(document.elementFromPoint(px,py))) return [px,py];
        }
        return null;
    }""")
    assert hit is not None, f"No visible pixel for {target}"
    return hit


def verify_selection_and_history(page):
    build_scene(page, 1, "Монета, книгу, монета")
    original = snapshot(page)
    assert [layer["key"] for layer in original] == ["coin", "book", "coin"], original
    assert original[0]["transform"] != original[2]["transform"]
    book = original[1]["id"]
    hit = click_layer(page, book)
    page.mouse.move(*hit)
    page.mouse.down()
    page.mouse.move(hit[0] + 32, hit[1] + 17, steps=6)
    page.mouse.up()
    moved = snapshot(page)
    assert moved[1]["transform"] != original[1]["transform"]
    assert (moved[0], moved[2]) == (original[0], original[2])
    page.click('[data-op="rotate"]')
    turned = snapshot(page)
    assert turned[1]["transform"] != moved[1]["transform"]
    page.click("#undo")
    assert snapshot(page) == moved
    page.click("#redo")
    assert snapshot(page) == turned
    page.click("#library button[title='Добавить: Лампа']")
    added = snapshot(page)
    assert added[:3] == turned and added[-1]["key"] == "lamp", added
    page.click('[data-op="copy"]')
    assert [layer["key"] for layer in snapshot(page)] == ["coin", "book", "coin", "lamp", "lamp"]
    page.check("#mono")
    assert snapshot(page)[-1]["role"] == "background"
    page.click('[data-op="rear"]')
    assert snapshot(page)[0]["role"] == "background"
    page.click('[data-op="front"]')
    assert snapshot(page)[-1]["role"] == "background"
    page.click('[data-op="remove"]')
    assert snapshot(page) == added
    page.click("#undo")
    assert len(snapshot(page)) == 5


def apply_layout(page, variant):
    page.click("#vary")
    expect(page.locator("#layout-dialog")).to_be_visible()
    page.locator("#layout-dialog [data-variant]").nth(variant).click()
    page.click("#apply-layout")
    expect(page.locator("#layout-dialog")).to_be_hidden()
    page.wait_for_function("layoutDraft === null")


def verify_layout(page):
    build_scene(page, 1, "Букет, монета, наушники")
    initial = snapshot(page)
    for format_index, (width, height) in enumerate(FORMATS):
        page.select_option("#format", index=format_index)
        expect(page.locator("#canvas")).to_have_attribute("viewBox", f"0 0 {width} {height}")
        proposed = []
        for choice in range(3):
            apply_layout(page, choice)
            state = snapshot(page)
            assert [o["id"] for o in state] == [o["id"] for o in initial]
            proposed.append(tuple(o["transform"] for o in state))
        assert len(set(proposed)) == 3, f"Format {width}×{height}: indistinguishable layouts"
    page.click("#vary")
    page.locator("#layout-dialog [data-variant]").first.click()
    page.click("#cancel-layout")
    page.wait_for_function("layoutDraft === null")
    assert tuple(o["transform"] for o in snapshot(page)) == proposed[-1]
    large = geometry(page)
    page.select_option("#detail", index=1)
    small = geometry(page)
    for original, variant in zip(large, small, strict=True):
        assert original["id"] == variant["id"]
        # SVG variant dimensions differ by rounding. The visual bounding boxes
        # may vary slightly, but switching detail must not shift a layer on stage.
        assert max(abs(a - b) for a, b in zip(original["center"], variant["center"])) < 4, (original, variant)
        assert abs(max(original["sides"]) / max(variant["sides"]) - 1) < 0.03, (original, variant)
    page.select_option("#detail", index=0)
    assert geometry(page) == large


def verify_palette(page, scratch):
    before = snapshot(page)
    svg_before = inspect_svg(download(page, scratch / "before.svg"), 2, [o["key"] for o in before])
    source = json.loads((ROOT / "palette.json").read_text(encoding="utf-8-sig"))
    page.set_input_files("#upload", ROOT / "palette.json")
    expect(page.locator("#palette-dialog")).to_be_visible()
    page.click("#cancel-palette")
    expect(page.locator("#palette-dialog")).to_be_hidden()
    page.wait_for_function("paletteDraft === null")
    assert color_tokens(inspect_svg(download(page, scratch / "cancel.svg"), 2)) == color_tokens(svg_before)
    assert snapshot(page) == before
    page.set_input_files("#upload", ROOT / "palette.json")
    expect(page.locator("#palette-dialog")).to_be_visible()
    page.click("#apply-palette")
    page.wait_for_function("paletteDraft === null")
    assert snapshot(page) == before
    svg_after = inspect_svg(download(page, scratch / "after.svg"), 2, [o["key"] for o in before])
    assert color_tokens(svg_after) != color_tokens(svg_before)
    background_colors = set()
    framing = svg_after.find(SVG + "g")
    assert framing is not None
    for child in framing:
        if not child.get("id", "").startswith("item-"):
            background_colors |= color_tokens(child)
    assert set(source["colors"][4:7]).isdisjoint(background_colors), background_colors
    page.set_input_files("#upload", {"name": "bad.json", "mimeType": "application/json", "buffer": b"{}"})
    expect(page.locator("#status")).to_contain_text(re.compile("палитр|цвет|JSON", re.I))
    assert snapshot(page) == before
    assert color_tokens(inspect_svg(download(page, scratch / "invalid.svg"), 2)) == color_tokens(svg_after)


def verify_browser(browser, scratch):
    context = browser.new_context(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
    page = context.new_page()
    errors = []
    external = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: external.append(request.url) if request.url.startswith(("https://", "http://")) else None)
    open_editor(page)
    build_scene(page, 0, "Музыка в дороге без смартфона")
    assert any(layer["key"] == "phones" for layer in snapshot(page))
    assert all(layer["key"] != "phone" for layer in snapshot(page))
    saved = snapshot(page)
    build_scene(page, 0, "Карта извержений вулканов")
    assert snapshot(page) == saved
    expect(page.locator("#status")).to_contain_text(re.compile("связ|най|библиотек|подход", re.I))
    build_scene(page, 1, "Книгу, дирижабль")
    assert [o["key"] for o in snapshot(page)] == ["book"]
    expect(page.locator("#status")).to_contain_text("дирижабль")
    verify_selection_and_history(page)
    verify_layout(page)
    verify_palette(page, scratch)
    draft = snapshot(page)
    page.reload()
    assert snapshot(page) == draft, "Scene lost after reload"
    expect(page.locator("#palette option:checked")).to_have_text("Шалфей")
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    build_scene(page, 1, "Книга, папка")
    inspect_svg(download(page, scratch / "small-screen.svg"), 2, ["book", "folder"])
    assert not errors, errors
    assert not external, external
    context.close()
    print("PASS: title exclusions, explicit quantities/forms, pointer and transforms, history and reload, three layouts, S/L normalization, palette preview/import, mobile and editable SVG.")


def rasterize_svg(page, path):
    source = base64.b64encode(path.read_bytes()).decode("ascii")
    page.set_content(f"""<body style='margin:0'>
      <img class="drawing" src="data:image/svg+xml;base64,{source}"
      style="display:block;max-width:260px;max-height:182px"></body>""")
    return Image.open(io.BytesIO(page.locator(".drawing").screenshot())).convert("RGB")


def compare_layouts(browser, scratch, destination):
    archive = subprocess.check_output(["git", "-C", str(ROOT), "archive", "--format=zip", BASELINE])
    old_root = scratch / "baseline"
    with ZipFile(io.BytesIO(archive)) as bundle:
        bundle.extractall(old_root)
    old_page, page, render = browser.new_page(), browser.new_page(), browser.new_page()
    open_editor(old_page, old_root)
    open_editor(page)
    cases = ["Книга, телефон", "Лампа, кошелёк, монета", "Букет, наушники", "Ручка, папка, книга"]
    pairs = Image.new("RGB", (1200, 1338), "#f6f4ef")
    draw = ImageDraw.Draw(pairs)
    try:
        font = ImageFont.truetype("arial.ttf", 15)
    except OSError:
        font = ImageFont.truetype("DejaVuSans.ttf", 15)
    order = random.Random(762)
    key = []
    for prompt_index, prompt in enumerate(cases):
        for format_index, (width, height) in enumerate(FORMATS):
            position = prompt_index * 3 + format_index
            x, y = position % 2 * 600, position // 2 * 223
            entries = []
            for version, editor in [("v1", old_page), ("v2", page)]:
                editor.select_option("#format", index=format_index)
                build_scene(editor, 1, prompt)
                path = download(editor, scratch / f"{version}-{position}.svg")
                entries.append((version, rasterize_svg(render, path)))
            order.shuffle(entries)
            draw.text((x + 16, y + 7), f"{position+1}. {prompt} · {width}×{height}", font=font, fill="#242724")
            for i, (version, frame) in enumerate(entries):
                left = x + 16 + i * 288
                pairs.paste(frame, (left + (260-frame.width)//2, y + 31 + (182-frame.height)//2))
                draw.text((left, y + 203), "A" if i == 0 else "B", font=font, fill="#242724")
            key.append({"pair": position + 1, "prompt": prompt, "format": [width, height],
                        "A": entries[0][0], "B": entries[1][0]})
    destination.parent.mkdir(parents=True, exist_ok=True)
    pairs.save(destination)
    destination.with_suffix(".json").write_text(json.dumps(key, ensure_ascii=False, indent=2), encoding="utf-8")
    for tab in [old_page, page, render]:
        tab.close()
    print(f"Blind review saved to {destination}. Answer key is adjacent.")


def main():
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--review", type=Path, help="Write 12 unlabelled comparisons and an answer key")
    args = command.parse_args()
    with sync_playwright() as driver, TemporaryDirectory() as temp:
        browser = driver.chromium.launch(executable_path=CHROME if CHROME.exists() else None)
        scratch = Path(temp)
        if args.review:
            compare_layouts(browser, scratch, args.review)
        else:
            verify_browser(browser, scratch)
        browser.close()


if __name__ == "__main__":
    main()
