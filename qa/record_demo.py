"""Record the real browser workflow and optionally regenerate the three release SVGs."""
import argparse
import base64
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
import sys

from playwright.sync_api import Error, expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify import CHROME, ROOT, click_layer, download, inspect_svg, open_editor, snapshot


def pause(page, milliseconds):
    if not examples_only:
        page.wait_for_timeout(milliseconds)


class Recording:
    def __init__(self, page, folder):
        self.page = page
        self.folder = folder
        self.session = page.context.new_cdp_session(page)
        self.frames = []
        self.active = False
        self.session.on("Page.screencastFrame", self.on_frame)

    def on_frame(self, event):
        if not self.active:
            return
        index = len(self.frames)
        frame = self.folder / f"frame-{index:05d}.jpg"
        self.frames.append((frame.name, perf_counter()))
        frame.write_bytes(base64.b64decode(event["data"]))
        try:
            self.session.send("Page.screencastFrameAck", {"sessionId": event["sessionId"]})
        except Error:
            if self.active:
                raise

    def begin(self):
        self.active = True
        self.session.send("Page.startScreencast", {"format": "jpeg", "quality": 91, "everyNthFrame": 1})

    def end(self, output):
        end = perf_counter()
        self.active = False
        self.session.send("Page.stopScreencast")
        self.session.detach()
        assert len(self.frames) > 30, f"Only {len(self.frames)} frames captured"
        playlist = self.folder / "frames.txt"
        with playlist.open("w", encoding="ascii") as manifest:
            for index, (filename, timestamp) in enumerate(self.frames):
                next_capture = self.frames[index+1][1] if index+1 < len(self.frames) else end
                manifest.write(f"file {filename}\noption framerate 120\nduration {max(next_capture - timestamp, 0.001):.4f}\n")
            manifest.write(f"file {self.frames[-1][0]}\noption framerate 120\n")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(playlist),
                        "-vf", "fps=20,format=yuv420p", "-c:v", "libx264", "-crf", "20",
                        "-movflags", "+faststart", str(output)], check=True)
        print(f"Recorded {end-self.frames[0][1]:.1f} seconds from the running editor: {output}")


def point_at(page, selector):
    button = page.locator(selector).first
    button.scroll_into_view_if_needed()
    box = button.bounding_box()
    assert box is not None, selector
    page.mouse.move(box["x"] + box["width"]/2, box["y"] + box["height"]/2, steps=12)
    pause(page, 360)


def live_click(page, selector):
    point_at(page, selector)
    page.mouse.click(*page.evaluate("window.demoPointer"))
    pause(page, 420)


def caption(page, text, milliseconds=3500):
    page.locator("#demo-caption").evaluate("(node, text) => {node.textContent=text}", text)
    pause(page, milliseconds)


def demo_overlays(page):
    page.evaluate("""() => {
      const pointer = document.createElement('div');
      pointer.setAttribute('aria-hidden', 'true');
      pointer.style.cssText='position:fixed;left:0;top:0;width:15px;height:15px;border:2px solid #fff;background:#1f2321;border-radius:50%;box-shadow:0 0 0 1px #1f2321;pointer-events:none;z-index:9000;display:none';
      const message = document.createElement('div');
      message.id='demo-caption';
      message.style.cssText='position:fixed;bottom:12px;left:50%;transform:translateX(-50%);color:#fff;background:#212722ed;padding:8px 16px;border-radius:6px;max-width:72vw;width:max-content;font:600 14px/1.3 system-ui;z-index:8999;pointer-events:none';
      document.body.append(pointer, message);
      document.addEventListener('pointermove', e => {
        window.demoPointer=[e.clientX,e.clientY];
        Object.assign(pointer.style,{display:'block',transform:'translate('+(e.clientX-7)+'px,'+(e.clientY-7)+'px)'});
      });
    }""")


