'use strict';
/* ==========================================================================
   Quiz entre potes — moteur de données
   Les questions sont construites en direct à partir de Wikidata (base de
   Wikipédia), via QLever (rapide) avec l'endpoint officiel en secours.
   Les réponses sont mises en cache dans le navigateur (IndexedDB).
   ========================================================================== */

const QL = 'https://qlever.dev/api/wikidata';
const WDQS = 'https://query.wikidata.org/sparql';
const PFX = [
  'PREFIX wd: <http://www.wikidata.org/entity/>',
  'PREFIX wdt: <http://www.wikidata.org/prop/direct/>',
  'PREFIX p: <http://www.wikidata.org/prop/>',
  'PREFIX ps: <http://www.wikidata.org/prop/statement/>',
  'PREFIX pq: <http://www.wikidata.org/prop/qualifier/>',
  'PREFIX wikibase: <http://wikiba.se/ontology#>',
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
  'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
  ''
].join('\n');

/* ---------- utilitaires ---------- */
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const sample = (a, n) => shuffle(a).slice(0, n);
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const lab = (v, l) => `?${v} rdfs:label ?${l}. FILTER(LANG(?${l})="fr")`;
function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/* ---------- cache IndexedDB ---------- */
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('quiz-potes', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  return {
    async get(k) {
      try { const db = await open(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); }
      catch { return undefined; }
    },
    async set(k, v) {
      try { const db = await open(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; t.onabort = res; }); }
      catch { /* cache indisponible : tant pis */ }
    },
    async clear() {
      try { const db = await open(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = res; t.onerror = res; t.onabort = res; }); } catch { }
    }
  };
})();

/* ---------- requêtes SPARQL ---------- */
async function runEndpoint(url, q, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url + '?query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' }, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return j.results.bindings.map(b => {
      const o = {};
      for (const k in b) o[k] = b[k].value.replace('http://www.wikidata.org/entity/', '');
      return o;
    });
  } finally { clearTimeout(t); }
}
async function sparql(body, ttlDays = 14) {
  const q = PFX + body, key = 'q:' + hash(q);
  const c = await DB.get(key);
  if (c && Date.now() - c.t < ttlDays * 864e5) return c.rows;
  let rows, err;
  for (const ep of [QL, WDQS]) {
    try { rows = await runEndpoint(ep, q, 25000); break; } catch (e) { err = e; }
  }
  if (!rows) { if (c) return c.rows; throw err || new Error('Pas de réseau'); }
  DB.set(key, { t: Date.now(), rows });
  return rows;
}
async function searchEntities(term) {
  const u = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language=fr&uselang=fr&limit=8&search=' + encodeURIComponent(term);
  const j = await (await fetch(u)).json();
  return (j.search || []).map(x => ({ id: x.id, label: x.label, desc: x.description || '' }));
}

/* ==========================================================================
   THÈMES
   ========================================================================== */
const THEMES = {
  foot: { n: 'Football', e: '⚽', c: '#2fd27f' },
  nba: { n: 'NBA', e: '🏀', c: '#ff8a3d' },
  sports: { n: 'Autres sports & JO', e: '🏅', c: '#3fa7ff' },
  music: { n: 'Musique', e: '🎵', c: '#c77dff' },
  cinema: { n: 'Cinéma', e: '🎬', c: '#ffd24a' }
};

/* ==========================================================================
   CATÉGORIES DE QUESTIONS
   kind 'assoc' : un sujet -> une (ou plusieurs) bonne(s) réponse(s)
   kind 'year'  : un sujet -> une année
   odd          : variante « lequel n'est PAS … » (intrus)
   ========================================================================== */
const CLUBS = [
  ['Q8682', 'Real Madrid'], ['Q7156', 'FC Barcelone'], ['Q483020', 'Paris Saint-Germain'], ['Q18656', 'Manchester United'],
  ['Q1130849', 'Liverpool'], ['Q15789', 'Bayern Munich'], ['Q1422', 'Juventus'], ['Q1543', 'AC Milan'], ['Q631', 'Inter Milan'],
  ['Q9617', 'Arsenal'], ['Q9616', 'Chelsea'], ['Q50602', 'Manchester City'], ['Q41420', 'Borussia Dortmund'],
  ['Q132885', 'Olympique de Marseille'], ['Q704', 'Olympique lyonnais'], ['Q180305', 'AS Monaco'], ['Q8701', 'Atlético de Madrid'],
  ['Q2641', 'SSC Napoli']
];
const BIG5 = 'wd:Q9448, wd:Q324867, wd:Q15804, wd:Q82595, wd:Q13394'; // Premier League, Liga, Serie A, Bundesliga, Ligue 1
const CLUB_VALUES = CLUBS.map(c => 'wd:' + c[0]).join(' ');

const WC_WIN = [[1930, 'Uruguay'], [1934, 'Italie'], [1938, 'Italie'], [1950, 'Uruguay'], [1954, 'Allemagne'], [1958, 'Brésil'], [1962, 'Brésil'], [1966, 'Angleterre'], [1970, 'Brésil'], [1974, 'Allemagne'], [1978, 'Argentine'], [1982, 'Italie'], [1986, 'Argentine'], [1990, 'Allemagne'], [1994, 'Brésil'], [1998, 'France'], [2002, 'Brésil'], [2006, 'Italie'], [2010, 'Espagne'], [2014, 'Allemagne'], [2018, 'France'], [2022, 'Argentine']];
const WC_HOST = [[1930, 'Uruguay'], [1934, 'Italie'], [1938, 'France'], [1950, 'Brésil'], [1954, 'Suisse'], [1958, 'Suède'], [1962, 'Chili'], [1966, 'Angleterre'], [1970, 'Mexique'], [1974, 'Allemagne'], [1978, 'Argentine'], [1982, 'Espagne'], [1986, 'Mexique'], [1990, 'Italie'], [1994, 'États-Unis'], [1998, 'France'], [2006, 'Allemagne'], [2010, 'Afrique du Sud'], [2014, 'Brésil'], [2018, 'Russie'], [2022, 'Qatar']];
const seedRows = arr => arr.map(([y, n]) => ({ s: String(y), a: n, aL: n }));


/* ---------- aides : or olympique et rugby ---------- */
const OLY_SUFFIX = / aux Jeux olympiques (d.(?:été|hiver) )?de [0-9]{4}/;
const olyYear = l => ((l.match(/[0-9]{4}/) || [])[0]) || '';
const olyEvent = l => l.replace(OLY_SUFFIX, '');
// sujet = sportif (athleteSubject=true) ou épreuve ; la réponse est l'autre. Sportifs connus seulement (nombre de pages Wikipédia).
/* Cinéma et musique : on ne pose des questions que sur des titres/artistes du « top » (box-office France et monde depuis 1970,
   albums et artistes les plus vendus). Facile = tête du classement, Difficile = classement entier. */
