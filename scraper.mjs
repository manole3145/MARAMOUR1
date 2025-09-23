// scraper.mjs - version corrigée avec logs, scroll complet, pagination et dédup multi-plateformes

import fs from "fs";
import playwright from "playwright";

const MAX_BUDGET = 1200;

// --- Utils ---

function price(txt) {
  const m = (txt||"").match(/(\d[\d\s]{2,})\s*€?/);
  return m ? parseInt(m[1].replace(/\s/g, ""), 10) : null;
}

function dedup(rows){
  const seen = new Set();
  return rows.filter(r => {
    const titreNorm = (r.titre||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,20);
    const key = [
      (r.commune||'').toLowerCase(),
      r.prix_num||'',
      r.surface||'',
      r.pieces||'',
      titreNorm
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if(totalHeight >= scrollHeight){
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

// --- Extraction générique simplifiée ---
// (à adapter par site si nécessaire)
async function extract(page, url) {
  const host = new URL(url).hostname.replace(/^www\./,'');
  const cards = await page.$$("article, li, .search-result, .listing-item");
  const rows = [];
  for (const el of cards) {
    try {
      const txt = (await el.innerText()) || "";
      const titre = txt.split("\n")[0].trim();
      const prix_num = price(txt);
      const pieces = (txt.match(/T(\d+)/i) || txt.match(/(\d+)\s?pi[eè]c/i))?.[1] || null;
      rows.push({url, titre, prix_num, pieces, source: host});
    } catch(e){}
  }
  return rows;
}

// --- Main ---
async function main(){
  const links = fs.readFileSync("data/links.txt","utf-8").trim().split(/\r?\n/);
  const browser = await playwright.chromium.launch({headless:true});
  const page = await browser.newPage();
  let all = [];

  for(const url of links){
    try{
      console.log("Scrape:", url);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await autoScroll(page);
      await page.waitForTimeout(1200);

      const rows = await extract(page, url);
      console.log("👉 Annonces brutes page 1:", rows.length);
      all.push(...rows);

      // Pagination basique
      let hasNext = true;
      while (hasNext) {
        const nextBtn = await page.$("a[rel=next], .pagination-next, button[aria-label=Suivant]");
        if (!nextBtn) { hasNext = false; break; }
        await nextBtn.click();
        await page.waitForTimeout(2000);
        await autoScroll(page);
        const moreRows = await extract(page, url);
        console.log("👉 Annonces supplémentaires:", moreRows.length);
        all.push(...moreRows);
      }
    } catch(e) {
      console.error("Erreur", url, e.message);
    }
  }

  console.log("🔎 Total brut avant dédup:", all.length);
  all = dedup(all);
  console.log("✅ Total après dédup:", all.length);

  fs.writeFileSync("data/annonces.json", JSON.stringify(all,null,2),"utf-8");
  await browser.close();
}

main();
