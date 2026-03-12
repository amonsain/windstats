#!/usr/bin/env node
/**
 * test-dpclim.js — test API Climatologique MF
 * Usage : MF_CLIM_API_KEY=ta_clé node test-dpclim.js
 */

const https = require('https');

const MF_CLIM_API_KEY = process.env.MF_API_KEY_CLIM;
const BASE    = 'public-api.meteofrance.fr';
const STATION = '31042012';

if (!MF_CLIM_API_KEY) { console.error('MF_CLIM_API_KEY manquant'); process.exit(1); }

function httpGet(path) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: BASE, path, headers: { apikey: MF_CLIM_API_KEY } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function main() {
  // Étape 1 : passer commande
  const dateDeb = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().replace(/\.\d+Z/, 'Z');
  const dateFin = new Date().toISOString().replace(/\.\d+Z/, 'Z');
  const cmdPath = `/public/DPClim/v1/commande-station/horaire` +
    `?id-station=${STATION}` +
    `&date-deb-periode=${encodeURIComponent(dateDeb)}` +
    `&date-fin-periode=${encodeURIComponent(dateFin)}`;

  console.log('📡 Commande:', cmdPath);
  const cmd = await httpGet(cmdPath);
  console.log('Status:', cmd.status);
  if (cmd.status !== 202) {
    console.error('Commande refusée:', cmd.body);
    return;
  }

  // Extraire l'id-cmde
  const parsed = JSON.parse(cmd.body);
  const idCmde = parsed?.elaboreProduitAvecDemandeResponse?.return;
  console.log('📋 id-cmde:', idCmde);

  // Étape 2 : poller jusqu'à ce que le fichier soit prêt
  const filePath = `/public/DPClim/v1/commande/fichier?id-cmde=${idCmde}`;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const f = await httpGet(filePath);
    console.log(`Poll ${i+1}: status=${f.status}`);
    if (f.status === 201) {
      console.log('\n✅ Fichier prêt! Premiers 2000 chars:');
      console.log(f.body.slice(0, 2000));
      return;
    }
    if (f.status === 204) { console.log('  En attente...'); continue; }
    console.log('  Réponse inattendue:', f.body.slice(0, 200));
    break;
  }
}

main().catch(console.error);