const popSlice = (arr, theme) => arr.slice(0, Math.ceil(arr.length * byLevel(theme, [0.45, 0.75, 1])));
const popVals = (arr, theme) => popSlice(arr, theme).map(x => 'wd:' + x[0]).join(' ');
const BORN = 'OPTIONAL{?a wdt:P569 ?bd. BIND(YEAR(?bd) AS ?ay)}';
const olyQ = athleteSubject => {
  const A = athleteSubject ? 's' : 'a', E = athleteSubject ? 'a' : 's';
  return `SELECT DISTINCT ?s ?sL ?a ?aL ?gr ?grL WHERE{?${E} wdt:P31 wd:Q18536594; p:P1346 ?st. ?st ps:P1346 ?${A}; pq:P166 wd:Q15243387. ?${A} wdt:P31 wd:Q5; wikibase:sitelinks ?wsl. FILTER(?wsl>40) ?${E} wdt:P361 ?gr. ${lab('s', 'sL')} ${lab('a', 'aL')} ${lab('gr', 'grL')}} LIMIT 4000`;
};
const olyMap = athleteSubject => r => {
  const evLabel = athleteSubject ? r.aL : r.sL, yr = olyYear(evLabel), nice = olyEvent(evLabel) + (yr ? ' (' + yr + ')' : '');
  const g = /(masculin|messieurs|hommes)/i.test(evLabel) ? 'H' : /(féminin|dames|femmes)/i.test(evLabel) ? 'F' : 'X';
  return { ...r, [athleteSubject ? 'aL' : 'sL']: nice, ay: yr, gr: olyEvent(r.grL || r.gr) + '|' + g }; // gr = discipline + sexe, pour des réponses proches (pas de femmes parmi des épreuves masculines)
};
const rugbyTeam = l => l.replace(/^équipe (d'|d’|de la |de l'|de l’|du |des |de )/, '').replace(/ de rugby à XV.*$/, '').trim();

