// scraper_sites.mjs - version avec extracteurs par site

import fs from "fs";
import playwright from "playwright";

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

// --- Extractors ---

async function extractBienici(page,url){
  const cards = await page.$$('div.resultListItem');
  const rows = [];
  for(const el of cards){
    try{
      const titre = (await el.$eval('h2', n=>n.innerText)).trim();
      const prix_txt = await el.$eval('.price', n=>n.innerText).catch(()=>null);
      const prix_num = price(prix_txt||"");
      const pieces_txt = await el.$eval('.typology', n=>n.innerText).catch(()=>null);
      const pieces = pieces_txt?.match(/T(\d+)/i)?.[1] || null;
      rows.push({url, titre, prix_num, pieces, source:'bienici'});
    }catch(e){}
  }
  return rows;
}

async function extractLogicImmo(page,url){
  const cards = await page.$$('div.card-list article');
  const rows = [];
  for(const el of cards){
    try{
      const titre = (await el.$eval('h2', n=>n.innerText)).trim();
      const prix_txt = await el.$eval('.price', n=>n.innerText).catch(()=>null);
      const prix_num = price(prix_txt||"");
      const pieces_txt = await el.$eval('.itemRooms', n=>n.innerText).catch(()=>null);
      const pieces = pieces_txt?.match(/(\d+)/)?.[1] || null;
      rows.push({url, titre, prix_num, pieces, source:'logicimmo'});
    }catch(e){}
  }
  return rows;
}

async function extractLeboncoin(page,url){
  const cards = await page.$$('li[data-test-id="adCard"]');
  const rows = [];
  for(const el of cards){
    try{
      const titre = (await el.$eval('p[data-test-id="ad-title"]', n=>n.innerText)).trim();
      const prix_txt = await el.$eval('span[data-test-id="ad-price"]', n=>n.innerText).catch(()=>null);
      const prix_num = price(prix_txt||"");
      const pieces_txt = await el.$eval('p[data-test-id="ad-attributes"]', n=>n.innerText).catch(()=>null);
      const pieces = pieces_txt?.match(/(\d+)\s?pi[eè]c/i)?.[1] || null;
      rows.push({url, titre, prix_num, pieces, source:'leboncoin'});
    }catch(e){}
  }
  return rows;
}

async function extractPAP(page,url){
  const cards = await page.$$('div.search-list-item');
  const rows = [];
  for(const el of cards){
    try{
      const titre = (await el.$eval('h2', n=>n.innerText)).trim();
      const prix_txt = await el.$eval('.item-price', n=>n.innerText).catch(()=>null);
      const prix_num = price(prix_txt||"");
      const pieces_txt = await el.$eval('.item-tags', n=>n.innerText).catch(()=>null);
      const pieces = pieces_txt?.match(/(\d+)/)?.[1] || null;
      rows.push({url, titre, prix_num, pieces, source:'pap'});
    }catch(e){}
  }
  return rows;
}

async function extractEP(page,url){
  const cards = await page.$$('article.annonce');
  const rows = [];
  for(const el of cards){
    try{
      const titre = (await el.$eval('h2', n=>n.innerText)).trim();
      const prix_txt = await el.$eval('.prix', n=>n.innerText).catch(()=>null);
      const prix_num = price(prix_txt||"");
      const pieces_txt = await el.$eval('.caracteristiques', n=>n.innerText).catch(()=>null);
      const pieces = pieces_txt?.match(/(\d+)/)?.[1] || null;
      rows.push({url, titre, prix_num, pieces, source:'entreparticuliers'});
    }catch(e){}
  }
  return rows;
}

// --- Dispatcher ---
async function extract(page,url){
  const host = new URL(url).hostname.replace(/^www\./,'');
  if(host.includes("bienici.com")) return extractBienici(page,url);
  if(host.includes("logic-immo.com")) return extractLogicImmo(page,url);
  if(host.includes("leboncoin.fr")) return extractLeboncoin(page,url);
  if(host.includes("pap.fr")) return extractPAP(page,url);
  if(host.includes("entreparticuliers.com")) return extractEP(page,url);
  return [];
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
      console.log("👉", rows.length, "annonces trouvées sur", url);
      all.push(...rows);

      // Pagination (si bouton suivant dispo)
      let hasNext = true;
      while (hasNext) {
        const nextBtn = await page.$("a[rel=next], .pagination-next, button[aria-label=Suivant]");
        if (!nextBtn) { hasNext = false; break; }
        await nextBtn.click();
        await page.waitForTimeout(2000);
        await autoScroll(page);
        const moreRows = await extract(page, url);
        console.log("👉 +", moreRows.length, "annonces supplémentaires");
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
