# Third-party data notices

The generated challenge bank in `assets/desafios-es.js` combines and transforms
the following public linguistic datasets. The 201 original hand-written entries
in `index.html` are not derived from these datasets.

## Spanish frequency data

- Project: `doozan/spanish_data`
- Source: https://github.com/doozan/spanish_data
- File: `frequency.csv`
- License noted by the project: CC BY-SA 3.0, derived from FrequencyWords

The frequency list is used to rank words and reject unusual entries. The source
definitions are not copied from this file.

## Spanish (Argentina) spelling dictionary

- Project: `wooorm/dictionaries`
- Source: https://github.com/wooorm/dictionaries/tree/main/dictionaries/es-AR
- File: `dictionaries/es-AR/index.dic`
- License options published by the project: GPL-3.0, LGPL-3.0, or MPL-1.1

The dictionary is used only as a spelling-validation signal.

## Spanish Wiktionary definitions

- Project: Wiktionary data extracted by Wiktextract / kaikki.org
- Source: https://kaikki.org/eswiktionary/rawdata.html
- Upstream: https://es.wiktionary.org/
- License: CC BY-SA and GFDL, as documented by Wiktionary and kaikki.org

Definitions are shortened and transformed into game clues by
`scripts/build-word-bank.mjs`. The generated bank retains the applicable
attribution and share-alike requirements of its source data.

## Diccionario de intentos válidos (assets/palabras-validas.js)

- Project: an-array-of-spanish-words
- Source: https://github.com/words/an-array-of-spanish-words
- License: MIT

Se usa solo para validar que cada intento del Desafío del día sea una
palabra española real (5 a 8 letras). La lista se normaliza a mayúsculas
con Ñ y se filtra por longitud; no se muestra al usuario.
