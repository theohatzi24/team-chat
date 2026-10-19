# Team Chat: interne Mitarbeiter App (Prototyp)

Web App (PWA) für den Obst und Gemüse Großhandel. Läuft im Browser und lässt sich aufs Handy installieren wie eine normale App.

## Was drin ist
- **💬 Team Chat:** alle Mitarbeiter schreiben in einen gemeinsamen Gruppenchat, Nachrichten kommen live an.
- **📢 Ankündigungen:** nur der Chef (Admin) postet, alle lesen. Neue Ankündigungen zeigen ein gelbes Zähler Badge.
- **👥 Mitarbeiter verwalten (nur Chef):** Mitarbeiter mit Name und PIN anlegen, PIN zurücksetzen, entfernen.
- **Login per Name und PIN** (4 bis 8 Ziffern). PINs werden gehasht gespeichert (scrypt). Nach 5 falschen Versuchen ist der Name 10 Minuten gesperrt.
- Eigene Nachrichten löschen, der Chef kann alle löschen.
- Benachrichtigung auf dem Handy, solange die App im Hintergrund offen ist.
- Dunkelmodus folgt automatisch der Handy Einstellung.

## Starten
Voraussetzung: Node.js ab Version 18. Keine weiteren Pakete nötig.

```bash
node server.js
```

Dann im Browser `http://localhost:3000` öffnen. Beim ersten Start legst du dein Chef Konto an, danach unter 👥 die Mitarbeiter.

Optionen: `PORT=8080 node server.js`, Speicherort der Daten mit `DATA_FILE=/pfad/db.json`.

## Hosting auf Render
`render.yaml` ist auf den **Free Plan** eingestellt (Entscheidung Theo, 19.10.2026).

⚠️ Beim Free Plan löscht Render alle Dateiänderungen bei Neustart, Deploy und nach 15 Minuten ohne Zugriffe (Quelle: render.com/docs/free). Konten und Nachrichten sind dann weg, du musst das Chef Konto neu anlegen. Der erste Aufruf nach einer Pause dauert laut Render etwa eine Minute.

Für den Dauerbetrieb: in `render.yaml` `plan: 0.5c-512mb` setzen und den `disk` Block einkommentieren. Kosten: 7 $ + 1 GB × 0,25 $ = 7,25 $/Monat (render.com/pricing, 19.10.2026).

Schritte:
1. Code in ein GitHub Repository legen.
2. Auf render.com: New > Blueprint > Repository wählen. Render liest `render.yaml` und legt Server und Festplatte an.
3. Nach dem Deploy die `https://team-chat-xxxx.onrender.com` Adresse öffnen und das Chef Konto anlegen. **Gleich nach dem Deploy machen**, denn wer zuerst die Einrichtung aufruft, wird Chef.

## Aufs Handy installieren
Die App muss dafür über **HTTPS** erreichbar sein (Browser Vorgabe für PWAs, Ausnahme nur localhost).
- **Android (Chrome):** Menü ⋮ > "App installieren" bzw. "Zum Startbildschirm hinzufügen".
- **iPhone (Safari):** Teilen Symbol > "Zum Home Bildschirm".

## Dateien
| Datei | Zweck |
|---|---|
| `server.js` | Server: Login, Nachrichten, Live Updates (Server Sent Events), Mitarbeiterverwaltung |
| `public/` | App Oberfläche: `index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `sw.js`, Icons |
| `data/db.json` | entsteht beim ersten Start, enthält Mitarbeiter und Nachrichten |

## Grenzen des Prototyps
- **Push wenn die App komplett geschlossen ist** fehlt noch (braucht Web Push mit VAPID Schlüsseln).
- Keine Bilder oder Dateien im Chat, nur Text.
- Daten liegen in einer JSON Datei. Für eine Handvoll bis einige Dutzend Mitarbeiter reicht das, für mehr wäre eine Datenbank (z. B. SQLite) sinnvoll.
- Es werden die letzten 200 Nachrichten pro Kanal angezeigt.
- Kein Backup eingebaut: `data/db.json` regelmäßig sichern.
