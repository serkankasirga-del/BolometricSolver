# Bolometric Thermometry Solver

An analytical solver with a drawing GUI for **bolometric thermal-conductivity measurements** on
suspended thin crystals. Heat can be delivered **optically** (focused laser, OBT) or
**mechanically** (heated AFM tip, MBT). Heat transport can be **Fourier** or **non-Fourier**
(Guyer–Krumhansl hydrodynamic, or ballistic–diffusive suppression).

The models follow:

* O. Çakıroğlu *et al.*, T. S. Kasırga, *Thermal conductivity measurements in nanosheets via bolometric effect*, 2D Materials 7, 035003 (2020), arXiv:2001.00368
* T. S. Kasırga, B. Köker, *An extensive thermal conductivity measurement method based on atomic force microscopy*, Int. J. Heat Mass Transfer (2025), arXiv:2501.18384

## Running

No installation or build step. Open `index.html` in a modern browser (Chrome, Firefox, Edge, Safari).
Everything runs locally in the page. To run the tests (Node ≥ 18):

```
npm test
```

## What you can do

* **Draw the device:** crystal boundary (polygon or rectangle), contact pads (rectangle or
  polygon), the substrate hole (circle), the heat-source position, and an optional line-scan
  path. Shapes can be moved and reshaped; coordinates can also be typed in.
* **Contacts:** give each pad a role (I+, I−, V+, V−, or none) and a contact resistance Rc.
  I+/I− only gives a two-terminal measurement; adding V+/V− gives four-terminal.
* **Material:** presets or custom values for thickness, κ (suspended), κ′ (supported), and the
  crystal–substrate boundary conductance G.
* **ρ(T):** a temperature coefficient of resistance at the measurement temperature T0,
  measured **R–T data** (paste it or load a file; contact resistance can be subtracted), or an
  activation energy. ρ0 comes from a resistivity, a measured sample resistance, or R(T0) from
  the data.
* **Bias:** constant voltage (current read-out; contact resistance reduces the signal) or
  constant current (voltage read-out), with the lock-in bandwidth.
* **Heat delivery:**
  * *Optical:* laser power, absorbance, and spot size (1/e radius, 1/e² radius or FWHM).
  * *Mechanical:* tip thermal radius, plus one of: delivered power, contact temperature rise
    δT*, or tip temperature with tip–sample conductance.
* **Outputs:**
  * the temperature map (or current-density / sensitivity map) drawn on the device
  * peak and mean temperature rise
  * δR and δR/R
  * the bolometric current or voltage
  * Joule power, Johnson + shot noise floor, and SNR
  * warnings, for example when contact resistance dominates or SNR is low
* **Analysis:**
  * fit κ from a measured δR, photocurrent or bolometric voltage, with an uncertainty interval
  * δR vs κ
  * line scan of δR vs source position (like an SPCM line trace)
  * δR vs phonon mean free path
* **Save / load** projects as JSON.

## How it works (short)

* The temperature field is analytical. For a centred source it is the closed-form Bessel /
  exponential-integral solution from the 2D Materials paper. For any other source position it
  is an exact angular-mode generalisation: each mode is matched at the hole edge, and the
  Guyer–Krumhansl term is added where selected.
* The drawn device is solved once for its cold current distribution.
* δR then follows from the first-order reciprocity formula δR = ∫ δρ J·J′ dV / (I I′).

See [`docs/THEORY.md`](docs/THEORY.md) for the equations, assumptions and validation.

## Validation (in `tests/`)

* Closed form vs an independent radial finite-volume solution (< 0.2 % of peak)
* Off-centre analytical field vs a 2D finite-volume solution (< 2 %)
* Energy balance: heat into the substrate equals Q, for centred, off-centre and supported sources
* Guyer–Krumhansl limits (l → 0 gives Fourier; analytic hot-spot amplitude)
* Electrical solver: exact square counts; Σ weights = R for two- and four-terminal layouts
* κ fit round trip, R_c scaling (R_s/R_tot)², photocurrent → δR conversion, MBT power modes

## Project layout

```
index.html              GUI
css/style.css
js/math/special.js      E1, Ein, Bessel J/I/K, log-space K_n tables
js/physics/thermal.js   analytical temperature field (Fourier / GK / ballistic)
js/physics/electrical.js  device current distribution + reciprocity weights
js/physics/resistivity.js ρ(T) models, R–T parsing / interpolation
js/physics/bolometer.js   δR, signals, noise, κ fit, sweeps, line scans
js/physics/materials.js   material presets (starting values)
js/ui/editor.js         canvas geometry editor
js/ui/plot.js           lightweight plotting
js/app.js               application controller
tests/physics.test.js   validation tests (node --test)
```

Material presets are starting points; replace them with your sample's measured values.
