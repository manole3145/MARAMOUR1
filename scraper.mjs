import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const MAX_BUDGET = 1200;
const MIN_ROOMS = 4;
const TIMEOUT = 60000;
const PAGES_MAX = 10;

const HEADERS = {
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
};

const CP_COMMUNES = JSON.parse(await fs.readFile('data/communes.json','utf8'));
const LINKS_RAW = (await fs.readFile('data/links.txt','utf8')).split(/\r?\n/).map(l=>l.trim()).filter(l => l && !l.startsWith('#'));

function epLinksFromCommunes(){
  const urls = [];
  for (const [cp, comms] of Object.entries(CP_COMMUNES)){
    for (const commune of comms){
      const q = encodeURIComponent(commune + ' ' + cp + ' maison');
      urls.push(`https://www.entreparticuliers.com/annonces-immobilieres/location/maison?q=${q}&piecesNbMin=${MIN_ROOMS}&prixMax=${MAX_BUDGET}`);
    }
  }
  return urls;
}

function toAbs(href, base){ try { return new URL(href, base).href; } catch { return href; } }
function parseIntSafe(s){ const n = parseInt(s,10); return Number.isFinite(n)?n:null; }
function parsePrice(txt){ const m=(txt||'').match(/\d[\d\s]*\s?€/); return m ? parseIntSafe(m[0].replace(/[^\d]/g,'')) : null; }
function findRooms(txt){ const m = (txt||'').match(/T\s?(\d)/i) || (txt||'').match(/(\d)\s?pi[eè]ce/i); return m ? parseIntSafe(m[1]) : null; }
function findSurface(txt){ const m = (txt||'').match(/(\d+)\s?m²/i); return m ? m[0] : null; }
function normalize(t){ return (t||'').replace(/\s+/g,' ').trim().slice(0,200); }
function isHouse(txt){ const s=(txt||'').toLowerCase(); return s.includes('maison')||s.includes('villa')||s.includes('pavillon'); }
function okRooms(txt){ const r = findRooms(txt); return r==null ? true : (r >= MIN_ROOMS); }
function okBudget(p){ return p==null ? true : p <= MAX_BUDGET; }

async function exhaust(page){
  for (let i=0;i<PAGES_MAX;i++){
    const before = await page.evaluate(()=>document.body.scrollHeight);
    const next = await page.$('a[rel="next"], button[aria-label*="Suivant"], a:has-text("Suivant"), button:has-text("Suivant")');
    if (next){ await next.click().catch(()=>{}); await page.waitForTimeout(1500); }
    else { await page.mouse.wheel(0,20000); await page.waitForTimeout(1200); }
    const after = await page.evaluate(()=>document.body.scrollHeight);
    if (after <= before) break;
  }
}

async function extract(page, baseUrl){
  const cards = await page.$$('article, li, div');
  const out = [];
  for (const el of cards){
    try {
      const a = await el.$('a'); if (!a) continue;
      const href = await a.getAttribute('href'); if (!href) continue;
      const url = toAbs(href, baseUrl);
      const txt = await el.innerText().catch(()=>'');
      const titre = normalize(txt);
      const prix_num = parsePrice(txt);
      const surface = findSurface(txt);
      const pieces = (txt.match(/T\s?\d/i)?.[0]) || null;
      const date_humaine = (txt.match(/(Aujourd'hui|Hier|publiée? .*|\d{2}\/\d{2}\/\d{4})/i)?.[0]) || null;

      if (!isHouse(titre)) continue;
      if (!okRooms(txt)) continue;
      if (!okBudget(prix_num)) continue;

      out.push({ url, titre, prix_num, prix: prix_num? new Intl.NumberFormat('fr-FR').format(prix_num)+' €': null, surface, pieces, date_humaine, source: (new URL(baseUrl)).hostname });
    } catch {}
  }
  return out;
}

function dedup(rows){
  const seen = new Set(); const out=[];
  for (const r of rows){ const key = (r.url||'').split('?')[0]; if (seen.has(key)) continue; seen.add(key); out.push(r); }
  return out;
}

(async ()=>{
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders(HEADERS);

  const allLinks = LINKS_RAW.concat(epLinksFromCommunes());
  let all = [];
  for (const url of allLinks){
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(1500);
      await exhaust(page);
      const rows = await extract(page, url);
      all = all.concat(rows);
    } catch (e){
      console.error('Erreur URL', url, e.message);
    }
  }

  all = dedup(all);
  all.sort((a,b)=> (b.date_ts||0)-(a.date_ts||0) || (a.prix_num??9e9)-(b.prix_num??9e9));
  await fs.mkdir('data',{recursive:true});
  await fs.writeFile('data/annonces.json', JSON.stringify(all,null,2), 'utf8');
  console.log('Annonces collectées:', all.length);
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
