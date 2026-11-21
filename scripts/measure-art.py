"""Compute immutable source-alpha masks used only for optical layout scoring."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
with sync_playwright() as driver:
    browser = driver.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe")
    page = browser.new_page()
    page.goto((root / "index.html").as_uri())
    metrics = page.evaluate("""async () => {
      const output = {};
      for (const [key, vectors] of Object.entries(ART)) {
        if (key === 'back') continue;
        output[key] = [];
        for (const source of vectors) {
          const image = new Image();
          image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 96;
          const context = canvas.getContext('2d', {willReadFrequently:true});
          context.drawImage(image, 0, 0, 96, 96);
          const pixels = context.getImageData(0, 0, 96, 96).data;
          let sum = 0, x = 0, y = 0;
          const bins = Array.from({length:16}, () => Array(16).fill(0));
          for (let row=0;row<96;row++) for (let col=0;col<96;col++) {
            const alpha=pixels[(row*96+col)*4+3]/255;
            sum+=alpha; x+=(col+.5)*alpha; y+=(row+.5)*alpha;
            bins[Math.floor(row/6)][Math.floor(col/6)]+=alpha;
          }
          output[key].push({
            x:Number((x/sum/96).toFixed(5)),y:Number((y/sum/96).toFixed(5)),
            area:Number((sum/9216).toFixed(5)),
            rows:bins.map(row=>row.map(value=>Math.round(value/36*15).toString(16)).join(''))
          });
        }
      }
      return output;
    }""")
    browser.close()
text = "'use strict';\n// Derived from original vector alpha only. No artwork is replaced.\nconst ArtMetrics = " + json.dumps(metrics,ensure_ascii=False,indent=2) + ";\n"
(root / "art-metrics.js").write_text(text,encoding="utf-8")
print("Measured", sum(map(len, metrics.values())), "original SVG variants.")
