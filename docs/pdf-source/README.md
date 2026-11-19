# Rebuilding `docs/Bolometric_Solver_Theory.pdf`

Requires Node.js, `katex@0.16.11` and Playwright with Chromium.

```
cd docs/pdf-source
npm install katex@0.16.11 playwright
node gen.js        # runs the solver, writes data.json (figure data, validation numbers)
node shot.js       # GUI screenshot -> gui.png
node build.js      # renders content.html + KaTeX + SVG figures -> doc.html
node print.js ../Bolometric_Solver_Theory.pdf
```

Edit the text in `content.html` (`$...$` / `$$...$$` are LaTeX math; `{{FIG:..}}` and `{{TABLE:..}}` are filled by `build.js`).
