# Pack Complet — Annonces maisons (31620 / 31150 / 31790)

- Multi-liens + EntreParticuliers par ville
- Exports CSV + HTML
- UI index.html : filtres, tri, distance depuis Fenouillet, suppression/restauration (localStorage)
- Workflow GitHub prêt (printf links, Node communes, push rebase-safe)

## Utilisation locale
```bash
npm ci || npm i
npx playwright install --with-deps chromium
npm run build   # scrape + export
# Ouvrez index.html
```

Liens actuels → `data/links.txt` (tu peux éditer). Communes → `data/communes.json`.

_Généré le 2025-09-21 10:50_