const CATS = [
  /* ---------- FOOTBALL ---------- */
  {
    id: 'foot_stade', theme: 'foot', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?sL ?a ?aL ?gr WHERE{?s wdt:P31 wd:Q476028;wdt:P115 ?a;wdt:P17 ?gr;wdt:P118 ?lg;wikibase:sitelinks ?sl. FILTER(?lg IN (${BIG5})) FILTER(?sl>45) ${lab('s', 'sL')} ${lab('a', 'aL')}} LIMIT 400`,
    ask: s => `Quel est le stade du club « ${s} » ?`
  },
  {
    id: 'foot_ballon', eraLabel: true, theme: 'foot', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?a ?aL WHERE{?a p:P166 ?st. ?st ps:P166 wd:Q166177; pq:P585 ?d. BIND(STR(YEAR(?d)) AS ?s) ${lab('a', 'aL')}}`,
    ask: s => `Qui a remporté le Ballon d'or en ${s} ?`
  },
  { id: 'foot_wc_win', theme: 'foot', kind: 'assoc', easy: true, rows: seedRows(WC_WIN), ask: s => `Qui a remporté la Coupe du monde de football en ${s} ?` },
  { id: 'foot_wc_host', theme: 'foot', kind: 'assoc', easy: true, rows: seedRows(WC_HOST), ask: s => `Quel pays a organisé la Coupe du monde de football en ${s} ?` },
  {
    id: 'foot_joueur_club', theme: 'foot', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?sL ?a ?aL ?ay WHERE{VALUES ?s {${CLUB_VALUES}} ?a p:P54 [ps:P54 ?s]; wdt:P106 wd:Q937857; wikibase:sitelinks ?asl. FILTER(?asl>40) ${lab('s', 'sL')} ${lab('a', 'aL')} OPTIONAL{?a wdt:P569 ?bd. BIND(YEAR(?bd) AS ?ay)}} LIMIT 6000`,
    ask: s => `Lequel de ces joueurs a porté le maillot de ${s} ?`,
    odd: s => `Lequel de ces joueurs n'a jamais porté le maillot de ${s} ?`
  },
  {
    id: 'foot_nat', fixed: true, theme: 'foot', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P106 wd:Q937857; wdt:P1532 ?a; wikibase:sitelinks ?sl. FILTER(?sl>60) ?s p:P54 [ps:P54 ?c]. ${lab('s', 'sL')} ${lab('a', 'aL')}} LIMIT 1500`,
    ask: s => `Quelle équipe nationale a représenté ${s} ?`
  },


  /* ---------- NBA ---------- */
  {
    id: 'nba_salle', theme: 'nba', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P118 wd:Q155223. FILTER NOT EXISTS{?s wdt:P576 ?dis} ?s wdt:P118 wd:Q155223; wdt:P115 ?a. ${lab('s', 'sL')} ${lab('a', 'aL')}}`,
    ask: s => `Quelle est la salle des ${s} ?`
  },
  {
    id: 'nba_ville', theme: 'nba', kind: 'assoc', easy: true,
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P118 wd:Q155223. FILTER NOT EXISTS{?s wdt:P576 ?dis} ?s wdt:P118 wd:Q155223; wdt:P159 ?a. ${lab('s', 'sL')} ${lab('a', 'aL')}}`,
    ask: s => `Dans quelle ville est basée l'équipe des ${s} ?`
  },
  {
    id: 'nba_mvp', eraLabel: true, theme: 'nba', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?a ?aL WHERE{?a p:P166 ?st. ?st ps:P166 wd:Q222047; pq:P585 ?d. BIND(YEAR(?d) AS ?yy) BIND(CONCAT(STR(?yy-1),"-",SUBSTR(STR(?yy),3,2)) AS ?s) ${lab('a', 'aL')}}`,
    ask: s => `Qui a été élu MVP de la saison NBA ${s} ?`
  },
  {
    id: 'nba_finales', eraLabel: true, theme: 'nba', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P31 wd:Q842375; wdt:P1346 ?a. ${lab('s', 'sL')} ${lab('a', 'aL')}}`,
    keep: r => /Finales NBA/.test(r.sL), // écarte les « Finales BAA » 1947-1949 (ancêtre de la NBA)
    ask: s => `Qui a remporté les ${s} ?`
  },
  {
    id: 'nba_joueur_equipe', theme: 'nba', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?sL ?a ?aL ?ay WHERE{?s wdt:P118 wd:Q155223. FILTER NOT EXISTS{?s wdt:P576 ?dis} ?a p:P54 [ps:P54 ?s]; wdt:P106 wd:Q3665646; wikibase:sitelinks ?asl. FILTER(?asl>25) ${lab('s', 'sL')} ${lab('a', 'aL')} OPTIONAL{?a wdt:P569 ?bd. BIND(YEAR(?bd) AS ?ay)}} LIMIT 5000`,
    ask: s => `Lequel de ces joueurs a porté le maillot des ${s} ?`,
    odd: s => `Lequel de ces joueurs n'a jamais porté le maillot des ${s} ?`
  },
  {
    id: 'nba_nat', fixed: true, theme: 'nba', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P106 wd:Q3665646; wdt:P27 ?a; wikibase:sitelinks ?sl. FILTER(?sl>45) ?s p:P54 [ps:P54 ?t]. ?t wdt:P118 wd:Q155223. ${lab('s', 'sL')} ${lab('a', 'aL')}} LIMIT 1500`,
    ask: s => `Quelle est la nationalité de ${s} ?`
  },


  /* ---------- AUTRES SPORTS & JO ---------- */
  {
    id: 'jo_ville', eraLabel: true, theme: 'sports', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P31 wd:Q135976384; wdt:P276 ?a. FILTER NOT EXISTS{?a wdt:P31 wd:Q483110} ${lab('s', 'sL')} ${lab('a', 'aL')}}`,
    keep: r => !/19(16|40|44)/.test(r.sL) && !/stade|stadium|parc /i.test(r.aL) && +(r.sL.match(/\d{4}/) || [0])[0] < new Date().getFullYear() + 1 && !(+(r.sL.match(/\d{4}/) || [0])[0] > new Date().getFullYear()), // pas de Jeux à venir
    ask: s => `Quelle ville a accueilli les ${s} ?`
  },
  {
    id: 'ath_sport', fixed: true, noQ: true, theme: 'sports', kind: 'assoc',
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P31 wd:Q5; wdt:P106/wdt:P279* wd:Q2066131; wdt:P641 ?a; wikibase:sitelinks ?sl. FILTER(?sl>90) FILTER(?a NOT IN (wd:Q2736, wd:Q5372)) ${lab('s', 'sL')} ${lab('a', 'aL')}} LIMIT 1500`,
    ask: s => `Quel sport pratique (ou pratiquait) ${s} ?`
  },


  /* ---------- OR OLYMPIQUE : sportifs connus (or uniquement, qualifié « médaille d'or » sur Wikidata) ---------- */
  {
    id: 'oly_epreuve', theme: 'sports', kind: 'assoc', fixed: true,
    q: olyQ(true), map: olyMap(true),
    ask: s => `Dans quelle épreuve ${s} a-t-il (ou elle) remporté l'or olympique ?`
  },
  {
    id: 'oly_champion', theme: 'sports', kind: 'assoc', fixed: true,
    q: olyQ(false), map: olyMap(false),
    ask: s => `Qui a remporté l'or olympique en « ${s} » ?`
  },

  /* ---------- RUGBY ---------- */
  {
    id: 'rugby_cdm', theme: 'sports', kind: 'assoc', fixed: true, easy: true, eraLabel: true,
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P31 wd:Q106043413; wdt:P1346 ?a. ${lab('s', 'sL')} ${lab('a', 'aL')}}`,
    map: r => ({ ...r, aL: rugbyTeam(r.aL) }),
    ask: s => `Qui a remporté la ${s} ?`
  },
  {
    id: 'rugby_6n', theme: 'sports', kind: 'assoc', fixed: true, eraLabel: true,
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P3450 wd:Q16642; wdt:P1346 ?a; wdt:P580 ?d. FILTER(YEAR(?d)>=2000) ${lab('s', 'sL')} ${lab('a', 'aL')}}`,
    map: r => ({ ...r, aL: rugbyTeam(r.aL) }),
    ask: s => `Qui a remporté le ${s} ?`
  },

  /* ---------- TENNIS & F1 : champions ---------- */
  {
    id: 'tennis_h', eraLabel: true, theme: 'sports', kind: 'assoc', fixed: true,
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{VALUES (?sw ?nm) {(wd:Q41520 "Wimbledon") (wd:Q43605 "Roland-Garros") (wd:Q123577 "l'US Open") (wd:Q60874 "l'Open d'Australie")} ?t wdt:P31 ?sw; wdt:P585 ?d. FILTER(YEAR(?d)>=1968) ?s wdt:P361 ?t; wdt:P2094 wd:Q16893072; wdt:P1346 ?a. BIND(CONCAT(?nm, " ", STR(YEAR(?d))) AS ?sL) ${lab('a', 'aL')}}`,
    keep: r => +r.sL.slice(-4) < new Date().getFullYear(),
    ask: s => `Qui a remporté ${s} (simple messieurs) ?`
  },
  {
    id: 'tennis_f', eraLabel: true, theme: 'sports', kind: 'assoc', fixed: true,
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{VALUES (?sw ?nm) {(wd:Q41520 "Wimbledon") (wd:Q43605 "Roland-Garros") (wd:Q123577 "l'US Open") (wd:Q60874 "l'Open d'Australie")} ?t wdt:P31 ?sw; wdt:P585 ?d. FILTER(YEAR(?d)>=1968) ?s wdt:P361 ?t; wdt:P2094 wd:Q16893403; wdt:P1346 ?a. BIND(CONCAT(?nm, " ", STR(YEAR(?d))) AS ?sL) ${lab('a', 'aL')}}`,
    keep: r => +r.sL.slice(-4) < new Date().getFullYear(),
    ask: s => `Qui a remporté ${s} (simple dames) ?`
  },
  {
    id: 'f1_champion', eraLabel: true, theme: 'sports', kind: 'assoc', fixed: true,
    q: `SELECT DISTINCT ?s ?sL ?a ?aL WHERE{?s wdt:P31 wd:Q108861375; wdt:P1346 ?a. ?a wdt:P31 wd:Q5. ?s rdfs:label ?el. FILTER(LANG(?el)="fr") BIND(STRAFTER(LCASE(?el), "formule 1 ") AS ?yr) BIND(CONCAT("la saison ", ?yr) AS ?sL) ${lab('a', 'aL')}}`,
    keep: r => +r.sL.slice(-4) < new Date().getFullYear(),
    ask: s => `Qui a été sacré champion du monde de Formule 1 lors de ${s} ?`
  },

  /* ---------- MUSIQUE ---------- */
  {
    id: 'music_album_artiste', theme: 'music', kind: 'assoc', fixed: true,
    q: () => `SELECT DISTINCT ?s ?sL ?a ?aL ?sy WHERE{VALUES ?s {${popVals(POP_ALBUMS, 'music')}} ?s wdt:P175 ?a. ${lab('s', 'sL')} ${lab('a', 'aL')} OPTIONAL{?s wdt:P577 ?sd. BIND(YEAR(?sd) AS ?sy)}}`,
    ask: s => `Qui est l'artiste de l'album « ${s} » ?`
  },
  {
    id: 'music_album_annee', theme: 'music', kind: 'year', fixed: true,
    q: () => `SELECT ?s ?sL0 ?arL (MIN(?y0) AS ?y) WHERE{VALUES ?s {${popVals(POP_ALBUMS, 'music')}} ?s wdt:P175 ?ar; wdt:P577 ?d. BIND(YEAR(?d) AS ?y0) ${lab('s', 'sL0')} ${lab('ar', 'arL')}} GROUP BY ?s ?sL0 ?arL`,
    map: r => ({ ...r, sL: `${r.sL0} (${r.arL})` }),
    ask: s => `En quelle année est sorti l'album « ${s} » ?`
  },
  {
    id: 'music_artiste_albums', theme: 'music', kind: 'assoc', fixed: true,
    q: () => `SELECT DISTINCT ?s ?sL ?a ?aL ?ay WHERE{VALUES ?a {${popVals(POP_ALBUMS, 'music')}} ?a wdt:P175 ?s. ${lab('s', 'sL')} ${lab('a', 'aL')} OPTIONAL{?a wdt:P577 ?ad. BIND(YEAR(?ad) AS ?ay)}}`,
    ask: s => `Lequel de ces albums est de ${s} ?`,
    odd: s => `Lequel de ces albums n'est PAS de ${s} ?`
  },

  {
    id: 'music_single', theme: 'music', kind: 'assoc', fixed: true,
    q: () => `SELECT DISTINCT ?s ?sL ?a ?aL ?sy WHERE{VALUES ?a {${popVals(POP_ARTISTS, 'music')}} ?s wdt:P31 wd:Q134556; wdt:P175 ?a; wikibase:sitelinks ?ssl. FILTER(?ssl>20) ${lab('s', 'sL')} ${lab('a', 'aL')} OPTIONAL{?s wdt:P577 ?sd. BIND(YEAR(?sd) AS ?sy)}} LIMIT 3000`,
    ask: s => `Qui chante « ${s} » ?`
  },
  {
    id: 'music_membres', theme: 'music', kind: 'assoc', fixed: true,
    q: () => `SELECT DISTINCT ?s ?sL ?a ?aL ?ay WHERE{VALUES ?s {${popVals(POP_ARTISTS, 'music')}} ?s wdt:P527 ?a. ?a wdt:P31 wd:Q5; wikibase:sitelinks ?msl. FILTER(?msl>35) ${lab('s', 'sL')} ${lab('a', 'aL')} ${BORN}}`,
    ask: s => `Lequel de ces musiciens a fait partie du groupe « ${s} » ?`,
    odd: s => `Lequel de ces musiciens n'a jamais fait partie du groupe « ${s} » ?`
  },

  /* ---------- CINÉMA ---------- */
  {
    id: 'cine_realisateur', theme: 'cinema', kind: 'assoc', fixed: true,
    q: () => `SELECT DISTINCT ?s ?sL ?a ?aL ?sy WHERE{VALUES ?s {${popVals(POP_FILMS, 'cinema')}} ?s wdt:P57 ?a. ${lab('s', 'sL')} ${lab('a', 'aL')} OPTIONAL{?s wdt:P577 ?sd. BIND(YEAR(?sd) AS ?sy)}}`,
    ask: s => `Qui a réalisé le film « ${s} » ?`
  },
  {
    id: 'cine_film_realisateur', theme: 'cinema', kind: 'assoc', fixed: true,
    q: () => `SELECT DISTINCT ?s ?sL ?a ?aL ?ay WHERE{VALUES ?a {${popVals(POP_FILMS, 'cinema')}} ?a wdt:P57 ?s. ${lab('s', 'sL')} ${lab('a', 'aL')} OPTIONAL{?a wdt:P577 ?ad. BIND(YEAR(?ad) AS ?ay)}}`,
    ask: s => `Lequel de ces films a été réalisé par ${s} ?`,
    odd: s => `Lequel de ces films n'a PAS été réalisé par ${s} ?`
  },
  {
    id: 'cine_annee', theme: 'cinema', kind: 'year', fixed: true,
    q: () => `SELECT ?s ?sL (MIN(?y0) AS ?y) WHERE{VALUES ?s {${popVals(POP_FILMS, 'cinema')}} ?s wdt:P577 ?d. BIND(YEAR(?d) AS ?y0) ${lab('s', 'sL')}} GROUP BY ?s ?sL`,
    ask: s => `En quelle année est sorti « ${s} » ?`
  },
  {
    id: 'cine_acteur', theme: 'cinema', kind: 'assoc', fixed: true,
    q: () => `SELECT DISTINCT ?s ?sL ?a ?aL ?ay WHERE{VALUES ?s {${popVals(POP_FILMS, 'cinema')}} ?s wdt:P161 ?a. ?a wdt:P106/wdt:P279* wd:Q33999; wikibase:sitelinks ?asl. FILTER(?asl>30) ${lab('s', 'sL')} ${lab('a', 'aL')} ${BORN}}`,
    ask: s => `Lequel de ces acteurs joue dans « ${s} » ?`,
    odd: s => `Lequel de ces acteurs ne joue PAS dans « ${s} » ?`
  }

];

