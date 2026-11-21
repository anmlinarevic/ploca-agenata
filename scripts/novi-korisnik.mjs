#!/usr/bin/env node
// SQL za novog korisnika. Vlasnik: veže se uz zakupca. Savjetnik: bez zakupca (vidi sve).
// Upotreba: node scripts/novi-korisnik.mjs <email> vlasnik <zakupac>  |  node scripts/novi-korisnik.mjs <email> savjetnik
import { randomUUID } from 'node:crypto';
const [email, uloga, zakupac] = process.argv.slice(2);
if (!email || !['vlasnik', 'savjetnik'].includes(uloga) || (uloga === 'vlasnik' && !zakupac)) {
  console.error('Upotreba: node scripts/novi-korisnik.mjs <email> vlasnik <zakupac> | <email> savjetnik'); process.exit(1);
}
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
console.log(`INSERT INTO users (id, tenant_id, email, uloga) VALUES (${q(randomUUID())}, ${uloga === 'vlasnik' ? q(zakupac) : 'NULL'}, ${q(email.toLowerCase())}, ${q(uloga)});`);
