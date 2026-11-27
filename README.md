# Cuadro México Major 2026

Página con los cuadros masculino y femenino del Premier Padel México Major (Acapulco, 23–29 nov 2026).

- `index.html` muestra el cuadro y lee `data.json`.
- `scripts/scrape.mjs` lee el cronograma de premierpadel.com con Playwright y actualiza `data.json`.
- `.github/workflows/update.yml` lo corre cada 10 minutos y publica el sitio en GitHub Pages.

Después del torneo puedes desactivar la acción en la pestaña **Actions → Actualizar cuadro → Disable workflow**.
