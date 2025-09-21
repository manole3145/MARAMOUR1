import fs from 'node:fs/promises';
function csvEscape(v){ if(v==null)return ''; const s=String(v).replace(/"/g,'""'); return /[",\n]/.test(s)? '"'+s+'"': s }
(async()=>{
  const rows=JSON.parse(await fs.readFile('data/annonces.json','utf8').catch(()=> '[]'));
  rows.sort((a,b)=> (new Date(b.date_ts||0)) - (new Date(a.date_ts||0)) || (a.prix_num ?? 9e9) - (b.prix_num ?? 9e9));
  const headers=['cp_zone','commune','source','titre','pieces','surface','prix_num','prix','date_humaine','url'];
  const csv=[headers.join(',')].concat(rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))).join('\n');
  await fs.writeFile('data/annonces.csv',csv,'utf8');
  const items=rows.map(r=>`<li><b>${r.commune||''}</b> — ${r.titre||''} — <i>${r.prix || (r.prix_num??'')}</i> — <a href="${r.url}" target="_blank" rel="noopener">${r.source||''}</a></li>`).join('\n');
  await fs.writeFile('data/annonces_flat.html','<!DOCTYPE html><meta charset="utf-8"><title>Toutes les annonces</title><ul>'+items+'</ul>','utf8');
  console.log('Export OK');
})();