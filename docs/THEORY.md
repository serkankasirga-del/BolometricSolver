# Theory and implementation notes

This document describes the physics implemented in the solver and how each part
maps onto the code. It follows the two bolometric-thermometry papers:

* **[OBT]** O. Çakıroğlu, N. Mehmood, M. M. Çiçek, A. Aikebaier, H. R. Rasouli, E. Durgun,
  T. S. Kasırga, *Thermal conductivity measurements in nanosheets via bolometric effect*,
  2D Materials **7**, 035003 (2020), arXiv:2001.00368 — optical heating.
* **[MBT]** T. S. Kasırga, B. Köker, *An extensive thermal conductivity measurement method
  based on atomic force microscopy*, Int. J. Heat Mass Transfer (2025), arXiv:2501.18384 —
  mechanical (AFM-tip) heating, contact-resistance handling and Guyer–Krumhansl transport.

## 1. Geometry

A flake of thickness `t` lies on a substrate with a circular hole of radius `a`
(centre `(xh, yh)`). Metal contact pads sit underneath the flake. A Gaussian
heat source of 1/e radius `r0` is centred at `(xs, ys)`; it may be anywhere on
the flake, not only at the hole centre.

## 2. Heat transport (`js/physics/thermal.js`)

Steady state, in-plane conduction, thickness-averaged temperature:

```
suspended (r < a):   κ ∇²T + S − l² ∇²S = 0                (l = 0: Fourier, l > 0: Guyer–Krumhansl)
supported (r ≥ a):   κ' ∇²T − (G/t)(T − T0) + S = 0
S(ρ) = S0 exp(−ρ²/r0²),   S0 = Q / (π r0² t),   ρ = |x − xs|
```

`G` is the flake–substrate thermal boundary conductance, `κ'` the conductivity
of the supported part (tied to `κ` by default, as in [OBT]); convection and
radiation to the gas are neglected (see [OBT] and [MBT] SI). Boundary conditions:
`T → T0` as `r → ∞`, `T` finite, and continuity of `T` and of the radial heat flux at `r = a`.

### Centred source — closed form [OBT]

```
T1(r) = c1 + c2 ln r + (S0 r0² / 4κ) Ei(−r²/r0²)
T2(r) = c3 I0(βr) + c4 K0(βr) + T0,      β = √(G / κ' t),  c3 = 0
```

In the code this is written with the entire function `Ein(x) = γ + ln x + E1(x)`,
`P_in(ρ) = −(S0 r0²/4κ) Ein(ρ²/r0²)`, whose derivative
`P_in'(ρ) = −(S0 r0²/2κρ)(1 − e^{−ρ²/r0²})` is exactly the enclosed-power flux.

### Arbitrary source position — exact generalisation

```
T = P_in(ρ)  + Σn  An (r/a)^n          e^{inθ}       r < a
T = P_out(ρ) + Σn  Bn Kn(βr)/Kn(βa)    e^{inθ}       r ≥ a
```

`P_in`, `P_out` are free-space particular solutions centred on the source:

```
P_out(ρ) = (S0 r0²/2κ') ∫0^∞ u J0(uρ/r0) e^{−u²/4} / (u² + β²r0²) du      (Hankel transform)
         = (Q/2πκ't) e^{β²r0²/4} K0(βρ)  + O(e^{−ρ²/r0²})                   (ρ ≫ r0)
```

The near field is tabulated by Simpson quadrature, the far field is the exact
asymptote. The particular solutions are sampled on `r = a`, Fourier-decomposed in θ,
and for each harmonic the 2×2 matching problem (continuity of `T` and of `κ ∂T/∂r`)
gives `An`, `Bn`. For a centred source only `n = 0` survives and the closed form is
recovered. `Kn` ratios are handled in log space (`lnKnTable`) so large `n` and large
`βr` never overflow.

### Non-Fourier transport

**Guyer–Krumhansl** [MBT, Eq. 4 and SI §4]: `q − l²∇²q = −κ∇T`, `∇·q = S`
gives `κ∇²T + S − l²∇²S = 0`. Its particular solution is the Fourier one plus
`(l²/κ) S(ρ)` — a hot spot localised under the heater. Using `∇²q ≈ ∇(∇·q) = ∇S`,
the flux is `q = −κ∇T_F`, so flux matching at the hole edge involves the Fourier part
only. As `l` grows the hot spot dominates — the localisation reported in [MBT] Fig. 5.
GK is meaningful while `l ≲ a`; the GUI warns otherwise.

