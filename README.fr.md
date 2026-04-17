<div align="center">

# ViLog

### Visionneuse de Logs Professionnelle Haute Performance

**Une visionneuse de logs de bureau construite avec Electron, concue pour la vitesse. Gerez facilement des fichiers de logs de millions de lignes.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-green.svg)]()
[![Electron](https://img.shields.io/badge/Electron-28%2B-blue.svg)](https://www.electronjs.org/)

---

**Language / Langue / 语言 / 언어 / 言語 / Язык / Idioma / Sprache / Língua / لغة**

[![English](https://img.shields.io/badge/English-✓-blue.svg)](README.md)
[![中文](https://img.shields.io/badge/中文-✓-red.svg)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/日本語-✓-white.svg)](README.ja.md)
[![한국어](https://img.shields.io/badge/한국어-✓-blue.svg)](README.ko.md)
[![Русский](https://img.shields.io/badge/Русский-✓-orange.svg)](README.ru.md)
[![Español](https://img.shields.io/badge/Español-✓-yellow.svg)](README.es.md)
[![Français](https://img.shields.io/badge/Français-✓-purple.svg)](README.fr.md)
[![Deutsch](https://img.shields.io/badge/Deutsch-✓-darkgreen.svg)](README.de.md)
[![Português](https://img.shields.io/badge/Português-✓-brightgreen.svg)](README.pt-BR.md)
[![العربية](https://img.shields.io/badge/العربية-✓-teal.svg)](README.ar.md)

</div>

---

## Pourquoi ViLog ?

Si vous avez deja ouvert un fichier de logs de 500 Mo dans un editeur de texte et vu celui-ci se figer, ViLog est fait pour vous. Conc u desde ziro pour l'**analyse de logs a grande echelle**, il combine le rendu Canvas avec acceleration GPU, les Web Workers multi-threads et des optimisations au niveau algorithmique (Aho-Corasick, WASM) pour offrir un filtrage instantane et un defilement fluide sur des fichiers de millions de lignes.

## Fonctionnalites

### Performance Fulgurante

| Fonctionnalite | Detail |
|----------------|--------|
| **Rendu Canvas** | Affichage de logs accelere par GPU au lieu de noeuds DOM — gere des millions de lignes sans difficulte |
| **Defilement virtuel** | Seules les lignes visibles sont rendues. Defilez dans 10M+ lignes sans latence |
| **Filtrage multi-threads** | Les Web Workers paralleles distribuent le filtrage sur les coeurs CPU |
| **Algorithme Aho-Corasick** | Correspondance multi-motifs en temps O(n+z) — filtre 10+ mots-cles simultanement |
| **Recherche WebAssembly** | Performance de correspondance de chaines quasi-native via modules WASM |
| **Filtre hybride intelligent** | Selection automatique entre ripgrep (grands fichiers) et JS Workers (petits fichiers) |
| **Cache de donnees de lignes** | Le filtrage repete du meme fichier ignore le transfert de donnees — seuls les mots-cles sont envoyes aux Workers |

### Filtrage et Recherche Puissants

- **Filtrage multi-mots-cles** — Separez les mots-cles avec `|`, echappez les pipes litteraux avec `\|`
- **Support des expressions regulieres** — Regex JavaScript complet dans le filtre et la recherche
- **Filtrage a deux niveaux** — Filtre primaire + filtre secondaire dans les resultats
- **Historique des filtres** — Historique persistant des mots-cles avec correspondance floue (base IndexedDB)
- **Surlignage des mots-cles** — 10 couleurs predefinies + selecteur de couleur personnalise
- **Exclusion de lignes** — Clic droit pour exclure les lignes correspondantes des resultats
- **Navigation de recherche** — Entree/Shift+Entree pour naviguer entre les correspondances

### Gestion des Fichiers

- **Barre laterale d'arborescence** — Glissez-deposez des fichiers, dossiers ou archives
- **Navigation d'archives** — ZIP, 7z, RAR, tar.gz — parcourez le contenu sans extraire
- **Serveur de fichiers distant** — Connectez-vous a des machines distantes via le serveur HTTP C integre (pool de threads, haute concurrence)
- **Partage local** — Partagez des repertoires locaux avec des collegues via LAN
- **Coller depuis le presse-papiers** — Collez des fichiers directement avec Ctrl+V
- **Vue tabulaire CSV/TSV** — Analysez et affichez des donnees structurees dans des tableaux triables
- **Integration Everything** — Recherche instantanee de fichiers sur Windows via Everything HTTP API
- **Integration Ripgrep** — Recherche de texte dans les grands fichiers 20-100x plus rapide

### Visualisation de Donnees

- **Tracage de graphiques CSV** — Graphiques en ligne interactifs avec zoom, panoramique et selection de colonnes
- **Parseur Vlog** — Parseur specialise pour les logs de diagnostic batterie/appareil (21 champs) avec visualisation
- **Selecteur de colonnes** — Conserver ou supprimer des colonnes specifiques dans la vue tabulaire
- **Exportation** — Copier les resultats filtres ou exporter en HTML

### Espace de Travail et Productivite

- **Multi-fenetres** — Ouvrez plusieurs fichiers de logs dans des fenetres separees, basculez avec Alt+1 a 9
- **Signets** — Marquez les lignes importantes et naviguez entre elles
- **Aller a la ligne** — Sautez instantanement a n'importe quel numero de ligne
- **Liens rapides** — Signets de sites web frequents (panneau web integre)
- **Assistant IA** — Panneau de chat IA integre pour l'assistance a l'analyse de logs
- **Log UART serie** — Fenetre de surveillance des logs de port serie
- **Mise a l'echelle de la police** — Ctrl+Molette pour zoomer, Alt+Molette pour le defilement horizontal
- **Surveillance systeme** — Affichage en temps reel du CPU, de la memoire et de la memoire de l'application
- **Terminal integre** — Ouvrez un terminal directement depuis l'application

### Raccourcis Clavier

| Raccourci | Action |
|-----------|--------|
| `F` | Focus sur la boite de filtre de la barre d'outils |
| `f` | Ouvrir la boite de dialogue de filtre |
| `Ctrl+F` | Focus sur la boite de recherche |
| `Ctrl+H` | Basculer le panneau de resultats de filtre |
| `Ctrl+G` | Basculer l'arborescence flottante |
| `Shift+W` | Basculer la maximisation du panneau de filtre |
| `Alt+X` | Basculer le plein ecran |
| `Alt+1~9` | Passer a la fenetre N |
| `Ctrl+Tab` | Cycle entre les fenetres |
| `Ctrl+Shift+T` | Nouvelle fenetre |
| `Ctrl+Molette` | Zoom de la police |
| `Alt+Molette` | Defilement horizontal |

## Architecture

```
ViLog/
├── jscode/                          # Application Electron
│   ├── main.js                      # Processus principal (gestion des fenetres, E/S fichiers, IPC)
│   ├── preload.js                   # Script de prechargement (pont API securise)
│   ├── index.html                   # UI de la fenetre principale
│   ├── renderer/
│   │   ├── css/style.css            # Styles de l'application
│   │   └── js/
│   │       ├── core/                # Bus d'evenements, gestion d'etat, aides DOM
│   │       ├── features/            # Modules de fonctionnalites (filtre, recherche, signets, etc.)
│   │       ├── workers/             # Workers du renderer (parseur CSV, statistiques, constructeur d'index)
│   │       └── utils/               # Constantes, aides, gestionnaire de workers
│   ├── workers/                     # Workers independants (horodatage WASM, scanneur de repertoires)
│   ├── icons/                       # Icones de l'application
│   └── package.json                 # Manifeste du package Node.js
├── server/
│   └── log_server.c                 # Serveur HTTP C haute performance (pool de threads, epoll)
├── docs/                            # Documentation et ressources
└── LICENSE                          # Licence MIT
```

### Stack Technologique

| Composant | Technologie |
|-----------|------------|
| Framework | Electron 28+ |
| Rendu | Canvas API (acceleration GPU) |
| Multi-threading | Web Workers (filtrage parallele) |
| Recherche native | WebAssembly (compile depuis C) |
| Correspondance multi-motifs | Algorithme Aho-Corasick |
| Recherche externe | ripgrep, Everything SDK |
| Serveur distant | C + pthread (32 threads, 4096 connexions) |
| Analyse de donnees | PapaParse (CSV), parseur Vlog personnalise |
| Visualisation | Chart.js + plugin de zoom |
| Stockage | IndexedDB (historique des filtres, signets) |

## Demarrage Rapide

### Prerequis

- [Node.js](https://nodejs.org/) 18+
- [Electron](https://www.electronjs.org/) 28+
- (Optionnel) [7-Zip](https://www.7-zip.org/) pour la navigation d'archives
- (Optionnel) [ripgrep](https://github.com/BurntSushi/ripgrep) pour la recherche acceleree
- (Optionnel) [Everything](https://www.voidtools.com/) pour la recherche instantanee de fichiers sur Windows

### Installation et Execution

```bash
# Cloner le depot
git clone https://github.com/ranxuefeng2022/ViLog.git
cd ViLog

# Installer les dependances
cd jscode
npm install

# Lancer l'application
npm start
```

### Compiler le Serveur C (Optionnel — pour la navigation de fichiers distants)

```bash
cd server
gcc -o log_server log_server.c -lpthread -O2 -D_GNU_SOURCE

# Executer sur le port 8082
./log_server 8082 /chemin/vers/logs
```

## Benchmarks de Performance

| Scenario | Lignes | Taille du fichier | Temps de filtrage | FPS de defilement |
|----------|--------|-------------------|-------------------|-------------------|
| Fichier unique | 1M | 200 Mo | ~0.3s | 60 |
| Filtrage multi-mots-cles (5 mots) | 1M | 200 Mo | ~0.5s | 60 |
| 10 fichiers fusionnes | 5M | 1 Go | ~1.2s | 60 |
| Mode hybride Ripgrep | 5M | 1 Go | ~0.2s | 60 |

*Environnement de test : Intel i7-12700, 32 Go RAM, NVMe SSD. Les resultats peuvent varier.*

## Cas d'Utilisation

- **Developpement embarque/IoT** — Analyse des logs d'appareils, diagnostic de batterie (format vlog)
- **Administration serveur** — Parcourir les logs distants via le serveur HTTP integre
- **QA/Test** — Comparaison de logs multi-fichiers avec fenetres cote a cote
- **Developpement mobile** — Analyse Android logcat, logs noyau, dmesg
- **Analyse de donnees** — Analyse CSV/TSV avec visualisation interactive de graphiques

## Contribuer

Les contributions sont les bienvenues ! Rapports de bugs, demandes de fonctionnalites ou Pull Requests — chaque contribution compte.

1. Forkez le depot
2. Creez votre branche de fonctionnalite (`git checkout -b feature/amazing-feature`)
3. Commitez vos changements (`git commit -m 'Add amazing feature'`)
4. Poussez vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrez une Pull Request

## Licence

Ce projet est sous licence MIT — voir le fichier [LICENSE](LICENSE) pour plus de details.


## Soutenir le Projet

Si ViLog vous est utile, pensez a soutenir le projet :

<div align="center">

<img src="docs/buy_me_a_coffee.jpg" width="200" alt="Buy Me a Coffee" />

</div>

Si vous trouvez ViLog utile, pensez a lui donner une etoile ⭐ — cela aide d'autres a decouvrir le projet !

---

<div align="center">

**ViLog — Rapide. Puissant. Professionnel.**

</div>

