import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3000/submit?preset=sample";
const out = process.argv[3] ?? "shot.png";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(url, { waitUntil: "networkidle" });
// Give 3Dmol time to fetch the PDB + render.
await page.waitForTimeout(4000);
await page.screenshot({ path: out, fullPage: false });
console.log("saved", out);
if (errors.length) console.log("CONSOLE ERRORS:\n" + errors.slice(0, 8).join("\n"));
await browser.close();
