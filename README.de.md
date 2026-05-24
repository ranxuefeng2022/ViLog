<div align="center">

# ViLog

### Professioneller Hochleistungs-Log-Viewer

**Ein Desktop-Log-Viewer, gebaut mit Electron, konstruiert fur Geschwindigkeit. Verarbeiten Sie Log-Dateien mit Millionen von Zeilen mühelos.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-green.svg)]()
[![Electron](https://img.shields.io/badge/Electron-28%2B-blue.svg)](https://www.electronjs.org/)

---

**Language / Sprache / 语言 / 언어 / 言語 / Язык / Idioma / Langue / Língua / لغة**

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

## Warum ViLog?

Wenn Sie jemals eine 500 MB große Log-Datei in einem Texteditor geöffnet und gesehen haben, wie er einfriert, dann ist ViLog für Sie. Von Grund auf für die **Log-Analyse im großen Maßstab** entwickelt, kombiniert es GPU-beschleunigtes Canvas-Rendering, Multi-Thread-Web-Worker und Algorithmus-Ebene-Optimierungen (Aho-Corasick, WASM), um sofortige Filterung und flüssiges Scrollen bei Dateien mit Millionen von Zeilen zu liefern.

## Funktionen

### Blazing Schnelle Leistung

| Funktion | Detail |
|----------|--------|
| **Canvas-Rendering** | GPU-beschleunigte Log-Anzeige statt DOM-Knoten — verarbeitet Millionen von Zeilen mühelos |
| **Virtuelles Scrollen** | Nur sichtbare Zeilen werden gerendert. Scrollen Sie durch 10M+ Zeilen ohne Verzögerung |
| **Multi-Thread-Filterung** | Parallele Web-Worker verteilen die Filterung auf CPU-Kerne |
| **Aho-Corasick-Algorithmus** | Multi-Pattern-Matching in O(n+z) Zeit — filtert 10+ Schlüsselwörter gleichzeitig |
| **WebAssembly-Suche** | Nahezu native String-Matching-Leistung durch WASM-Module |
| **Hybrider Smart-Filter** | Automatische Auswahl zwischen ripgrep (große Dateien) und JS-Workern (kleine Dateien) |
| **Zeilendaten-Caching** | Wiederholte Filterung derselben Datei überspringt Datenübertragung — nur Schlüsselwörter werden an Worker gesendet |

### Leistungsfähige Filterung und Suche

- **Multi-Schlüsselwort-Filterung** — Schlüsselwörter mit `|` trennen, literale Pipes mit `\|` escapen
- **Regex-Unterstützung** — Vollständige JavaScript-Regex in Filter und Suche
- **Zwei-Ebenen-Filterung** — Primärfilter + Sekundärfilter in Ergebnissen
- **Filterverlauf** — Persistenter Schlüsselwort-Verlauf mit Fuzzy-Matching (IndexedDB-basiert)
- **Schlüsselwort-Hervorhebung** — 10 vordefinierte Farben + benutzerdefinierter Farbwähler
- **Zeilen ausschließen** — Rechtsklick zum Ausschließen übereinstimmender Zeilen aus Ergebnissen
- **Suchnavigation** — Enter/Shift+Enter zum Springen zwischen Treffern

### Dateiverwaltung

- **Dateibaum-Seitenleiste** — Drag & Drop von Dateien, Ordnern oder Archiven
- **Archiv-Browsing** — ZIP, 7z, RAR, tar.gz — Inhalte ohne Entpacken durchsuchen
- **Remote-Dateiserver** — Verbindung zu Remote-Maschinen über integrierten C HTTP-Server (Thread-Pool, hohe Parallelität)
- **Lokales Teilen** — Lokale Verzeichnisse über LAN mit Teamkollegen teilen
- **Zwischenablage einfügen** — Dateien direkt mit Ctrl+V einfügen
- **CSV/TSV-Tabellenansicht** — Strukturierte Daten in sortierbaren Tabellen parsen und anzeigen
- **Everything-Integration** — Sofortige Dateisuche unter Windows über Everything HTTP API
- **Ripgrep-Integration** — 20-100x schnellere Textsuche in großen Dateien

### Datenvisualisierung

- **CSV-Diagramm-Plotting** — Interaktive Liniendiagramme mit Zoom, Schwenken und Spaltenauswahl
- **Vlog-Parser** — Spezialisiertes Parser für Batterie-/Gerätediagnose-Logs (21 Felder) mit Visualisierung
- **Spaltenauswahl** — Bestimmte Spalten in der Tabellenansicht beibehalten oder entfernen
- **Export** — Gefilterte Ergebnisse kopieren oder als HTML exportieren

### Arbeitsbereich und Produktivität

- **Multi-Fenster** — Mehrere Log-Dateien in separaten Fenstern öffnen, mit Alt+1~9 wechseln
- **Lesezeichen** — Wichtige Zeilen markieren und dazwischen navigieren
- **Gehe zu Zeile** — Sofort zu einer beliebigen Zeilennummer springen
- **Schnelllinks** — Lesezeichen häufig verwendeter Websites (integriertes Web-Panel)
- **KI-Assistent** — Eingebettetes KI-Chat-Panel zur Unterstützung bei der Log-Analyse
- **UART-Seriell-Log** — Seriell-Port-Log-Überwachungsfenster
- **Schriftskalierung** — Ctrl+Scroll zum Zoomen, Alt+Scroll für horizontales Verschieben
- **Systemüberwachung** — Echtzeit CPU-, Speicher- und App-Speicher-Anzeige
- **Integriertes Terminal** — Terminal direkt aus der App öffnen

### Tastaturkurzbefehle

| Kurzbefehl | Aktion |
|------------|--------|
| `F` | Filterbox der Symbolleiste fokussieren |
| `f` | Filterdialog öffnen |
| `Ctrl+F` | Suchbox fokussieren |
| `Ctrl+H` | Filterergebnis-Panel umschalten |
| `Ctrl+G` | Schwebenden Dateibaum umschalten |
| `Shift+W` | Filter-Panel-Maximierung umschalten |
| `Alt+X` | Vollbild umschalten |
| `Alt+1~9` | Zu Fenster N wechseln |
| `Ctrl+Tab` | Zwischen Fenstern wechseln |
| `Ctrl+Shift+T` | Neues Fenster |
| `Ctrl+Scroll` | Schrift zoom |
| `Alt+Scroll` | Horizontales Scrollen |

## Architektur

```
ViLog/
├── jscode/                          # Electron-Anwendung
│   ├── main.js                      # Hauptprozess (Fensterverwaltung, Datei-I/O, IPC)
│   ├── preload.js                   # Preload-Skript (sichere API-Brucke)
│   ├── index.html                   # Hauptfenster-UI
│   ├── renderer/
│   │   ├── css/style.css            # Anwendungsstile
│   │   └── js/
│   │       ├── core/                # Event-Bus, Zustandsverwaltung, DOM-Helfer
│   │       ├── features/            # Funktionsmodule (Filter, Suche, Lesezeichen usw.)
│   │       ├── workers/             # Renderer-Worker (CSV-Parser, Statistiken, Index-Builder)
│   │       └── utils/               # Konstanten, Helfer, Worker-Manager
│   ├── workers/                     # Eigenstandige Worker (WASM-Zeitstempel, Verzeichnis-Scanner)
│   ├── icons/                       # Anwendungssymbole
│   └── package.json                 # Node.js-Paketmanifest
├── server/
│   └── log_server.c                 # Hochleistungs-C-HTTP-Server (Thread-Pool, epoll)
├── docs/                            # Dokumentation und Assets
└── LICENSE                          # MIT-Lizenz
```

### Technologie-Stack

| Komponente | Technologie |
|-----------|------------|
| Framework | Electron 28+ |
| Rendering | Canvas API (GPU-beschleunigt) |
| Multi-Threading | Web Workers (parallele Filterung) |
| Native Suche | WebAssembly (aus C kompiliert) |
| Multi-Pattern-Matching | Aho-Corasick-Algorithmus |
| Externe Suche | ripgrep, Everything SDK |
| Remote-Server | C + pthread (32 Threads, 4096 Verbindungen) |
| Daten-Parsing | PapaParse (CSV), benutzerdefinierter Vlog-Parser |
| Visualisierung | Chart.js + Zoom-Plugin |
| Speicher | IndexedDB (Filterverlauf, Lesezeichen) |

## Schnellstart

### Voraussetzungen

- [Node.js](https://nodejs.org/) 18+
- [Electron](https://www.electronjs.org/) 28+
- (Optional) [7-Zip](https://www.7-zip.org/) für Archiv-Browsing
- (Optional) [ripgrep](https://github.com/BurntSushi/ripgrep) für beschleunigte Suche
- (Optional) [Everything](https://www.voidtools.com/) für sofortige Dateisuche unter Windows

### Installation und Ausführung

```bash
# Repository klonen
git clone https://github.com/ranxuefeng2022/ViLog.git
cd ViLog

# Abhängigkeiten installieren
cd jscode
npm install

# Anwendung starten
npm start
```

### C-Server kompilieren (Optional — für Remote-Datei-Browsing)

```bash
cd server
gcc -o log_server log_server.c -lpthread -O2 -D_GNU_SOURCE

# Auf Port 8082 ausführen
./log_server 8082 /pfad/zu/logs
```

## Leistungs-Benchmarks

| Szenario | Zeilen | Dateigröße | Filterzeit | Scroll-FPS |
|----------|--------|-----------|------------|------------|
| Einzeldatei | 1M | 200 MB | ~0.3s | 60 |
| Multi-Schlüsselwort-Filter (5 Schlüsselwörter) | 1M | 200 MB | ~0.5s | 60 |
| 10 Dateien zusammengefasst | 5M | 1 GB | ~1.2s | 60 |
| Ripgrep-Hybridmodus | 5M | 1 GB | ~0.2s | 60 |

*Testumgebung: Intel i7-12700, 32 GB RAM, NVMe SSD. Ergebnisse können variieren.*

## Anwendungsfälle

- **Embedded/IoT-Entwicklung** — Analyse von Gerätelogs, Batteriediagnose (vlog-Format)
- **Serveradministration** — Remote-Logs über den integrierten HTTP-Server durchsuchen
- **QA/Testing** — Multi-Datei-Log-Vergleich mit Seite-an-Seite-Fenstern
- **Mobile Entwicklung** — Android logcat, Kernel-Logs, dmesg-Analyse
- **Datenanalyse** — CSV/TSV-Parsing mit interaktiver Diagrammvisualisierung

## Beitragen

Beiträge sind willkommen! Ob Bug-Reports, Feature-Anfragen oder Pull Requests — jeder Beitrag zählt.

1. Forken Sie das Repository
2. Erstellen Sie Ihren Feature-Branch (`git checkout -b feature/amazing-feature`)
3. Committen Sie Ihre Änderungen (`git commit -m 'Add amazing feature'`)
4. Pushen Sie zum Branch (`git push origin feature/amazing-feature`)
5. Öffnen Sie einen Pull Request

## Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert — siehe [LICENSE](LICENSE)-Datei für Details.


## Projekt unterstutzen

Wenn ViLog Ihre Arbeit erleichtert, denken Sie an eine Unterstutzung:

<div align="center">

<img src="docs/buy_me_a_coffee.jpg" width="200" alt="Buy Me a Coffee" />

</div>

Wenn Sie ViLog nutzlich finden, geben Sie ihm bitte einen Stern ⭐ — es hilft anderen, das Projekt zu entdecken!

---

<div align="center">

**ViLog — Schnell. Leistungsstark. Professionell.**

</div>

