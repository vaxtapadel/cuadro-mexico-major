// Lee el cronograma de premierpadel.com y actualiza data.json.
// Uso: node scripts/scrape.mjs            (abre la página con Playwright)
//      node scripts/scrape.mjs --text f.json  (prueba con textos ya guardados)
import fs from 'node:fs';

const URL = 'https://premierpadel.com/es/tournaments-detail/mexico-major';
const DAYS = ['26', '27', '28', '29'];
const GENDERS = { m: 'MASCULINO', w: 'FEMENINO' };
const LAST_DAY = new Date('2026-12-01T06:00:00Z'); // 1 dic 00:00 hora de México

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// "A. TAPIA(1)" -> "tapia" ; "Dal Pozzo" -> "dal"
function surnameKey(name) {
  let n = String(name).replace(/\(\d+\)\s*$/, '').trim();
  n = n.replace(/^[A-ZÁÉÍÓÚÑ]\.\s*/i, '');
  return norm(n.split(/\s+/)[0]);
}
const teamKey = names => names.map(surnameKey).sort().join('+');
const bracketKey = label => teamKey(String(label).split('/').map(s => s.trim()));

// ---------- parser del texto de la página ----------
const HEADER = /^CANCHA\s+(.+?)\|\s*(R\d+|QF|SF|F|FINAL)\s*$/i;
const COURT_ONLY = /^CANCHA\s+[^|]+$/i;
const STATUS = /^(COMPLETADO|EN VIVO|EN CANCHA|COMIENZA PRONTO|EMPIEZA EN:?|SUSPENDIDO|RETIRADO|W\.?O\.?)$/i;
const NAME = /^([A-ZÁÉÍÓÚÑ]\.\s*\S.*|BYE)$/i;
const NUM = /^(\d{1,2}|AD|A)$/i;
const DUR = /^\d{2}:\d{2}:\d{2}$/;
const COUNTDOWN = /^(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})$/;

export function parse(text, now = new Date()) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const out = [];
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (const t of lines) {
    if (/^SOCIOS DE TURISMO$/i.test(t)) break;
    const h = t.match(HEADER);
    if (h) {
      flush();
      cur = { court: titleCourt(h[1]), round: h[2].toUpperCase(), status: '', teams: [[], []], nums: [[], []], win: [false, false], startsAt: null };
      cur._side = 0;
      continue;
    }
    if (!cur) continue;
    if (COURT_ONLY.test(t)) { flush(); continue; }
    if (STATUS.test(t)) { cur.status = t.toUpperCase().replace(/:$/, ''); continue; }
    const cd = t.match(COUNTDOWN);
    if (cd) {
      const ms = (((+cd[1] * 24 + +cd[2]) * 60 + +cd[3]) * 60 + +cd[4]) * 1000;
      cur.startsAt = new Date(now.getTime() + ms);
      continue;
    }
    if (DUR.test(t)) continue;
    if (NAME.test(t)) {
      if (cur.teams[cur._side].length >= 2 || (cur._side === 0 && (cur.nums[0].length || cur.win[0]))) cur._side = 1;
      if (cur.teams[cur._side].length >= 2) continue;
      cur.teams[cur._side].push(t);
      continue;
    }
    if (t === 'W') { cur.win[cur._side] = true; continue; }
    if (NUM.test(t)) { cur.nums[cur._side].push(t.toUpperCase()); continue; }
  }
  flush();
  return out.filter(m => m.teams[0].length === 2 && m.teams[1].length === 2 && !/BYE/i.test(m.teams.flat().join(' ')));
}

function titleCourt(s) {
  const n = s.trim().toUpperCase();
  if (n.includes('5TA')) return '5ta Avenida';
  return n.charAt(0) + n.slice(1).toLowerCase();
}

// Convierte un partido leído en marcador desde el lado a
function scoreOf(m) {
  const live = m.status === 'EN VIVO';
  let A = m.nums[0].slice(), B = m.nums[1].slice();
  // en vivo, el último número de cada lado es el punto del juego en curso
  if (live && A.length >= 2 && A.length === B.length) { A.pop(); B.pop(); }
  const sets = [];
  for (let i = 0; i < Math.min(A.length, B.length); i++) sets.push(`${A[i]}-${B[i]}`);
  return sets.join(' ');
}

// ---------- obtención con Playwright ----------
async function fetchTexts() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'es-MX', timezoneId: 'America/Mexico_City' });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const deny = page.getByRole('button', { name: /^Deny$|^Rechazar$|^Denegar$/ });
  if (await deny.count()) await deny.first().click().catch(() => {});
  const texts = {};
  for (const day of DAYS) {
    for (const [g, label] of Object.entries(GENDERS)) {
      const ok = await page.evaluate(([day, label]) => {
        const click = re => {
          const els = [...document.querySelectorAll('button,div,span,a')].filter(e => e.children.length <= 3 && re.test((e.innerText || '').trim()));
          const t = els[els.length - 1]; if (t) t.click(); return !!t;
        };
        const a = click(new RegExp('^' + day + '\\s*NOV$', 'i'));
        return a;
      }, [day, label]);
      if (!ok) continue;
      await page.waitForTimeout(2500);
      await page.evaluate(label => {
        const els = [...document.querySelectorAll('button')].filter(e => (e.innerText || '').trim().toUpperCase() === label);
        if (els[0]) els[0].click();
      }, label);
      await page.waitForTimeout(2500);
      const txt = await page.evaluate(() => {
        const b = document.body.innerText; const i = b.indexOf('Partidos de Jugadores Favoritos');
        return i < 0 ? '' : b.slice(i);
      });
      texts[`${day}-${g}`] = txt;
    }
  }
  await browser.close();
  return texts;
}

