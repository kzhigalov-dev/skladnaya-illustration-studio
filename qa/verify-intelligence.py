"""Verify the actual model dialog and editable result; optionally exercise cached WebGPU."""
import argparse
import json
import os
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--url', default='http://127.0.0.1:8183/')
    args.add_argument('--webgpu', action='store_true', help='Use the browser model; first run downloads about 5 GB')
    args.add_argument('--profile', type=Path, default=Path(tempfile.gettempdir()) / 'skladnaya-model-qa')
    options = args.parse_args()
    chrome = os.environ.get('CHROME_PATH', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
    with sync_playwright() as p:
        if options.webgpu:
            proxy = os.environ.get('MODEL_QA_PROXY')
            settings = {'proxy': {'server': proxy, 'bypass': 'localhost,127.0.0.1'}} if proxy else {}
            context = p.chromium.launch_persistent_context(str(options.profile), executable_path=chrome,
                                                          headless=True, **settings)
            browser = None
        else:
            browser = p.chromium.launch(executable_path=chrome, headless=True)
            context = browser.new_context()
        try:
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto((ROOT / 'index.html').as_uri())
            page.fill('#query', 'Открываем новую главу')
            before = page.locator('#canvas').inner_html()
            page.click('#deep-analyze')
            page.click('#start-intelligence')
            expect(page.locator('#intelligence-status')).to_contain_text('локальный сервер')
            assert page.locator('#canvas').inner_html() == before
            page.click('#cancel-intelligence')
            page.goto(options.url)
            if options.webgpu:
                page.route('**/api/capabilities', lambda route: route.fulfill(
                    status=200, content_type='application/json', body='{"localModel":false}'))
            else:
                assert page.request.get(options.url.rstrip('/') + '/api/capabilities').json()['localModel']
            page.fill('#query', 'Открываем новую главу')
            page.click('#deep-analyze')
            page.click('#start-intelligence')
            start = time.monotonic()
            timeout = 360 if options.webgpu else 90
            while not page.locator('#intelligence-result').is_visible() and time.monotonic() - start < timeout:
                print(json.dumps({'elapsed': round(time.monotonic()-start),
                                  'status': page.locator('#intelligence-status').inner_text()}, ensure_ascii=True), flush=True)
                if page.locator('#start-intelligence').is_enabled():
                    raise AssertionError(page.locator('#intelligence-status').inner_text())
                page.wait_for_timeout(5000 if options.webgpu else 1000)
            expect(page.locator('#intelligence-result')).to_be_visible()
            expect(page.locator('#apply-intelligence')).to_be_visible()
            page.click('#apply-intelligence')
            expect(page.locator('#intelligence-dialog')).not_to_be_visible()
            assert page.locator('#canvas g[data-id][data-key="book"]').count() > 0
            assert not errors, errors
            print('PASS: file guidance, real model preview, apply, editable book layer, no page errors', flush=True)
        finally:
            context.close()
            if browser:
                browser.close()


if __name__ == '__main__':
    main()
