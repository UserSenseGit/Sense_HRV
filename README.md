# Sense HRV

HRV-meting met een Bluetooth-hartslagsensor (Web Bluetooth, Chrome op Android), met handmatig filteren van extrasystolen, en een geschiedenis met tags.

## Structuur

Statische webapp zonder build-stap (gehost op Vercel).

- `index.html` – schermen en tabbalk (Vandaag, Meten, Historiek, Trends, Meer)
- `css/app.css` – stijl B3 (donker)
- `js/app.js` – opstart en navigatie
- `js/measure.js` – sensor, opname, tachogram, segmenten (oorspronkelijke meetlogica)
- `js/stats.js` – HR, gepoolde rMSSD, AVNN, SDNN, pNN50, extrasystolen
- `js/tags.js` – tags-formulier
- `js/views.js` – Vandaag, Historiek, Meer
- `js/importexport.js` – import HRV4Training-CSV, back-up (JSON), export (CSV)
- `js/db.js` – opslag in de browser (IndexedDB)

## Data

Alles staat lokaal in de browser van het toestel. Maak regelmatig een back-up via **Meer → Back-up downloaden**.

Extrasystolen worden automatisch geteld als het aantal onderbrekingen tussen opeenvolgende actieve segmenten; de waarde is aanpasbaar voor het opslaan.