// ---------- aplicar al cuadro ----------
function winnerLabel(m) { return !m || !m.w ? null : (m.w === 'a' ? [m.a, m.sa] : [m.b, m.sb]); }

function apply(draw, matches, now) {
  const rounds = draw.rounds;
  let changed = false;
  const set = (obj, k, v) => {
    if (v === undefined || v === null || v === '') { if (k in obj) { delete obj[k]; changed = true; } return; }
    if (obj[k] !== v) { obj[k] = v; changed = true; }
  };
  for (let r = 0; r < rounds.length; r++) {
    // contar orden por pista para turnos
    rounds[r].matches.forEach((slot, j) => {
      if (r > 0) {
        const prev = rounds[r - 1].matches;
        const A = winnerLabel(prev[2 * j]), B = winnerLabel(prev[2 * j + 1]);
        if (A && slot.a !== A[0]) { set(slot, 'a', A[0]); set(slot, 'sa', A[1]); }
        if (B && slot.b !== B[0]) { set(slot, 'b', B[0]); set(slot, 'sb', B[1]); }
      }
      if (!slot.a || !slot.b) return;
      const ka = bracketKey(slot.a), kb = bracketKey(slot.b);
      const found = matches.find(m => {
        const x = teamKey(m.teams[0]), y = teamKey(m.teams[1]);
        return (x === ka && y === kb) || (x === kb && y === ka);
      });
      if (!found) return;
      const flip = teamKey(found.teams[0]) !== ka;
      let score = scoreOf(found);
      if (flip) score = score.split(' ').filter(Boolean).map(s => s.split('-').reverse().join('-')).join(' ');
      const live = found.status === 'EN VIVO' || found.status === 'EN CANCHA';
      let w = null;
      if (found.win[0] || found.win[1]) w = (found.win[0] !== flip) ? 'a' : 'b';
      set(slot, 'court', found.court);
      set(slot, 'score', score || null);
      set(slot, 'w', w);
      set(slot, 'live', !w && live ? true : null);
      let time = null;
      if (!w && !live) {
        if (found.status === 'COMIENZA PRONTO') time = 'Comienza pronto';
        else if (found.turn > 0) time = `${found.turn + 1}º turno`;
        else if (found.startsAt) {
          const d = new Date(Math.round(found.startsAt.getTime() / 900000) * 900000);
          time = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' });
        }
      } else if (live && !found.nums[0].length) time = found.status === 'EN CANCHA' ? 'En cancha' : null;
      set(slot, 'time', time);
    });
  }
  // estado
  const names = { r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinales', f: 'Final' };
  let status = '';
  const fin = rounds[rounds.length - 1].matches[0];
  if (fin && fin.w) status = 'Torneo terminado';
  else {
    for (const rd of rounds) {
      const ms = rd.matches;
      if (ms.every(m => m.w)) continue;
      const live = ms.some(m => m.live);
      status = `${names[rd.key] || rd.name} ${live ? 'en juego' : '· ' + (rd.day || '').split('·')[0].trim()}`;
      break;
    }
  }
  if (status && draw.status !== status) { draw.status = status; changed = true; }
  return changed;
}

async function main() {
  const now = new Date();
  if (now > LAST_DAY) { console.log('Torneo terminado: no hay nada que actualizar.'); return; }
  const argi = process.argv.indexOf('--text');
  const texts = argi > 0 ? JSON.parse(fs.readFileSync(process.argv[argi + 1], 'utf8')) : await fetchTexts();
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  let changed = false;
  for (const g of Object.keys(GENDERS)) {
    const all = [];
    for (const day of DAYS) {
      const txt = texts[`${day}-${g}`];
      if (!txt) continue;
      const ms = parse(txt, now);
      const perCourt = {};
      for (const m of ms) { m.turn = perCourt[m.court] = (perCourt[m.court] ?? -1) + 1; }
      all.push(...ms);
    }
    console.log(`${g}: ${all.length} partidos leídos`);
    if (all.length && apply(data.draws[g], all, now)) changed = true;
  }
  if (changed) {
    data.updated = new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }).replace(' ', 'T') + '-06:00';
    fs.writeFileSync('data.json', JSON.stringify(data, null, 1) + '\n');
    console.log('data.json actualizado');
  } else console.log('Sin cambios');
}

main().catch(e => { console.error(e); process.exit(1); });
