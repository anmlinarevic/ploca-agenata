#!/usr/bin/env node
// Generira agent token. Token se ispiše JEDNOM; u bazu ide samo hash.
// Upotreba: TOKEN_PEPPER=... node scripts/novi-token.mjs <zakupac> <agent> [alati|*] [izlaz.sql]
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

// Zadani alati po ulozi agenta (najmanje potrebno). Treći argument: '*', popis ili 'zadano'.
const CITANJE = 'dohvati_registar,dohvati_izvjestaje,dohvati_izvjestaj,dohvati_odobrene_odluke,dohvati_nove_zadatke,dohvati_otvorene_odluke,dohvati_tjedne,dohvati_mjesecno,dohvati_aktivnost,dohvati_napredak,dohvati_konkurente,izvezi_ploca';
const PRESETI = {
  koordinator: '*',
  konkurencija: `${CITANJE},azuriraj_konkurenta,dodaj_aktivnost,dodaj_odluku,spremi_izvjestaj`,
  seo: `${CITANJE},spremi_registar,dodaj_aktivnost,dodaj_odluku,spremi_izvjestaj`,
  ai: `${CITANJE},spremi_registar,upisi_mjesecno,dodaj_aktivnost,dodaj_odluku,spremi_izvjestaj`,
  sadrzaj: `${CITANJE},spremi_registar,dodaj_aktivnost,dodaj_odluku,spremi_izvjestaj`,
  lokalno: `${CITANJE},spremi_registar,dodaj_aktivnost,dodaj_odluku,spremi_izvjestaj`,
  oglasi: `${CITANJE},dodaj_aktivnost,dodaj_odluku,spremi_izvjestaj`,
  // Claude Code sesije koje izrađuju objave: samo prijedlozi, bez odobravanja (odobrava vlasnik na ploči).
  kreator: `${CITANJE},dodaj_aktivnost,zatrazi_ucitavanje,predlozi_plan_tjedna,predlozi_objavu,azuriraj_objavu,dohvati_objave,dohvati_racune,dohvati_knjiznicu,zatrazi_preuzimanje`,
};
const [zakupac, agent, alatiArg = 'zadano', izlaz] = process.argv.slice(2);
const alati = alatiArg === 'zadano' ? (PRESETI[agent] ?? CITANJE) : alatiArg;
const pepper = process.env.TOKEN_PEPPER ?? '';
if (!zakupac || !agent) { console.error('Upotreba: node scripts/novi-token.mjs <zakupac> <agent> [alati|*] [izlaz.sql]'); process.exit(1); }
if (!pepper) console.error('UPOZORENJE: TOKEN_PEPPER nije postavljen (u redu samo za lokalni razvoj).');

const token = 'pl_' + randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(pepper + token).digest('hex');
const esc = (s) => s.replaceAll("'", "''");
const sql = `INSERT INTO agent_tokeni (id, tenant_id, hash, agent, dopusteni_alati) VALUES ('${randomUUID()}', '${esc(zakupac)}', '${hash}', '${esc(agent)}', '${esc(alati)}');\n`;

if (izlaz) writeFileSync(izlaz, sql); else process.stdout.write(`-- SQL:\n${sql}\n`);
console.log(`TOKEN (spremi odmah, više se ne može pročitati): ${token}`);
