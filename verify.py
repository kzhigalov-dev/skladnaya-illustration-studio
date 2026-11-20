"""Browser smoke test and generation of the three submission examples."""
from pathlib import Path
import os
import xml.etree.ElementTree as ET
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
shots = []
with sync_playwright() as pw, TemporaryDirectory() as tmp:
    chrome = os.environ.get("CHROME_PATH", "C:/Program Files/Google/Chrome/Application/chrome.exe")
    browser = pw.chromium.launch(executable_path=chrome if Path(chrome).exists() else None)
    page = browser.new_page(viewport={"width": 1440, "height": 950}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto((root/"index.html").as_uri())
    def shot(label):
        path = Path(tmp)/f"{len(shots)}.png"
        page.screenshot(path=path)
        frame = Image.open(path).convert("RGB")
        shots.append(frame)
    def export(name):
        with page.expect_download() as event:
            page.click("#save")
        path = root/"examples"/(name+".svg")
        event.value.save_as(path)
        tree = ET.parse(path)
        ids = [n.get("id") for n in tree.iter() if n.get("id")]
        assert len(ids) == len(set(ids))
        assert len(tree.findall(".//{*}path")) > 10
        assert not tree.findall(".//{*}image")
    assert page.locator("#library button").count() == 10
    assert page.locator("#layers button").count() == 3
    shot("Тема"); export("01-learning-budget")
    page.select_option("#mode",index=1)
    page.fill("#query","лампа, ручка, книга")
    page.click("#generate")
    page.select_option("#palette",index=1)
    page.select_option("#format",index=1)
    shot("Предметы"); export("02-desk")
    page.click("[data-op=copy]"); assert page.locator("#layers button").count()==4
    page.check("#mono"); page.click("[data-op=rotate]"); page.click("[data-op=rear]")
    page.click("[data-op=remove]"); assert page.locator("#layers button").count()==3
    page.fill("#query","букет, наушники, телефон");page.click("#generate")
    page.select_option("#format",index=2);page.select_option("#detail",index=1)
    page.set_input_files("#upload",root/"palette.json")
    page.wait_for_function("document.querySelector('#palette').selectedIndex===3")
    page.click("#vary");shot("Своя палитра");export("03-spring-audio")
    page.set_input_files("#upload",{"name":"bad.json","mimeType":"application/json","buffer":b"{}"})
    page.wait_for_function("document.querySelector('#status').textContent.includes('Нужен JSON')")
    assert not errors,errors
    browser.close()
shots[0].save(root/"demo.gif",save_all=True,append_images=shots[1:],duration=2400,loop=0)
print("PASS: browser, palette validation, editor, three vector downloads.")
