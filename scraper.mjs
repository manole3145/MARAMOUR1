import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const MAX_BUDGET = 1200;
const CP_COMMUNES = {
  "31620": ["Fronton","Bouloc","Castelnau-d'Estrétefonds","Cépet","Saint-Rustice","Villeneuve-lès-Bouloc"],
  "31150": ["Fenouillet","Gagnac-sur-Garonne","Gratentour","Lespinasse","Bruguières"],
  "31790": ["Saint-Jory","Saint-Sauveur"]
};
const HEADLESS = true;
function buildSearchesForCommune(commune, cp){
  const q = encodeURIComponent(commune + " " + cp);
  return [
    {source:'LeBonCoin', url:`https://www.leboncoin.fr/recherche?category=10&text=${q}&real_estate_type=1&rooms=4-max&price=0-${MAX_BUDGET}`},
    {source:'SeLoger', url:`https://www.seloger.com/list.htm?projects=2&types=2&natures=1,2&rooms=4&price=0-${MAX_BUDGET}&qsVersion=1.0&places=%5B%7B%22label%22:%22Haute-Garonne%20(31)%22,%22level%22:2%7D%5D&q=${q}`},
    {source:'EntreParticuliers', url:`https://www.entreparticuliers.com/annonces-immobilieres/location/maison?q=${q}`},
    {source:'Logic-Immo', url:`https://www.logic-immo.com/recherche-immo/location/maison/occitanie?priceMax=${MAX_BUDGET}&q=${q}`},
    {source:'Figaro Immo', url:`https://immobilier.lefigaro.fr/annonces/resultat/annonces.html?transaction=location&type=maison&q=${q}&prixmax=${MAX_BUDGET}`},
    {source:"Bien'ici", url:`https://www.bienici.com/recherche/location/france/maison?maxPrice=${MAX_BUDGET}&text=${q}&minRooms=4`},
  ];
}
function toAbsUrl(href, base){ try { return new URL(href, base).href; } catch { return href; } }
function parsePrixToNumber(txt){ const m = (txt||'').match(/\d[\d\s]*\s?€/); if(!m) return null; const n = parseInt(m[0].replace(/[^\d]/g,''),10); return Number.isFinite(n)?n:null; }
function normalizeTitle(t){ return (t||'').replace(/\s+/g,' ').trim().slice(0,160); }
const SITE_SELECTORS = [
  { source: 'LeBonCoin',   card: '[data-qa-id="aditem_container"], a[data-qa-id="aditem_link"]', prefer: 'a[data-qa-id="aditem_link"]' },
  { source: 'SeLoger',     card: 'li[data-test="sl.card.list"] article, .Card__StyledCard-sc', prefer: 'a[href*="/annonces/"]' },
  { source: 'EntreParticuliers', card: '.result-item, article, li a[href*="/annonce/"]', prefer: 'a[href*="/annonce/"]' },
  { source: 'Logic-Immo',  card: 'article, .offer-card, li a[href*="/annonce-immobiliere"]', prefer: 'a[href*="/annonce-immobiliere"]' },
  { source: 'Figaro Immo', card: 'article, li a[href*="/annonces/"]', prefer: 'a[href*="/annonces/"]' },
  { source: "Bien'ici",    card: 'article, a[href*="/annonce/"]', prefer: 'a[href*="/annonce/"]' },
];
function selectorsFor(source){ return SITE_SELECTORS.find(s => s.source === source) || { card: 'article, li, div' }; }
async function exhaustPage(page){
  for (let i=0;i<10;i++){
    const prev = await page.evaluate(()=>document.body.scrollHeight);
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(1200);
    const next = await page.evaluate(()=>document.body.scrollHeight);
    if (next<=prev) break;
  }
}
async function extractGenericCard(el, baseUrl){
  const link = await el.$('a');
  const href = link ? await link.getAttribute('href') : null;
  const url = href ? toAbsUrl(href, baseUrl) : null;
  const txt = await el.innerText().catch(()=>'');
  const title = normalizeTitle(txt);
  const prix_num = parsePrixToNumber(txt);
  const pieces = (txt.match(/T\s?(\d)/i)?.[0]) || null;
  const surface = (txt.match(/\d+\s?m²/i)?.[0]) || null;
  const dateTxt = (txt.match(/(Aujourd'hui|Hier|publiée? .+|\d{2}\/\d{2}\/\d{4})/i)?.[0]) || null;
  return { url, title, prix_num, pieces, surface, dateTxt };
}
async function scrapeSearch(page, conf){
  const out = [];
  await page.goto(conf.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await exhaustPage(page);
  const sels = selectorsFor(conf.source);
  const cards = await page.$$(sels.card);
  for (const el of cards){
    try{
      let anchor = null;
      if (sels.prefer) anchor = await el.$(sels.prefer);
      let href = anchor ? await anchor.getAttribute('href') : null;
      if (!href){
        const a = await el.$('a');
        href = a ? await a.getAttribute('href') : null;
      }
      const url = href ? toAbsUrl(href, conf.url) : null;
      if (!url) continue;
      const { title, prix_num, pieces, surface, dateTxt } = await extractGenericCard(el, conf.url);
      const t = (title||'').toLowerCase();
      if (!(t.includes('maison') || t.includes('villa') || t.includes('pavillon'))) continue;
      if (prix_num != null && prix_num > MAX_BUDGET) continue;
      out.push({ source: conf.source, url, titre: title, prix: prix_num? new Intl.NumberFormat('fr-FR').format(prix_num)+' €': null, prix_num, date: null, date_humaine: dateTxt||null, date_ts: null, surface, pieces });
    }catch(e){}
  }
  return out;
}
function attachMeta(rows, commune, cp){
  return rows.map(r => ({...r, commune, cp_zone: cp, inside_budget: r.prix_num==null ? true : (r.prix_num <= MAX_BUDGET)}));
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  let all = [];
  for (const [cp, communes] of Object.entries(CP_COMMUNES)){
    for (const commune of communes){
      const searches = buildSearchesForCommune(commune, cp);
      for (const s of searches){
        try {
          const rows = await scrapeSearch(page, s);
          all = all.concat(attachMeta(rows, commune, cp));
        } catch(e){ console.error('Scrape error', s.source, commune, cp, e.message); }
      }
    }
  }
  const seen = new Set();
  all = all.filter(x => { const key = x.url.split('?')[0]; if (seen.has(key)) return false; seen.add(key); return true; });
  all.sort((a,b) => (b.date_ts||0) - (a.date_ts||0) || (a.prix_num ?? 9e9) - (b.prix_num ?? 9e9));
  await fs.mkdir('data', { recursive: true });
  await fs.writeFile('data/annonces.json', JSON.stringify(all, null, 2), 'utf8');
  await browser.close();
  console.log('Écrit', all.length, 'annonces');
})();