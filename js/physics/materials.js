/*
 * Material presets. Values are starting points only — replace them with your own
 * sample's measured resistivity, TCR / R–T data and absorbance.
 * Sources noted per entry; "guess" means no specific source, edit before use.
 *   [OBT]  Çakıroğlu et al., "Thermal conductivity measurements in nanosheets via
 *          bolometric effect", 2D Materials 7, 035003 (2020), arXiv:2001.00368
 *   [MBT]  Kasırga & Köker, "An extensive thermal conductivity measurement method based
 *          on atomic force microscopy", Int. J. Heat Mass Transfer (2025), arXiv:2501.18384
 */
(function (root) {
  'use strict';
  const materials = {
    '2H-TaS2': {
      kappa: 13.2, rho0_uOhmcm: 400, tcr: 0.0025, absorbance: 0.3, G: 5e7, T0: 295, thickness_nm: 32,
      note: 'κ = 13.2 W/mK, ρ = 0.4 mΩ·cm, α = 0.0025 K⁻¹ [OBT]. Absorbance depends on thickness and λ (measure it); G is a guess.',
    },
    'V2O3 (PM phase)': {
      kappa: 4.5, rho0_uOhmcm: 1000, tcr: 0.001, absorbance: 0.4, G: 5e7, T0: 295, thickness_nm: 130,
      note: 'κ = 4.5 W/mK reference value [OBT]. ρ, α and absorbance are guesses — enter your measured values.',
    },
    'WS2 (few-layer)': {
      kappa: 12, rho0_uOhmcm: 1e6, tcr: -0.01, absorbance: 0.3, G: 2e7, T0: 295, thickness_nm: 12,
      note: 'Literature κ ≈ 12 W/mK as cited in [OBT]. Photoconductive response may add to the bolometric signal in semiconductors.',
    },
    'MoS2 (few-layer)': {
      kappa: 30, rho0_uOhmcm: 1e6, tcr: -0.01, absorbance: 0.3, G: 2e7, T0: 295, thickness_nm: 10,
      note: 'Guess values; semiconductors usually follow the activation model better.',
    },
    'Ce3PtIn11 (3 K)': {
      kappa: 10, rho0_uOhmcm: 10, tcr: 0.05, absorbance: 0.3, G: 1e7, T0: 3, thickness_nm: 30,
      note: 'Heavy-fermion example used in [MBT] (κ = 10 W/mK in the GK study). Supply R–T data for real use.',
    },
    Custom: { note: 'Enter all parameters manually.' },
  };
  root.BS = root.BS || {};
  root.BS.materials = materials;
  if (typeof module !== 'undefined' && module.exports) module.exports = materials;
})(typeof globalThis !== 'undefined' ? globalThis : this);
