// scraper.mjs
import fs from "fs";
import { chromium } from "playwright";

function toAbs(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function normalize(t) {
  return t.replace(/\s+/g, " ").trim();
}

function price(txt) {
  const m = txt.match(/(\d[\d\s]{2,})\s*€?/);
  if (!m) return null;
  return parseInt(m[1].replace(/\s/g, ""), 10);
}

function isHouse(t) {
  return /maison|villa/i.test(t);
}

function okRooms(txt) {
  return /([45]\s?pi[eè]ce|T[45])/i.test(txt);
}

function okBudget(p) {
  return p && p <= 1200;
}

function getHost(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function fromEPQuery(url) {
  try {
    const u = new URL(url);
    const q = u.searchParams.get("q") || "";
    const m = q.match(/(.+)\s+(\d{5})$/);
    return m ? { commune: m[1].trim(), cp: m[2] } : {};
  } catch {
    return {};
  }
}

function setLoc(r, { commune, cp } = {}) {
  if (commune && !r.commune) r.commune = commune;
  if (cp && !r.cp_zone) r.cp_zone = cp;
  return r;
}

async function extract(page, baseUrl) {
  const host = getHost(baseUrl);

  // --- Bienici ---
  if (host === "bienici.com") {
    await page
      .waitForSelector(
        "[data-testid='results-list'] article, [data-testid='result-list'] article",
        { timeout: 8000 }
      )
      .catch(() => {});
    const cards = await page.$$(
      "[data-testid='results-list'] article, [data-testid='result-list'] article, article"
    );
    const out = [];
    for (const el of cards) {
      try {
        const a = await el.$("a[href]");
        if (!a) continue;
        const href = await a.getAttribute("href");
        const url = toAbs(href, baseUrl);
        const all = (await el.innerText()).replace(/\s+/g, " ").trim();

        const titre = normalize(all);
        const prix_num = price(all);
        const pieces =
          all.match(/T\s?\d/i)?.[0] ||
          all.match(/(\d)\s?pi[eè]ces?/i)?.[0] ||
          null;
        const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;

        let commune = null,
          cp = null;
        const addrEl = await el.$(
          "[data-testid='address'], [class*='Address'], [class*='address']"
        );
        if (addrEl) {
          const addr = (await addrEl.innerText()).trim();
          const m =
            addr.match(/(.+?)\s*\((\d{5})\)/) ||
            addr.match(/^([A-Za-zÀ-ÖØ-öø-ÿ \-']+)$/);
          if (m) {
            commune = (m[1] || m[0]).trim();
            cp = m[2] || cp || null;
          }
        }

        if (!isHouse(titre) || !okRooms(all) || !okBudget(prix_num)) continue;
        out.push(
          setLoc(
            {
              url,
              titre,
              prix_num,
              prix: prix_num
                ? new Intl.NumberFormat("fr-FR").format(prix_num) + " €"
                : null,
              surface: surf,
              pieces,
              source: host,
            },
            { commune, cp }
          )
        );
      } catch {}
    }
    return out;
  }

  // --- Logic-Immo ---
  if (host === "logic-immo.com") {
    await page
      .waitForSelector("article a[href*='/detail-'], article a[href]", {
        timeout: 8000,
      })
      .catch(() => {});
    const cards = await page.$$("article, li");
    const out = [];
    for (const el of cards) {
      try {
        const a = await el.$("a[href]");
        if (!a) continue;
        const href = await a.getAttribute("href");
        const url = toAbs(href, baseUrl);
        const all = (await el.innerText()).replace(/\s+/g, " ").trim();

        const titre = normalize(all);
        const prix_num = price(all);
        const pieces =
          all.match(/T\s?\d/i)?.[0] ||
          all.match(/(\d)\s?pi[eè]ces?/i)?.[0] ||
          null;
        const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;

        let commune = null,
          cp = null;
        const locMatch =
          all.match(/([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\s*\((\d{5})\)/) ||
          all.match(/à\s+([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\b/);
        if (locMatch) {
          commune = (locMatch[1] || "").trim();
          const mcp = all.match(/\b(\d{5})\b/);
          if (mcp) cp = mcp[1];
        }

        if (!isHouse(titre) || !okRooms(all) || !okBudget(prix_num)) continue;
        out.push(
          setLoc(
            {
              url,
              titre,
              prix_num,
              prix: prix_num
                ? new Intl.NumberFormat("fr-FR").format(prix_num) + " €"
                : null,
              surface: surf,
              pieces,
              source: host,
            },
            { commune, cp }
          )
        );
      } catch {}
    }
    return out;
  }

  // --- EntreParticuliers ---
  if (host === "entreparticuliers.com") {
    await page
      .waitForSelector("article a[href], li a[href], .annonce a[href]", {
        timeout: 8000,
      })
      .catch(() => {});
    const epHint = fromEPQuery(baseUrl);
    const nodes = await page.$$(
      "article, li, .annonce, .search-result, .result"
    );
    const out = [];
    for (const el of nodes) {
      try {
        const a = await el.$("a[href]");
        if (!a) continue;
        const href = await a.getAttribute("href");
        const url = toAbs(href, baseUrl);
        const all = (await el.innerText()).replace(/\s+/g, " ").trim();

        const titre = normalize(all);
        const prix_num = price(all);
        const pieces =
          all.match(/T\s?\d/i)?.[0] ||
          all.match(/(\d)\s?pi[eè]ces?/i)?.[0] ||
          null;
        const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;

        let commune =
          (all.match(/à\s+([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\b/)?.[1] ||
            epHint.commune ||
            "").trim() || null;
        let cp = all.match(/\b(\d{5})\b/)?.[1] || epHint.cp || null;

        if (!isHouse(titre) || !okRooms(all) || !okBudget(prix_num)) continue;
        out.push(
          setLoc(
            {
              url,
              titre,
              prix_num,
              prix: prix_num
                ? new Intl.NumberFormat("fr-FR").format(prix_num) + " €"
                : null,
              surface: surf,
              pieces,
              source: host,
            },
            { commune, cp }
          )
        );
      } catch {}
    }
    return out;
  }

  // --- Fallback générique ---
  const cards = await page.$$("article, li, div");
  const out = [];
  for (const el of cards) {
    try {
      const a = await el.$("a[href]");
      if (!a) continue;
      const href = await a.getAttribute("href");
      if (!href) continue;
      const url = toAbs(href, baseUrl);
      const all = (await el.innerText()).replace(/\s+/g, " ").trim();

      const titre = normalize(all);
      const prix_num = price(all);
      const pieces =
        all.match(/T\s?\d/i)?.[0] ||
        all.match(/(\d)\s?pi[eè]ces?/i)?.[0] ||
        null;
      const surf = all.match(/(\d+)\s?m²/i)?.[0] || null;

      let commune =
        (all.match(/à\s+([A-Za-zÀ-ÖØ-öø-ÿ \-']+)\b/)?.[1] || "").trim() || null;
      let cp = all.match(/\b(\d{5})\b/)?.[1] || null;

      if (!isHouse(titre) || !okRooms(all) || !okBudget(prix_num)) continue;
      out.push(
        setLoc(
          {
            url,
            titre,
            prix_num,
            prix: prix_num
              ? new Intl.NumberFormat("fr-FR").format(prix_num) + " €"
              : null,
            surface: surf,
            pieces,
            source: getHost(baseUrl),
          },
          { commune, cp }
        )
      );
    } catch {}
  }
  return out;
}

// --- Main ---
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const links = fs
    .readFileSync("data/links.txt", "utf-8")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  let all = [];
  for (const url of links) {
    console.log("Scraping", url);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      const results = await extract(page, url);
      all.push(...results);
    } catch (e) {
      console.error("Error on", url, e.message);
    }
  }

  await browser.close();

  // deduplicate by URL
  const seen = new Set();
  all = all.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  fs.writeFileSync("data/annonces.json", JSON.stringify(all, null, 2));
  console.log("Saved", all.length, "annonces");
}

main();
