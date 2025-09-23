// scraper.mjs — multi-sites: Bienici, Logic-Immo, Leboncoin, PAP, AVendreALouer, EntreParticuliers + fallback
import fs from "fs";
import { chromium } from "playwright";

const MAX_BUDGET = 1200;

function toAbs(href, base) { try { return new URL(href, base).toString(); } catch { return href; } }
function normalize(t) { return (t || "").replace(/\s+/g, " ").trim(); }
function price(txt) { const m = (txt||"").match(/(\d[\d\s]{2,})\s*€?/); return m ? parseInt(m[1].replace(/\s/g, ""), 10) : null; }
function isHouse(t) { return /maison|villa|pavillon/i.test(t || ""); }
function okRooms(txt) { return /([4-7]\s?pi[eè]ce|T[4-7])/i.test(txt || ""); }
function okBudget(p) { return p == null ? true : p <= MAX_BUDGET; }
function getHost(u){ try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } }
function setLoc(r, { commune, cp } = {}) { if (commune && !r.commune) r.commune = commune; if (cp && !r.cp_zone) r.cp_zone = cp; return r; }
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
); }

async function extractBienici(page, baseUrl){
  await page.waitForSelector("[data-testid='results-list'] article, [data-testid='result-list'] article", {timeout: 8000}).catch(()=>{});
  const cards = await page.$$("[data-testid='results-list'] article, [data-testid='result-list'] article, article");
  const out=[];
  for (const el of cards){
    try{
      const a = await el.$("a[href]"); if(!a) continue;
      const url = toAbs(await a.getAttribute("href"), baseUrl);
      const all = normalize(await el.innerText());
      const titre = normalize(all);
      const prix_num = price(all);
      const pieces = all.match(/T\s?[4-7]/i)?.[0] || all.match(/([4-7])\s?pi[eè]ces?/i)?.[0] || null;
      const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;
      let commune=null, cp=null;
      const addrEl = await el.$("[data-testid='address'], [class*='Address'], [class*='address']");
      if(addrEl){
        const addr = normalize(await addrEl.innerText());
        const m = addr.match(/(.+?)\s*\((\d{5})\)/) || addr.match(/^([A-Za-zÀ-ÖØ-öø-ÿ \-']+)$/);
        if(m){ commune=(m[1]||m[0]).trim(); cp = m[2] || cp; }
      }
      // Filtrage désactivé: garder toutes les annonces
      out.push(setLoc({url,titre,prix_num,prix:prix_num?new Intl.NumberFormat("fr-FR").format(prix_num)+" €":null,surface:surf,pieces,source:getHost(baseUrl)}, {commune,cp}));
    }catch{}
  }
  return out;
}

async function extractLogicImmo(page, baseUrl){
  await page.waitForSelector("article a[href], li a[href]", {timeout: 8000}).catch(()=>{});
  const cards = await page.$$("article, li");
  const out=[];
  for(const el of cards){
    try{
      const a=await el.$("a[href]"); if(!a) continue;
      const url = toAbs(await a.getAttribute("href"), baseUrl);
      const all = normalize(await el.innerText());
      const titre = normalize(all);
      const prix_num = price(all);
      const pieces = all.match(/T\s?[4-7]/i)?.[0] || all.match(/([4-7])\s?pi[eè]ces?/i)?.[0] || null;
      const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;
      let commune=null, cp=null;
      const locMatch = all.match(/([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\s*\((\d{5})\)/) || all.match(/à\s+([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\b/);
      if(locMatch){ commune=(locMatch[1]||"").trim(); const mcp = all.match(/\b(\d{5})\b/); if(mcp) cp=mcp[1]; }
      // Filtrage désactivé: garder toutes les annonces
      out.push(setLoc({url,titre,prix_num,prix:prix_num?new Intl.NumberFormat("fr-FR").format(prix_num)+" €":null,surface:surf,pieces,source:getHost(baseUrl)}, {commune,cp}));
    }catch{}
  }
  return out;
}

// Leboncoin — peut filtrer les bots. On “attend” la liste et on lit le texte des cartes.
async function extractLeboncoin(page, baseUrl){
  await page.waitForSelector("[data-qa-id='aditem_container'] a,[data-qa-id='aditem-title']", {timeout: 12000}).catch(()=>{});
  const cards = await page.$$("[data-qa-id='aditem_container'], a[data-qa-id='aditem_container'], article");
  const out=[];
  for(const el of cards){
    try{
      const a = await el.$("a[href]");
      if(!a) continue;
      const url = toAbs(await a.getAttribute("href"), baseUrl);
      const all = normalize(await el.innerText());
      const titre = normalize(all);
      const prix_num = price(all);
      const pieces = all.match(/T\s?[4-7]/i)?.[0] || all.match(/([4-7])\s?pi[eè]ces?/i)?.[0] || null;
      const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;
      // Ville/CP souvent dans le bloc localisation (Ville (CP))
      let commune=null, cp=null;
      const loc = all.match(/([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\s*\((\d{5})\)/);
      if(loc){ commune=loc[1].trim(); cp=loc[2]; }
      // Filtrage désactivé: garder toutes les annonces
      out.push(setLoc({url,titre,prix_num,prix:prix_num?new Intl.NumberFormat("fr-FR").format(prix_num)+" €":null,surface:surf,pieces,source:getHost(baseUrl)}, {commune,cp}));
    }catch{}
  }
  return out;
}

async function extractPAP(page, baseUrl){
  await page.waitForSelector("article a[href], li a[href]", {timeout: 10000}).catch(()=>{});
  const cards = await page.$$("article, li, .search-results__item");
  const out=[];
  for(const el of cards){
    try{
      const a=await el.$("a[href]"); if(!a) continue;
      const url=toAbs(await a.getAttribute("href"), baseUrl);
      const all=normalize(await el.innerText());
      const titre=normalize(all);
      const prix_num=price(all);
      const pieces=all.match(/T\s?[4-7]/i)?.[0] || all.match(/([4-7])\s?pi[eè]ces?/i)?.[0] || null;
      const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;
      let commune=null, cp=null;
      const locMatch = all.match(/([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\s*\((\d{5})\)/) || all.match(/à\s+([A-Za-zÀ-ÖØ-öø-ÿ \-']+)/);
      if(locMatch){ commune=(locMatch[1]||"").trim(); const mcp=all.match(/\b(\d{5})\b/); if(mcp) cp=mcp[1]; }
      // Filtrage désactivé: garder toutes les annonces
      out.push(setLoc({url,titre,prix_num,prix:prix_num?new Intl.NumberFormat("fr-FR").format(prix_num)+" €":null,surface:surf,pieces,source:getHost(baseUrl)}, {commune,cp}));
    }catch{}
  }
  return out;
}

async function extractAVendreALouer(page, baseUrl){
  await page.waitForSelector("article a[href], li a[href]", {timeout: 10000}).catch(()=>{});
  const cards = await page.$$("article, li, .search-list__item, .listing-item");
  const out=[];
  for(const el of cards){
    try{
      const a=await el.$("a[href]"); if(!a) continue;
      const url=toAbs(await a.getAttribute("href"), baseUrl);
      const all=normalize(await el.innerText());
      const titre=normalize(all);
      const prix_num=price(all);
      const pieces=all.match(/T\s?[4-7]/i)?.[0] || all.match(/([4-7])\s?pi[eè]ces?/i)?.[0] || null;
      const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;
      let commune=null, cp=null;
      const locMatch = all.match(/([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\s*\((\d{5})\)/) || all.match(/à\s+([A-Za-zÀ-ÖØ-öø-ÿ \-']+)/);
      if(locMatch){ commune=(locMatch[1]||"").trim(); const mcp=all.match(/\b(\d{5})\b/); if(mcp) cp=mcp[1]; }
      // Filtrage désactivé: garder toutes les annonces
      out.push(setLoc({url,titre,prix_num,prix:prix_num?new Intl.NumberFormat("fr-FR").format(prix_num)+" €":null,surface:surf,pieces,source:getHost(baseUrl)}, {commune,cp}));
    }catch{}
  }
  return out;
}

async function extractEntreParticuliers(page, baseUrl){
  await page.waitForSelector("article a[href], li a[href], .annonce a[href]", { timeout: 8000 }).catch(()=>{});
  const cards = await page.$$("article, li, .annonce, .search-result, .result");
  const out=[];
  for(const el of cards){
    try{
      const a=await el.$("a[href]"); if(!a) continue;
      const url=toAbs(await a.getAttribute("href"), baseUrl);
      const all=normalize(await el.innerText());
      const titre=normalize(all);
      const prix_num=price(all);
      const pieces=all.match(/T\s?[4-7]/i)?.[0] || all.match(/([4-7])\s?pi[eè]ces?/i)?.[0] || null;
      const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;
      let commune = (all.match(/à\s+([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\b/)?.[1]||"").trim() || null;
      let cp = all.match(/\b(\d{5})\b/)?.[1] || null;
      // Filtrage désactivé: garder toutes les annonces
      out.push(setLoc({url,titre,prix_num,prix:prix_num?new Intl.NumberFormat("fr-FR").format(prix_num)+" €":null,surface:surf,pieces,source:getHost(baseUrl)}, {commune,cp}));
    }catch{}
  }
  return out;
}

async function extractGeneric(page, baseUrl){
  const cards=await page.$$("article, li, div");
  const out=[];
  for(const el of cards){
    try{
      const a=await el.$("a[href]"); if(!a) continue;
      const url=toAbs(await a.getAttribute("href"), baseUrl);
      const all=normalize(await el.innerText());
      const titre=normalize(all);
      const prix_num=price(all);
      const pieces=all.match(/T\s?[4-7]/i)?.[0] || all.match(/([4-7])\s?pi[eè]ces?/i)?.[0] || null;
      const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;
      let commune=(all.match(/à\s+([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\b/)?.[1]||"").trim()||null;
      let cp=all.match(/\b(\d{5})\b/)?.[1]||null;
      // Filtrage désactivé: garder toutes les annonces
      out.push(setLoc({url,titre,prix_num,prix:prix_num?new Intl.NumberFormat("fr-FR").format(prix_num)+" €":null,surface:surf,pieces,source:getHost(baseUrl)}, {commune,cp}));
    }catch{}
  }
  return out;
}

async function extract(page, url){
  const host=getHost(url);
  if(host==="bienici.com") return extractBienici(page, url);
  if(host==="logic-immo.com") return extractLogicImmo(page, url);
  if(host==="leboncoin.fr") return extractLeboncoin(page, url);
  if(host==="pap.fr") return extractPAP(page, url);
  if(host==="avendrealouer.fr") return extractAVendreALouer(page, url);
  if(host==="entreparticuliers.com") return extractEntreParticuliers(page, url);
  return extractGeneric(page, url);
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

async function main(){
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const links = fs.readFileSync("data/links.txt","utf-8").split("\n").map(s=>s.trim()).filter(Boolean);
  let all=[];
  for(const url of links){
    try{
      console.log("Scrape:", url);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      // léger scroll pour déclencher le lazy-load
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(1200);
      const rows = await extract(page, url);
console.log("👉 Annonces brutes page 1:", rows.length);
all.push(...rows);

    }catch(e){
      console.error("Erreur", url, e.message);
    }
  }

  console.log('🔎 Total brut avant dédup:', all.length);
  all = dedup(all);
  console.log('✅ Total après dédup:', all.length);
  fs.writeFileSync("data/annonces.json", JSON.stringify(all,null,2), "utf-8");
  console.log("Total annonces:", all.length);
  await browser.close();
}

main();