/* ---------- niveaux de difficulté (un par thème) ----------
   0 = Facile (très célèbre), 1 = Normal, 2 = Difficile (sujets moins connus).
   Le niveau règle les seuils de « notoriété » (nombre de pages Wikipédia). */
const LEVEL_NAMES = ['Facile', 'Normal', 'Difficile'];
const LEVEL_FACTOR = [1.3, 1, 0.3];
const LEVELS = { foot: 2, nba: 2, sports: 2, music: 1, cinema: 1 };
const lvl = theme => (LEVELS[theme] === undefined ? 1 : LEVELS[theme]);
// fixed = questions sur des personnes : en Difficile on ne descend pas sous « Normal » (sinon sujets inconnus de tous)
const slv = (base, theme) => Math.max(3, Math.round(base * LEVEL_FACTOR[lvl(theme)])); // seuil de notoriété selon le niveau du thème
const byLevel = (theme, arr) => arr[lvl(theme)]; // [facile, normal, difficile]
const scaleQ = (q, theme, fixed) => q.replace(/(\?\w*sl)>(\d+)/g, (m, v, n) => v + '>' + Math.max(3, Math.round(n * (fixed ? Math.max(1, LEVEL_FACTOR[lvl(theme)]) : LEVEL_FACTOR[lvl(theme)]))));