def submit(page, title):
    point_at(page, "#query")
    page.mouse.click(*page.evaluate("window.demoPointer"))
    page.keyboard.press("Control+a")
    page.keyboard.insert_text(title)
    pause(page, 1300)
    live_click(page, "#generate")


def release_example(page, scratch, index, name):
    target = scratch / name
    point_at(page, "#save")
    download(page, target)
    inspect_svg(target, index, [layer["key"] for layer in snapshot(page)])
    pause(page, 1700)
    return target


def record(browser, scratch, args):
    context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = context.new_page()
    open_editor(page)
    demo_overlays(page)
    recording = None if args.examples_only else Recording(page, scratch)
    if recording:
        recording.begin()
    caption(page, "Из заголовка — в векторную иллюстрацию", 3800)
    submit(page, "Учусь управлять деньгами")
    caption(page, "Заголовок подсказывает тему и набор предметов", 3800)
    live_click(page, "#vary")
    expect(page.locator("#layout-dialog")).to_be_visible()
    caption(page, "Сравниваем три композиции из тех же предметов", 3800)
    live_click(page, "#layout-dialog [data-variant]:nth-child(2)")
    live_click(page, "#apply-layout")
    page.wait_for_function("layoutDraft === null")
    example_one = release_example(page, scratch, 0, "01-learning-budget.svg")

    caption(page, "По списку можно указать несколько одинаковых предметов", 3000)
    page.select_option("#mode", index=1)
    page.select_option("#format", index=1)
    submit(page, "Лампа, книга, две ручки")
    selected = snapshot(page)[-1]["id"]
    px, py = click_layer(page, selected)
    page.mouse.move(px, py, steps=10)
    page.mouse.down()
    page.mouse.move(px + 25, py - 16, steps=14)
    page.mouse.up()
    live_click(page, '[data-op="rotate"]')
    caption(page, "Ручная правка сохраняет остальные слои на месте", 3400)
    example_two = release_example(page, scratch, 1, "02-desk.svg")

    caption(page, "Вертикальная версия с более простой детализацией", 3000)
    page.select_option("#format", index=2)
    page.select_option("#detail", index=1)
    submit(page, "Букет, наушники, телефон")
    page.set_input_files("#upload", ROOT / "palette.json")
    expect(page.locator("#palette-dialog")).to_be_visible()
    caption(page, "Проверяем загруженную палитру перед применением", 4500)
    live_click(page, "#apply-palette")
    page.wait_for_function("paletteDraft === null")
    example_three = release_example(page, scratch, 2, "03-spring-audio.svg")

    caption(page, "Экспорт SVG сохраняет предметы отдельными векторными группами", 3000)
    markup = """<body style="margin:0;height:100vh;display:grid;place-items:center;background:#eeeee8">
      <img alt="Скачанная композиция" style="display:block;width:auto;height:86vh"
      src="data:image/svg+xml;base64,IMAGE">
    </body>""".replace("IMAGE", base64.b64encode(example_three.read_bytes()).decode("ascii"))
    page.set_content(markup)
    demo_overlays(page)
    caption(page, "Скачанный SVG открыт отдельно от редактора", 6100)
    if recording:
        recording.end(args.out)
    if args.examples or args.examples_only:
        for result in [example_one, example_two, example_three]:
            shutil.copyfile(result, ROOT / "examples" / result.name)
    context.close()


def main():
    global examples_only
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="Destination for the continuously recorded MP4")
    parser.add_argument("--examples", action="store_true", help="Also replace the examples in the project")
    parser.add_argument("--examples-only", action="store_true", help="Rebuild SVGs without recording a video")
    args = parser.parse_args()
    examples_only = args.examples_only
    if not args.out and not args.examples_only:
        parser.error("Pass --out or --examples-only.")
    if args.out:
        args.out = args.out.resolve()
        args.out.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as driver, TemporaryDirectory() as temp:
        browser = driver.chromium.launch(executable_path=CHROME if CHROME.exists() else None)
        record(browser, Path(temp), args)
        browser.close()


if __name__ == "__main__":
    main()
