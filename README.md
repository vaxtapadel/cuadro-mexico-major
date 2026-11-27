# Cuadro México Major 2026

Página con los cuadros masculino y femenino del Premier Padel México Major (Acapulco, 23–29 nov 2026).

- `index.html` muestra el cuadro y lee `data.json`.
- `scripts/scrape.mjs` lee el cronograma de premierpadel.com con Playwright y actualiza `data.json`.
- `.github/workflows/update.yml` lee la página cada 5 minutos y se relanza sola; la página lee `data.json` directo del repositorio.
- `.github/workflows/publish.yml` publica el sitio en GitHub Pages cuando cambia el diseño.

Después del torneo puedes desactivar la acción en la pestaña **Actions → Actualizar resultados → Disable workflow**.
