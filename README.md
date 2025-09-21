# Pack Full3 — Récupération par commune et par site (liens absolus)

- Itère sur **toutes les communes** de 31620, 31150, 31790 (voir `data/communes.json`).
- Pour chaque commune, construit des **recherches par site** (SeLoger, EntreParticuliers, Logic-Immo, Figaro Immo, Bien'ici, + LBC en option).
- Récupère **chaque annonce**, filtre ≤ 1 200 €, **déduplique par URL**, écrit `data/annonces.json`.

## Utilisation
```bash
npm ci || npm i
npx playwright install --with-deps chromium
npm run scrape
```

## GitHub Pages
Réglages Pages → Deploy from branch (main / root). Action CRON toutes les 2h.

_Généré le 2025-09-21 05:57_
