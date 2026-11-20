// Quality presets. Build-time settings (texture res, crowd/traffic counts) apply on reload; the page reloads when switching.
export const QUALITY = {
  low: { name: 'Low', pixelRatio: 0.85, msaa: 0, fxaa: true, shadowMap: 1024, shadowRadius: 170, shadowSoft: 1, ssao: false, ssr: false, godRays: false, motionBlur: false, bloom: true,
    waterRes: 256, texHi: false, peds: 220, pedShadows: false, traffic: 0.7, treeDensity: 0.6, skyline: 350, pointLights: 2 },
  high: { name: 'High', pixelRatio: 1.0, msaa: 4, fxaa: false, shadowMap: 2048, shadowRadius: 230, shadowSoft: 2.5, ssao: true, ssr: false, godRays: true, motionBlur: true, bloom: true,
    waterRes: 512, texHi: false, peds: 520, pedShadows: true, traffic: 1.0, treeDensity: 1.0, skyline: 750, pointLights: 4 },
  ultra: { name: 'Ultra', pixelRatio: 2.0, msaa: 4, fxaa: false, shadowMap: 4096, shadowRadius: 300, shadowSoft: 3, ssao: true, ssr: true, godRays: true, motionBlur: true, bloom: true,
    waterRes: 1024, texHi: true, peds: 900, pedShadows: true, traffic: 1.25, treeDensity: 1.3, skyline: 1200, pointLights: 6 },
};

export function pickQuality() {
  const u = new URLSearchParams(location.search).get('q');
  let k = u || (() => { try { return localStorage.getItem('cw-quality'); } catch (e) { return null; } })() || 'high';
  if (!QUALITY[k]) k = 'high';
  return { key: k, ...QUALITY[k] };
}
export function saveQuality(k) { try { localStorage.setItem('cw-quality', k); } catch (e) { /* ignore */ } }