**Ballistic–diffusive suppression** (optional): `κ_eff = κ/(1 + 4Kn/3)`, `Kn = l/2a`
(EPRT-type boundary scattering); the fit then returns the intrinsic κ.

## 3. Heat delivery (`deliveredPower` in `bolometer.js`)

* **Optical (OBT):** `Q = A·P` (absorbance × incident power). Spot input can be the 1/e
  radius `r0`, the 1/e² radius `w = √2 r0`, or the FWHM `= 2 r0 √ln2`.
* **Mechanical (MBT):** tip thermal radius `r0` (~20 nm) and one of
  * constant power `Q` ([MBT] Fig. 3);
  * fixed contact temperature `δT* = T*_AFM − T_amb` ([MBT] SI §4: `Q` is chosen so the
    peak of the profile equals δT*);
  * tip temperature `T_tip` with tip–sample conductance `G_TS`:
    `Q = G_TS (T_tip − T0) / (1 + G_TS θ)`, `θ` = peak rise per watt of the sample.

## 4. Electrical model (`js/physics/electrical.js`)

The drawn crystal and pads are rasterised (cell size = long side / N). Current pads
(I+, I−) are equipotential Dirichlet regions; all other pads are floating
high-conductivity metal. The Laplace equation for unit sheet conductance is solved
by Jacobi-preconditioned CG.

The bolometric change follows from the exact first-order reciprocity / Joule-power
theorem:

```
δR = (1 / I I') ∫ δρ(x,y) J · J' dV
```

with `J'` the current distribution when current is injected through V+/V−
(`J' = J` for two terminals). It is evaluated in its discrete form face by face,
which guarantees `Σ w = R` (checked in the tests). `δρ/ρ0` is integrated per cell
with adaptive sub-sampling near the heater (sub-cell resolution of a 20 nm tip) and
along the hole edge.

## 5. ρ(T) models (`js/physics/resistivity.js`)

* TCR: `ρ = ρ0 [1 + α (T − T0)]` (α defined at the measurement temperature T0).
* Activated: `ρ = ρ0 exp[(E_A/k_B)(1/T − 1/T0)]`.
* Measured R–T data: `ρ(T)/ρ(T0) = R(T)/R(T0)` (monotone PCHIP interpolation, fully
  nonlinear — handles plateaus and inflection points, cf. [MBT] SI §5). Two-terminal
  data can have the contact resistances subtracted.

`ρ0` comes from a resistivity value, from the measured sample resistance (divided by
the geometric factor of the drawn device), or from `R(T0)` of the R–T data.

## 6. Bias, contact resistance and noise

* Two-terminal, constant voltage: `I0 = V_B/R_tot`, `R_tot = R_s + Rc(I+) + Rc(I−)`,
  `I_bolo = V_B/(R_tot + δR) − I0` (so `δR_M ≈ −R_tot² I_PC / V_B`, [OBT]). The effective
  bias on the sample is `V_B R_s/R_tot` and the signal is reduced by `(R_s/R_tot)²` ([MBT] SI §1).
* Constant current (two- or four-terminal): `V_bolo = I δR`; contact resistance drops out.
* Intrinsic noise: Johnson `√(4 k_B T R Δf)` and shot `√(2 q I Δf)` ([MBT]);
  the GUI reports the resulting δR noise floor and SNR.

## 7. Fitting κ

`δR(κ)` is sampled on a log grid (0.01–10⁴ W/m·K), every sign change of
`δR(κ) − δR_M` is refined by bisection in log κ, and ±σ on the measurement gives a κ
interval. Multiple roots (possible near resistivity inflection points or with
δT*-pinned tip heating) are all reported.

## 8. Assumptions and limits

* Steady state (lock-in frequency well below the inverse thermal time of the suspended region).
* κ, κ', G, α of the thermal problem are temperature independent (valid for small ΔT, the
  regime the method is designed for); ρ(T) itself may be nonlinear.
* The thermal solution treats the supported flake as laterally infinite; finite flake
  edges and contacts are not separate heat sinks (accurate when the healing length
  `√(κ't/G)` is short compared with the distance from the hole to the flake edge — see [OBT]).
* Light reflected from the hole bottom, photoconductive/thermoelectric currents and DC Joule
  heating are not part of the bolometric signal model (the GUI flags when they may matter).
