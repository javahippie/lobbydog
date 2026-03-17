# LobbyDog 🐕

Browser-Erweiterung für Chrome und Firefox, die beim Surfen auf Nachrichtenseiten Namen von registrierten Interessenvertretern aus dem [Lobbyregister des Deutschen Bundestags](https://www.lobbyregister.bundestag.de) erkennt, hervorhebt und beim Hover Kontextinformationen anzeigt.

## Features

- **Automatische Erkennung** von Lobbyisten-Namen auf beliebigen Webseiten
- **Highlighting** des ersten Vorkommens jedes Namens mit dem LobbyDog-Icon
- **Tooltip mit Details**: Rechtsform, Interessenbereiche, Finanzaufwand, Sitz
- **Direktlink** zum vollständigen Eintrag im Lobbyregister
- **Hinweis bei Personennamen**, dass Namensgleichheit möglich ist
- **Navigation** zwischen Treffern über Pfeiltasten im Badge (rechts unten)
- **Performant**: Aho-Corasick-Matching, Viewport-Scanning, requestIdleCallback-Batching
- **Datenschutzfreundlich**: Kein Tracking, keine Nutzerdaten, lokaler Index-Cache

## Architektur

```
extension/              Browser-Erweiterung (Manifest V3)
├── content.js          DOM-Scanning, Highlighting, Tooltip
├── background.js       Index-Download, Detail-Caching
├── popup.html/js       Status-Popup
├── lib/aho-corasick.js Multi-Pattern-Matching (O(n))
├── tooltip.css         Styling inkl. Dark Mode
└── icons/              SVG + PNG Icons

backend/                Index-Generierung (Python)
├── index_builder.py    Crawlt das Lobbyregister, baut den Namensindex
├── serve_index.py      Dev-Server für lokale Entwicklung
└── requirements.txt
```

## Installation

### Chrome
1. `chrome://extensions` öffnen
2. Entwicklermodus aktivieren
3. "Entpackte Erweiterung laden" → `extension/` Ordner auswählen

### Firefox
1. `about:debugging` öffnen
2. "Dieser Firefox" → "Temporäres Add-on laden"
3. `extension/manifest.json` auswählen

## Index bauen

Der Namensindex enthält alle Organisationen, gesetzliche Vertreter und betraute Personen aus dem Lobbyregister (~41.000 Namen).

```bash
pip install requests
python backend/index_builder.py --output lobby-index.json
```

Optionen:
- `--output`, `-o`: Ausgabedatei (Standard: `lobby-index.json`)
- `--delay`, `-d`: Pause zwischen API-Requests in Sekunden (Standard: `0.2`)

Der Index wird als statische JSON-Datei gehostet und von der Erweiterung heruntergeladen. Detail-Informationen werden erst beim Hover direkt von der Lobbyregister-API abgerufen.

## Datenquelle

[Lobbyregister des Deutschen Bundestags](https://www.lobbyregister.bundestag.de) — öffentliche Verwaltungsdaten gemäß § 4 LobbyRG
