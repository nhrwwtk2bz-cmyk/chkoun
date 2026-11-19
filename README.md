# Chkoun Akther Wa7ed? 🎉

Jeu de soirée multijoueur en Derja tounsi (latin). Chaque joueur utilise son téléphone, vote en secret, résultats révélés en même temps.

## Lancer
```bash
node server.js        # aucune dépendance, aucun compte externe
# http://localhost:3000
```
Node 18+ suffit. Les téléphones sur le même Wi-Fi peuvent utiliser l'adresse LAN affichée au démarrage (le QR l'utilise automatiquement).

## Jouer avec des amis (internet) — déploiement
Le serveur garde les parties en mémoire : déployez **une seule instance** sur un hébergeur Node (Render, Railway, Fly.io…).
- Build : *(aucun)* — Start : `npm start`
- Variable conseillée : `PUBLIC_URL=https://votre-app.onrender.com` (pour que le QR pointe vers l'URL publique)
- Le HTTPS est fourni par l'hébergeur. Le plan gratuit de Render s'endort après inactivité : ouvrez l'URL une fois avant la soirée.

## Architecture
- **Temps réel** : Server-Sent Events (serveur → clients) + POST JSON (clients → serveur). Reconnexion automatique.
- **Serveur autoritatif** : tout l'état vit côté serveur.
- **Anonymat** : les votes individuels ne quittent jamais la mémoire du serveur ; les clients reçoivent seulement les totaux par joueur (et leur propre vote).
- **Déconnexions** : délai de grâce 12 s, vote verrouillé conservé, migration du host, joueurs en retard = spectateurs jusqu'au round suivant.
- 210 questions, 7 catégories (`questions.js`).

## Tests
```bash
node test/sim.js                 # 157 assertions, vrais clients HTTP+SSE
python3 test/browser_e2e.py      # 4 téléphones + écran laptop (playwright + chrome)
```