/* ---------- construction des « pools » ---------- */
async function getPool(cat) {
  const lv = lvl(cat.theme);
  cat._p = cat._p || {};
  if (!cat._p[lv]) {
    cat._p[lv] = (async () => {
      let rows = cat.rows || await sparql(scaleQ(typeof cat.q === 'function' ? cat.q() : cat.q, cat.theme, cat.fixed));
      if (cat.map) rows = rows.map(cat.map);
      rows = rows.filter(r => !/(artistes? (vari[ée]s|divers)|various artists)/i.test((r.aL || '') + ' ' + (r.sL || '') + ' ' + (r.arL || '')));
      if (cat.keep) rows = rows.filter(cat.keep);
      return buildPool(cat, rows);
    })();
  }
  try { return await cat._p[lv]; } catch (e) { cat._p[lv] = null; throw e; }
}
function buildPool(cat, rows) {
  const subj = new Map(), all = new Map(), cnt = new Map(), ext = new Map();
  for (const r of rows) {
    const label = r.sL || r.s;
    if (cat.kind === 'year') {
      const y = +r.y; if (!y || y < 1000) continue;
      subj.set(r.s, { id: r.s, label, year: y });
      continue;
    }
    if (!r.a || !r.aL) continue;
    let o = subj.get(r.s);
    if (!o) { o = { id: r.s, label, ans: new Map() }; subj.set(r.s, o); }
    o.ans.set(r.a, r.aL);
    all.set(r.a, r.aL);
    cnt.set(r.a, (cnt.get(r.a) || 0) + 1);
    // proximité : époque (naissance du joueur, sortie de l'album, année de l'édition…) et groupe (pays du club…)
    let e = ext.get(r.a); if (!e) { e = { eras: new Set(), grs: new Set() }; ext.set(r.a, e); }
    const eraA = +r.ay || 0, eraS = cat.eraLabel ? +((label.match(/[0-9]{4}/) || [])[0]) || 0 : +r.sy || 0;
    if (eraA) e.eras.add(eraA); else if (eraS) e.eras.add(eraS);
    if (r.gr) e.grs.add(r.gr);
  }
  const list = [...all.entries()].map(([id, l]) => ({ id, l, w: cnt.get(id) || 1, eras: [...(ext.get(id) || { eras: [] }).eras], grs: [...(ext.get(id) || { grs: [] }).grs] }));
  return { cat, subj: [...subj.values()], all: list, byId: new Map(list.map(x => [x.id, x])) };
}
function wsample(list, n) { // tirage sans remise, favorisant les réponses fréquentes (donc plausibles)
  const pool = list.slice(), out = [];
  while (out.length < n && pool.length) {
    let tot = pool.reduce((a, x) => a + x.w, 0), r = Math.random() * tot, i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
// Difficile : on prend des mauvaises réponses de la même époque (et du même pays/groupe quand on le connait)
function pickClose(cands, C, n) {
  let pool = cands;
  if (C && C.grs && C.grs.length) { const g = pool.filter(x => x.grs && x.grs.some(v => C.grs.includes(v))); if (g.length >= n) pool = g; }
  if (C && C.eras && C.eras.length) {
    const d = x => (x.eras && x.eras.length) ? Math.min(...x.eras.flatMap(a => C.eras.map(b => Math.abs(a - b)))) : 99;
    for (const W of [4, 8, 15]) { const e = pool.filter(x => d(x) <= W); if (e.length >= n) { pool = e; break; } }
  }
  return wsample(pool, n);
}
function uniqByLabel(list) { const seen = new Set(), out = []; for (const x of list) { if (!seen.has(x.l)) { seen.add(x.l); out.push(x); } } return out; }

/* ---------- fabrication d'une question ---------- */
const GEO_GROUPS = [
  ['Royaume-Uni', 'Angleterre', 'Écosse', 'pays de Galles', 'Irlande du Nord', 'Grande-Bretagne'],
  ['Allemagne', 'Allemagne de l\'Ouest', 'Allemagne de l\'Est', 'République démocratique allemande', 'République fédérale d\'Allemagne'],
  ['Russie', 'Union soviétique', 'Empire russe'], ['Serbie', 'Yougoslavie', 'Serbie-et-Monténégro', 'République fédérale de Yougoslavie'],
  ['Tchéquie', 'Tchécoslovaquie'], ['Irlande', 'Irlande du Nord'], ['États-Unis', 'Porto Rico']
];
const related = l => GEO_GROUPS.some(g => g.includes(l)) ? GEO_GROUPS.filter(g => g.includes(l)).flat() : [];
// réponse « donnée » par la question (album éponyme : « Dire Straits » de Dire Straits) -> on l'évite
function triv(a, b) { const x = norm(a), y = norm(b); return x === y || (x.length > 3 && y.includes(x)) || (y.length > 3 && x.includes(y)); }
function qAssoc(pool, used, odd) {
  const cat = pool.cat;
  const good0 = s => [...s.ans.entries()].filter(([, l]) => !triv(s.label, l));
  let subs = pool.subj.filter(s => !used.has(cat.id + s.label) && good0(s).length >= (odd ? 3 : 1));
  if (!subs.length) subs = pool.subj.filter(s => good0(s).length >= (odd ? 3 : 1));
  if (!subs.length) return null;
  const s0 = pick(subs);
  const s = { ...s0, ans: new Map(good0(s0)) }; // sans les réponses triviales
  const ansIds = new Set(s0.ans.keys()), ansLabels = new Set(s0.ans.values());
  for (const l of [...ansLabels]) related(l).forEach(x => ansLabels.add(x)); // évite « Angleterre » à côté de « Royaume-Uni »
  const lastTok = l => norm(l).split(' ').pop(), ansLast = new Set([...ansLabels].map(lastTok)); // pas de « Ethan Coen » à côté de « Joel Coen »
  const outside = uniqByLabel(pool.all.filter(x => !ansIds.has(x.id) && !ansLabels.has(x.l) && !triv(s.label, x.l) && !(x.l.indexOf(' ') > 0 && ansLast.has(lastTok(x.l)))));
  if (odd) {
    const memEntries = sample([...s.ans.entries()], 3), members = memEntries.map(x => x[1]);
    if (!outside.length || members.length < 3) return null;
    let intrus;
    if (lvl(cat.theme) === 2) { // l'intrus doit ressembler aux 3 autres (même époque, même pays)
      const ms = memEntries.map(([id]) => pool.byId.get(id)).filter(Boolean);
      const eras = ms.flatMap(m => m.eras).sort((a, b) => a - b);
      intrus = pickClose(outside, { eras: eras.length ? [eras[Math.floor(eras.length / 2)]] : [], grs: [...new Set(ms.flatMap(m => m.grs))] }, 1)[0].l;
    } else intrus = pick(outside).l;
    const options = shuffle([intrus, ...members]);
    used.add(cat.id + s.label);
    return { catId: cat.id, theme: cat.theme, text: cat.odd(s.label), options, correct: options.indexOf(intrus), info: `Les 3 autres sont bien liés à « ${s.label} ».` };
  }
  const [gid, good] = pick([...s.ans.entries()]);
  const dist = (lvl(cat.theme) === 2 ? pickClose(outside, pool.byId.get(gid), 3) : sample(outside, 3)).map(x => x.l);
  if (dist.length < 3) return null;
  const options = shuffle([good, ...dist]);
  used.add(cat.id + s.label);
  return { catId: cat.id, theme: cat.theme, text: cat.ask(s.label), options, correct: options.indexOf(good), info: s.ans.size > 1 ? 'Réponses acceptées : ' + [...s.ans.values()].slice(0, 5).join(', ') : '' };
}
function qYear(pool, used) {
  const cat = pool.cat;
  let subs = pool.subj.filter(s => !used.has(cat.id + s.label));
  if (!subs.length) subs = pool.subj;
  if (!subs.length) return null;
  const s = pick(subs), thisYear = new Date().getFullYear();
  const L = lvl(cat.theme);
  const deltas = shuffle(L === 0 ? [-12, -10, -8, -7, -6, -5, 5, 6, 7, 8, 10, 12] : L === 2 ? [-3, -2, -1, 1, 2, 3] : [-10, -8, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 8, 10]);
  const ys = new Set([s.year]);
  for (const d of deltas) { const y = s.year + d; if (y <= thisYear && y > 1800 && ys.size < 4) ys.add(y); }
  if (ys.size < 4) return null;
  const options = [...ys].sort((a, b) => a - b).map(String);
  used.add(cat.id + s.label);
  return { catId: cat.id, theme: cat.theme, text: cat.ask(s.label), options, correct: options.indexOf(String(s.year)), info: '' };
}

/* ---------- blind test (extraits iTunes) ---------- */
const BLIND_ARTISTS = ['The Beatles', 'Queen', 'Pink Floyd', 'The Rolling Stones', 'Oasis', 'Coldplay', 'Adele', 'Ed Sheeran', 'Dua Lipa', 'Muse', 'Led Zeppelin', 'David Bowie', 'Elton John', 'Amy Winehouse', 'Harry Styles', 'Radiohead', 'Michael Jackson', 'Beyoncé', 'Eminem', 'Rihanna', 'Taylor Swift', 'Bruno Mars', 'Kanye West', 'Billie Eilish', 'Lady Gaga', 'Ariana Grande', 'Katy Perry', 'Madonna', 'Prince', 'Whitney Houston', 'Nirvana', 'Metallica', 'Linkin Park', 'Imagine Dragons', 'Maroon 5', 'Justin Timberlake', 'Britney Spears', 'Elvis Presley', 'Bob Dylan', 'Bon Jovi', 'Guns N Roses', 'Red Hot Chili Peppers', 'Green Day', 'Black Eyed Peas', 'Snoop Dogg', '50 Cent', 'Jay-Z', 'Mariah Carey', 'Lil Nas X', 'Daft Punk', 'David Guetta', 'Aya Nakamura', 'Angèle', 'Orelsan', 'Indochine', 'Johnny Hallyday', 'Céline Dion', 'Maître Gims', 'Jain', 'Soprano', 'Jul', 'Nekfeu', 'Renaud', 'Edith Piaf', 'Charles Aznavour', 'Francis Cabrel', 'Mylène Farmer', 'Kendji Girac', 'Vitaa', 'Slimane', 'Louane', 'Christine and the Queens', 'Zaz', 'Julien Doré', 'Vianney', 'Booba', 'PNL', 'Ninho', 'Dadju', 'M. Pokora', 'Patrick Bruel', 'Michel Sardou', 'Jean-Jacques Goldman', 'Serge Gainsbourg', 'Claude François', 'Dalida', 'Air', 'Justice'];
const blindCache = new Map();
async function artistTracks(artist) {
  if (blindCache.has(artist)) return blindCache.get(artist);
  const u = 'https://itunes.apple.com/search?media=music&entity=song&limit=20&country=FR&term=' + encodeURIComponent(artist);
  const key = 'it:' + hash(u);
  let res = await DB.get(key);
  if (!res || Date.now() - res.t > 30 * 864e5) {
    const j = await (await fetch(u)).json();
    res = { t: Date.now(), tracks: (j.results || []).filter(r => r.previewUrl && r.trackName).map(r => ({ title: r.trackName, artist: r.artistName, url: r.previewUrl })) };
    DB.set(key, res);
  }
  const first = norm(artist).split(' ')[0];
  const tracks = res.tracks.filter(t => norm(t.artist).includes(first)).map(t => ({ ...t, title: t.title.replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/\s+-\s+.*$/, '').trim() })).filter(t => t.title);
  blindCache.set(artist, tracks);
  return tracks;
}
async function qBlind(used) {
  const arts = sample(BLIND_ARTISTS, 6);
  const lists = (await Promise.all(arts.map(a => artistTracks(a).catch(() => [])))).filter(l => l.length);
  if (lists.length < 4) return null;
  const top = [5, 8, 20][lvl('music')], goodList = lists[0].slice(0, top), t = pick(goodList); // iTunes classe par popularité : on ne garde que les tubes
  if (used.has('blind' + t.title)) return null;
  const byTitle = Math.random() < 0.5;
  const others = lists.slice(1, 4).map(l => pick(l.slice(0, top)));
  const opts = byTitle ? [t.title, ...others.map(o => o.title)] : [t.artist, ...others.map(o => o.artist)];
  if (new Set(opts.map(norm)).size < 4) return null;
  const options = shuffle(opts), good = byTitle ? t.title : t.artist;
  used.add('blind' + t.title);
  return {
    catId: 'music_blind', theme: 'music', audio: t.url,
    text: byTitle ? 'Blind test : quel est ce titre ?' : 'Blind test : qui chante ce morceau ?',
    options, correct: options.indexOf(good), info: `« ${t.title} » — ${t.artist}`
  };
}

/* ---------- point d'entrée : une question pour un thème ---------- */
async function generateQuestion(theme, session) {
  const cats = shuffle(CATS.filter(c => c.theme === theme && !session.bad.has(c.id) && !(c.easy && lvl(theme) === 2) && !c.noQ));
  // évite de répéter la même catégorie de suite
  cats.sort((a, b) => (session.recent.includes(a.id) ? 1 : 0) - (session.recent.includes(b.id) ? 1 : 0));
  let lastErr;
  for (const cat of cats.slice(0, 6)) {
    try {
      let q;
      if (cat.special === 'blind') q = await qBlind(session.used);
      else {
        const pool = await getPool(cat);
        if (cat.kind === 'year') q = qYear(pool, session.used);
        else q = qAssoc(pool, session.used, !!cat.odd && Math.random() < [0.2, 0.35, 0.65][lvl(cat.theme)]) || qAssoc(pool, session.used, false);
      }
      if (q && q.options.length === 4 && q.correct >= 0) {
        session.recent = [cat.id, ...session.recent].slice(0, 3);
        return q;
      }
      session.bad.add(cat.id);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Aucune question disponible pour ' + THEMES[theme].n);
}

/* ==========================================================================
   MODE ÉNUMÉRATION
   Renvoie { theme, title, sub, person, items:[labels] }
   ========================================================================== */
const labelRows = (rows, key = 'pL') => [...new Set(rows.map(r => r[key]).filter(Boolean))];

async function enumRoster(clubId, clubName, year, theme) {
  if (year) {
    // Seulement les joueurs qui ont joué : le passage au club doit avoir des matchs (P1350) et recouvrir la saison.
    // Une date d'arrivée « à l'année » (1er janvier) ne compte que si l'année est celle du début de saison
    // (sinon Varane arrivé en 2011 apparaissait dans l'effectif 2010-11).
    const q = `SELECT DISTINCT ?p ?pL ?sl WHERE{?p p:P54 ?st. ?st ps:P54 wd:${clubId}; pq:P580 ?start; pq:P1350 ?apps. OPTIONAL{?st pq:P582 ?end}
      FILTER(?apps >= ${byLevel(theme, [10, 5, 2])})
      FILTER(((MONTH(?start)=1 && DAY(?start)=1 && YEAR(?start) <= ${year}) || (!(MONTH(?start)=1 && DAY(?start)=1) && ?start <= "${year + 1}-01-31T00:00:00Z"^^xsd:dateTime)) && ((BOUND(?end) && ?end >= "${year}-08-31T00:00:00Z"^^xsd:dateTime) || (!BOUND(?end) && ${year >= 2023})))
      ?p wikibase:sitelinks ?sl. FILTER(?sl>${slv(12, theme)}) ${lab('p', 'pL')}} ORDER BY DESC(?sl) LIMIT ${byLevel(theme, [20, 30, 40])}`;
    const items = labelRows(await sparql(q));
    if (items.length >= 6) return { theme, title: `${clubName} — saison ${year}-${String(year + 1).slice(2)}`, sub: 'Citez les joueurs qui ont joué cette saison-là', person: true, items };
  }
  const q = `SELECT DISTINCT ?p ?pL ?sl WHERE{?p p:P54 [ps:P54 wd:${clubId}]; wikibase:sitelinks ?sl. FILTER(?sl>${slv(20, theme)}) ${lab('p', 'pL')}} ORDER BY DESC(?sl) LIMIT ${byLevel(theme, [25, 35, 45])}`;
  const items = labelRows(await sparql(q));
  if (items.length < 6) throw new Error('Pas assez de données pour ' + clubName);
  const note = year ? ` (pas assez de données pour ${year}-${String(year + 1).slice(2)}, toutes époques)` : ' (toutes époques)';
  return { theme, title: clubName, sub: 'Citez les joueurs qui ont porté ce maillot' + note, person: true, items };
}
async function enumAlbums(id, name) {
  const items = labelRows(await sparql(`SELECT DISTINCT ?a ?aL WHERE{?a wdt:P31 wd:Q482994; wdt:P175 wd:${id}; wikibase:sitelinks ?sl. FILTER(?sl>${slv(8, 'music')}) ${lab('a', 'aL')}} ORDER BY DESC(?sl) LIMIT ${byLevel('music', [15, 25, 40])}`), 'aL');
  if (items.length < 4) throw new Error('Pas assez d\'albums pour ' + name);
  return { theme: 'music', title: name, sub: 'Citez les albums', person: false, items };
}
async function enumMembers(id, name) {
  const items = labelRows(await sparql(`SELECT DISTINCT ?m ?mL WHERE{{wd:${id} wdt:P527 ?m} UNION {?m wdt:P463 wd:${id}} ?m wdt:P31 wd:Q5. ${lab('m', 'mL')}} LIMIT 40`), 'mL');
  if (items.length < 3) throw new Error('Pas assez de membres pour ' + name);
  return { theme: 'music', title: name, sub: 'Citez les membres (anciens et actuels)', person: true, items };
}
async function enumFilms(id, name) {
  const items = labelRows(await sparql(`SELECT DISTINCT ?f ?fL ?sl WHERE{?f wdt:P31 wd:Q11424; wdt:P57 wd:${id}; wikibase:sitelinks ?sl. FILTER(?sl>${slv(12, 'cinema')}) ${lab('f', 'fL')}} ORDER BY DESC(?sl) LIMIT ${byLevel('cinema', [15, 25, 35])}`), 'fL');
  if (items.length < 4) throw new Error('Pas assez de films pour ' + name);
  return { theme: 'cinema', title: name, sub: 'Citez les films réalisés', person: false, items };
}
async function enumCast(id, name) {
  const items = labelRows(await sparql(`SELECT DISTINCT ?a ?aL ?sl WHERE{wd:${id} wdt:P161 ?a. ?a wikibase:sitelinks ?sl. FILTER(?sl>${slv(20, 'cinema')}) ${lab('a', 'aL')}} ORDER BY DESC(?sl) LIMIT ${byLevel('cinema', [15, 25, 35])}`), 'aL');
  if (items.length < 4) throw new Error('Pas assez de casting pour ' + name);
  return { theme: 'cinema', title: name, sub: 'Citez les acteurs du film', person: true, items };
}
async function enumSport(id, name) {
  const items = labelRows(await sparql(`SELECT DISTINCT ?p ?pL ?sl WHERE{?p wdt:P31 wd:Q5; wdt:P106/wdt:P279* wd:Q2066131; wdt:P641 wd:${id}; wikibase:sitelinks ?sl. FILTER(?sl>${slv(40, 'sports')}) ${lab('p', 'pL')}} ORDER BY DESC(?sl) LIMIT ${byLevel('sports', [20, 30, 40])}`));
  if (items.length < 6) throw new Error('Pas assez de sportifs pour ' + name);
  return { theme: 'sports', title: `Sportifs célèbres : ${name}`, sub: 'Citez des sportifs de ce sport', person: true, items };
}
async function enumFromCat(catId, theme, title, sub, person, cap) {
  const pool = await getPool(CATS.find(c => c.id === catId));
  let items = [...new Set(pool.all.map(x => x.l))];
  if (cap && items.length > cap) items = shuffle(items).slice(0, cap);
  if (items.length < 6) throw new Error('Liste trop courte : ' + title);
  return { theme, title, sub, person, items };
}

/* listes de départ pour les tirages aléatoires */
async function topList(key, q) { return sparql(scaleQ(q, /^(artists|groups)$/.test(key) ? 'music' : 'cinema'), 30); }
async function randomEnum(theme, session) {
  const gens = {
    foot: [
      async () => { const [id, name] = pick(CLUBS.slice(0, byLevel('foot', [8, 19, 19]))); const y0 = byLevel('foot', [2002, 1996, 1990]); return enumRoster(id, name, y0 + rnd(2024 - y0), 'foot'); },
      async () => { const [id, name] = pick(CLUBS.slice(0, byLevel('foot', [8, 19, 19]))); const y0 = byLevel('foot', [2002, 1996, 1990]); return enumRoster(id, name, y0 + rnd(2024 - y0), 'foot'); },
      () => enumFromCat('foot_ballon', 'foot', 'Vainqueurs du Ballon d\'or', 'Citez des joueurs qui ont remporté le Ballon d\'or', true)
    ],
    nba: [
      async () => { const pool = await getPool(CATS.find(c => c.id === 'nba_salle')); const t = pick(pool.subj); return enumRoster(t.id, t.label, 0, 'nba'); },
      () => enumFromCat('nba_mvp', 'nba', 'MVP de la NBA', 'Citez des joueurs élus MVP de la saison régulière', true),
      () => enumFromCat('nba_finales', 'nba', 'Champions NBA', 'Citez les franchises déjà sacrées championnes NBA', false)
    ],
    sports: [
      () => enumFromCat('jo_ville', 'sports', 'Villes hôtes des JO d\'été', 'Citez les villes qui ont accueilli les Jeux d\'été', false),
      () => enumFromCat('f1_champion', 'sports', 'Champions du monde de Formule 1', 'Citez des pilotes sacrés champions du monde', true, byLevel('sports', [15, 30, 45])),
      () => enumFromCat('tennis_h', 'sports', 'Vainqueurs de Grand Chelem (messieurs)', 'Citez des joueurs ayant remporté un tournoi du Grand Chelem depuis 1968', true, byLevel('sports', [15, 30, 45])),
      () => enumFromCat('tennis_f', 'sports', 'Vainqueures de Grand Chelem (dames)', 'Citez des joueuses ayant remporté un tournoi du Grand Chelem depuis 1968', true, byLevel('sports', [15, 30, 45])),
      async () => { // champions olympiques connus (Rio 2016, Tokyo 2020, Paris 2024), par discipline
        const pool = await getPool(CATS.find(c => c.id === 'oly_champion'));
        const bySport = new Map();
        for (const a of pool.all) for (const g of a.grs) { const sp = g.split('|')[0]; if (!bySport.has(sp)) bySport.set(sp, new Set()); bySport.get(sp).add(a.l); }
        const ok = [...bySport.entries()].filter(([, set]) => set.size >= 6);
        if (!ok.length) throw new Error('Pas assez de champions olympiques');
        const [sp, set] = pick(ok);
        return { theme: 'sports', title: `Champions olympiques : ${sp}`, sub: 'Citez des champions olympiques de Rio 2016, Tokyo 2020 et Paris 2024', person: true, items: [...set] };
      }
    ],
    music: [
      async () => { // albums d'un artiste du top des ventes
        const r = pick(popSlice(POP_ARTISTS, 'music')); return enumAlbums(r[0], r[1]);
      },
      async () => { // membres d'un groupe du top des ventes
        const rows = await topList('groups', `SELECT ?g ?gL (COUNT(?m) AS ?n) WHERE{VALUES ?g {${popVals(POP_ARTISTS, 'music')}} ?g wdt:P527 ?m. ?m wdt:P31 wd:Q5. ${lab('g', 'gL')}} GROUP BY ?g ?gL HAVING(COUNT(?m)>=3)`);
        const r = pick(rows); return enumMembers(r.g, r.gL);
      }
    ],
    cinema: [
      async () => { // films d'un réalisateur qui a plusieurs films dans le top
        const rows = await topList('directors', `SELECT ?d ?dL (COUNT(?f) AS ?n) WHERE{VALUES ?f {${popVals(POP_FILMS, 'cinema')}} ?f wdt:P57 ?d. ${lab('d', 'dL')}} GROUP BY ?d ?dL HAVING(COUNT(?f)>=3)`);
        const r = pick(rows); return enumFilms(r.d, r.dL);
      },
      async () => { // acteurs d'un film du top
        const r = pick(popSlice(POP_FILMS, 'cinema')); return enumCast(r[0], r[1]);
      }
    ]
  }[theme];
  let lastErr;
  for (let i = 0; i < 12; i++) {
    const g = pick(gens);
    try {
      const e = await g();
      if (!session.used.has('enum' + e.title)) { session.used.add('enum' + e.title); return e; }
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Aucune liste disponible pour ' + THEMES[theme].n);
}

/* ---------- vérification des réponses tapées ---------- */
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m + n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const ARTICLES = /^(le|la|les|l|un|une|the|a|an|de|du|des)\s+/;
class Matcher {
  constructor(items, person) {
    this.person = person;
    this.items = items.map(label => {
      const full = norm(label), keys = new Set([full]);
      const toks = full.split(' ');
      if (person) {
        if (toks.length > 1) { keys.add(toks[toks.length - 1]); keys.add(toks.slice(-2).join(' ')); }
      } else {
        const noArt = full.replace(ARTICLES, ''); keys.add(noArt);
        const noSub = noArt.split(' ').length > 2 ? noArt : noArt; keys.add(noSub);
      }
      return { label, full, keys: [...keys].filter(k => k.length >= 2), found: -1 };
    });
  }
  guess(text) {
    let g = norm(text); if (!this.person) g = g.replace(ARTICLES, '');
    if (g.length < 2) return { status: 'no' };
    // exact
    const exact = this.items.filter(it => it.keys.includes(g));
    if (exact.length) {
      const free = exact.find(it => it.found < 0);
      return free ? { status: 'ok', item: free } : { status: 'dup', item: exact[0] };
    }
    // tolérance aux fautes de frappe
    let best = null, bestD = 99;
    for (const it of this.items) {
      for (const k of it.keys) {
        if (k.length < 4 || g.length < 4) continue;
        const tol = k.length >= 9 ? 2 : 1;
        const d = lev(g, k);
        if (d <= tol && d < bestD && (it.found < 0 || !best)) { best = it; bestD = d; }
        else if (d <= tol && d < bestD) { best = it; bestD = d; }
      }
    }
    if (best) return best.found < 0 ? { status: 'ok', item: best } : { status: 'dup', item: best };
    return { status: 'no' };
  }
}

/* Club autorisé : 5 grands championnats européens (foot) ou NBA. Les sélections nationales ne passent pas par ici. */
async function isAllowedTeam(id) {
  const rows = await sparql(`SELECT ?lg WHERE{wd:${id} wdt:P118 ?lg. FILTER(?lg IN (${BIG5}, wd:Q155223))}`, 30);
  return rows.length > 0;
}
