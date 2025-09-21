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

let LINKS_RAW = [];
try {
  const raw = await fs.readFile('data/links.txt','utf8');
  LINKS_RAW = raw.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith('#'));
} catch(e) {
  console.warn('⚠️ links.txt manquant — je continue avec EP par ville uniquement.');
}

function epLinksFromCommunes(){
  const urls = [];
  for (const [cp, comms] of Object.entries(CP_COMMUNES)){
    for (const commune of comms){
      const q = encodeURIComponent(`${commune} ${cp} maison`);
      urls.push(`https://www.entreparticuliers.com/annonces-immobilieres/location/maison?q=${q}&piecesNbMin=${MIN_ROOMS}&prixMax=${MAX_BUDGET}`);
    }
  }
  return urls;
}
function getHost(u){ try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } }
function fromEPQuery(url){ // EntreParticuliers: récupérer "q=<commune> <cp>"
  try {
    const u = new URL(url);
    const q = u.searchParams.get('q') || '';
    const m = q.match(/(.+)\s+(\d{5})$/);
    return m ? { commune: m[1].trim(), cp: m[2] } : {};
  } catch { return {}; }
}
function setLoc(r, {commune, cp} = {}){
  if (commune && !r.commune) r.commune = commune;
  if (cp && !r.cp_zone) r.cp_zone = cp;
  return r;
}
function text(el){ return el?.innerText?.() ?? ''; }
function toAbs(href, base){ try { return new URL(href, base).href; } catch { return href; } }
function i(s){ const n=parseInt(s,10); return Number.isFinite(n)?n:null; }
function price(t){ const m=(t||'').match(/\d[\d\s]*\s?€/); return m? i(m[0].replace(/[^\d]/g,'')) : null; }
function rooms(t){ const m=(t||'').match(/T\s?(\d)/i) || (t||'').match(/(\d)\s?pi[eè]ce/i); return m? i(m[1]) : null; }
function surf(t){ const m=(t||'').match(/(\d+)\s?m²/i); return m? m[0] : null; }
function normalize(t){ return (t||'').replace(/\s+/g,' ').trim().slice(0,200); }
function isHouse(t){ const s=(t||'').toLowerCase(); return s.includes('maison')||s.includes('villa')||s.includes('pavillon'); }
function okRooms(t){ const r=rooms(t); return r==null? true : r>=MIN_ROOMS; }
function okBudget(p){ return p==null? true : p<=MAX_BUDGET; }

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
  const host = getHost(baseUrl);

  if (host === 'bienici.com') {
    // Bien’ici : le DOM est chargé en JS → cibler la liste et ses cartes
    await page.waitForSelector('[data-testid="results-list"] article, [data-testid="result-list"] article', { timeout: 8000 }).catch(()=>{});
    const cards = await page.$$('[data-testid="results-list"] article, [data-testid="result-list"] article, article');
    const out = [];
    for (const el of cards) {
      try {
        const a = await el.$('a[href]');
        if (!a) continue;
        const href = await a.getAttribute('href');
        const url = toAbs(href, baseUrl);
        const all = (await el.innerText()).replace(/\s+/g,' ').trim();

        // Titre / prix / surface / pièces
        const titre = normalize(all);
        const prix_num = price(all);
        const pieces = (all.match(/T\s?\d/i)?.[0]) || (all.match(/(\d)\s?pi[eè]ces?/i)?.[0]) || null;
        const surf = (all.match(/(\d+)\s?m²/i)?.[0]) || null;

        // Adresse : souvent présente dans une balise avec “/location/…” → on grignote la commune
        let commune = null, cp = null;
        const addrEl = await el.$('[data-testid="address"], [class*="Address"], [class*="address"]');
        if (addrEl) {
          const addr = (await addrEl.innerText()).trim();
          // exemple: "Bouloc (31620)" ou "Fenouillet"
          const m = addr.match(/(.+?)\s*\((\d{5})\)/) || addr.match(/^([\p{L}\-\'\s]+)$/u);
          if (m) { commune = (m[1] || m[0]).trim(); cp = (m[2] || cp) || null; }
        }

        if (!isHouse(titre) || !okRooms(all) || !okBudget(prix_num)) continue;
        out.push(setLoc({
          url, titre, prix_num,
          prix: prix_num ? new Intl.NumberFormat('fr-FR').format(prix_num)+' €' : null,
          surface: surf, pieces,
          source: host
        }, {commune, cp}));
      } catch {}
    }
    return out;
  }

  if (host === 'logic-immo.com') {
    // Logic-Immo : listes en <article> avec contenu texte
    await page.waitForSelector('article a[href*="/detail-"], article a[href]', { timeout: 8000 }).catch(()=>{});
    const cards = await page.$$('article, li');
    const out = [];
    for (const el of cards) {
      try {
        const a = await el.$('a[href]');
        if (!a) continue;
        const href = await a.getAttribute('href');
        const url = toAbs(href, baseUrl);
        const all = (await el.innerText()).replace(/\s+/g,' ').trim();

        const titre = normalize(all);
        const prix_num = price(all);
        const pieces = (all.match(/T\s?\d/i)?.[0]) || (all.match(/(\d)\s?pi[eè]ces?/i)?.[0]) || null;
        const surf = (all.match(/(\d+)\s?m²/i)?.[0]) || null;

        // Ville / CP souvent visibles en bas de carte
        let commune = null, cp = null;
        const locMatch = all.match(/([\p{L}\-\'\s]+)\s*\((\d{5})\)/u) || all.match(/à\s+([\p{L}\-\'\s]+)\b/u);
        if (locMatch) {
          commune = (locMatch[1] || '').trim();
          const mcp = all.match(/\b(\d{5})\b/);
          if (mcp) cp = mcp[1];
        }

        if (!isHouse(titre) || !okRooms(all) || !okBudget(prix_num)) continue;
        out.push(setLoc({
          url, titre, prix_num,
          prix: prix_num ? new Intl.NumberFormat('fr-FR').format(prix_num)+' €' : null,
          surface: surf, pieces,
          source: host
        }, {commune, cp}));
      } catch {}
    }
    return out;
  }

  if (host === 'entreparticuliers.com') {
    await page.waitForSelector('article a[href], li a[href], .annonce a[href]', { timeout: 8000 }).catch(()=>{});
    const epHint = fromEPQuery(baseUrl); // {commune, cp} si construit via nos liens
    const nodes = await page.$$('article, li, .annonce, .search-result, .result');
    const out = [];
    for (const el of nodes) {
      try {
        const a = await el.$('a[href]');
        if (!a) continue;
        const href = await a.getAttribute('href');
        const url = toAbs(href, baseUrl);
        const all = (await el.innerText()).replace(/\s+/g,' ').trim();

        const titre = normalize(all);
        const prix_num = price(all);
        const pieces = (all.match(/T\s?\d/i)?.[0]) || (all.match(/(\d)\s?pi[eè]ces?/i)?.[0]) || null;
        const surf = (all.match(/(\d+)\s?m²/i)?.[0]) || null;

        // Ville / CP dans le texte, sinon fallback depuis l’URL q=<commune> <cp>
        let commune = (all.match(/à\s+([\p{L}\-\'\s]+)\b/u)?.[1] || epHint.commune || '').trim() || null;
        let cp = (all.match(/\b(\d{5})\b/)?.[1] || epHint.cp || null);

        if (!isHouse(titre) || !okRooms(all) || !okBudget(prix_num)) continue;
        out.push(setLoc({
          url, titre, prix_num,
          prix: prix_num ? new Intl.NumberFormat('fr-FR').format(prix_num)+' €' : null,
          surface: surf, pieces,
          source: host
        }, {commune, cp}));
      } catch {}
    }
    return out;
  }

  // Fallback générique (autres domaines)
  const cards = await page.$$('article, li, div');
  const out = [];
  for (const el of cards){
    try {
      const a = await el.$('a[href]'); if (!a) continue;
      const href = await a.getAttribute('href'); if (!href) continue;
      const url = toAbs(href, baseUrl);
      const all = (await el.innerText()).replace(/\s+/g,' ').trim();

      const titre = normalize(all);
      const prix_num = price(all);
      const pieces = (all.match(/T\s?\d/i)?.[0]) || (all.match(/(\d)\s?pi[eè]ces?/i)?.[0]) || null;
      const surf = (all.match(/(\d+)\s?m²/i)?.[0]) || null;

      let commune = (all.match(/à\s+([\p{L}\-\'\s]+)\b/u)?.[1] || '').trim() || null;
      let cp = (all.match(/\b(\d{5})\b/)?.[1] || null);

      if (!isHouse(titre) || !okRooms(all) || !okBudget(prix_num)) continue;
      out.push(setLoc({
        url, titre, prix_num,
        prix: prix_num ? new Intl.NumberFormat('fr-FR').format(prix_num)+' €' : null,
        surface: surf, pieces,
        source: getHost(baseUrl)
      }, {commune, cp}));
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
