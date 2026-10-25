import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(__dirname, '../..');
const BRAND_DIR = path.join(ROOT_DIR, 'brand');
const WEB_PUBLIC_DIR = path.join(ROOT_DIR, 'web/public');

for (const dir of [BRAND_DIR, WEB_PUBLIC_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// -------------------------------------------------------------
// Core Clean Ship Graphic (ViewBox 0 0 256 256)
// -------------------------------------------------------------
// Clean, modern, iconic nef sailing ship:
// - Sharp billowing sails
// - Sweeping curved hull
// - Windblown pennants
// - High contrast #FFE100, Black, and White
// -------------------------------------------------------------
function getShipPaths({ fillYellow = '#FFE100', fillWhite = '#FFFFFF', fillDark = '#111111' } = {}) {
  return `
    <!-- Hull: Elegant curved nef hull -->
    <path d="M 38 168 C 45 204, 82 222, 134 222 C 186 222, 222 202, 228 168 C 190 178, 76 178, 38 168 Z" fill="${fillYellow}" />
    <!-- Hull Upper Deck Trim -->
    <path d="M 34 164 L 232 164 L 226 172 L 40 172 Z" fill="${fillDark}" />
    <!-- Hull Keel accent / Siren curve -->
    <path d="M 30 160 C 26 182, 38 206, 68 220 C 50 210, 42 190, 44 170 Z" fill="${fillWhite}" />
    <!-- Pedestal stand / base waves -->
    <path d="M 96 226 L 172 226 L 180 236 L 88 236 Z" fill="${fillDark}" />
    <circle cx="94" cy="242" r="5" fill="${fillYellow}" />
    <circle cx="134" cy="242" r="5" fill="${fillYellow}" />
    <circle cx="174" cy="242" r="5" fill="${fillYellow}" />

    <!-- Masts -->
    <line x1="88" y1="80" x2="88" y2="164" stroke="${fillDark}" stroke-width="3.5" stroke-linecap="round" />
    <line x1="138" y1="36" x2="138" y2="164" stroke="${fillDark}" stroke-width="4" stroke-linecap="round" />
    <line x1="186" y1="92" x2="186" y2="164" stroke="${fillDark}" stroke-width="3" stroke-linecap="round" />
    <line x1="88" y1="160" x2="32" y2="130" stroke="${fillDark}" stroke-width="2.5" stroke-linecap="round" />

    <!-- Sails (Clean Billowing Geometric Curves) -->
    <!-- Bowsprit Jib Sail -->
    <path d="M 36 132 C 60 142, 76 154, 84 158 C 72 144, 58 135, 36 132 Z" fill="${fillWhite}" stroke="${fillDark}" stroke-width="2" stroke-linejoin="round" />

    <!-- Foremast Top Sail -->
    <path d="M 68 88 C 66 102, 68 114, 88 114 C 108 114, 110 102, 108 88 C 96 92, 80 92, 68 88 Z" fill="${fillWhite}" stroke="${fillDark}" stroke-width="2.2" stroke-linejoin="round" />
    <!-- Foremast Course Sail -->
    <path d="M 62 120 C 60 142, 64 154, 88 154 C 112 154, 116 142, 114 120 C 100 126, 76 126, 62 120 Z" fill="${fillWhite}" stroke="${fillDark}" stroke-width="2.5" stroke-linejoin="round" />

    <!-- Mainmast Topgallant Sail -->
    <path d="M 120 44 C 118 56, 122 64, 138 64 C 154 64, 158 56, 156 44 C 146 47, 130 47, 120 44 Z" fill="${fillYellow}" stroke="${fillDark}" stroke-width="2" stroke-linejoin="round" />
    <!-- Mainmast Topsail -->
    <path d="M 114 72 C 110 92, 114 104, 138 104 C 162 104, 166 92, 162 72 C 150 78, 126 78, 114 72 Z" fill="${fillWhite}" stroke="${fillDark}" stroke-width="2.5" stroke-linejoin="round" />
    <!-- Mainmast Mainsail (Hero sail) -->
    <path d="M 106 112 C 100 140, 106 156, 138 156 C 170 156, 176 140, 170 112 C 152 120, 124 120, 106 112 Z" fill="${fillWhite}" stroke="${fillDark}" stroke-width="2.8" stroke-linejoin="round" />

    <!-- Mizzenmast Sail -->
    <path d="M 170 100 C 168 118, 172 130, 186 130 C 200 130, 204 118, 202 100 C 194 104, 178 104, 170 100 Z" fill="${fillWhite}" stroke="${fillDark}" stroke-width="2.2" stroke-linejoin="round" />
    <path d="M 166 134 C 164 150, 168 158, 186 158 C 204 158, 208 150, 206 134 C 196 138, 176 138, 166 134 Z" fill="${fillWhite}" stroke="${fillDark}" stroke-width="2.2" stroke-linejoin="round" />

    <!-- Windblown Pennants / Flags (Yellow #FFE100) -->
    <!-- Main Pennant -->
    <path d="M 138 34 L 102 38 L 114 44 L 102 50 L 138 46 Z" fill="${fillYellow}" stroke="${fillDark}" stroke-width="1.5" />
    <!-- Fore Pennant -->
    <path d="M 88 78 L 60 82 L 68 86 L 60 90 L 88 87 Z" fill="${fillYellow}" stroke="${fillDark}" stroke-width="1.5" />
    <!-- Mizzen Pennant -->
    <path d="M 186 90 L 164 93 L 170 96 L 164 99 L 186 97 Z" fill="${fillYellow}" stroke="${fillDark}" stroke-width="1.5" />
  `;
}

// -------------------------------------------------------------
// 1. Standalone Icon (Square, clean transparent or dark)
// -------------------------------------------------------------
function createNefIconSvg({ isDark = true } = {}) {
  const bg = isDark ? '#0A0A0A' : '#FFFFFF';
  const stroke = isDark ? '#262626' : '#E5E5E5';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" rx="56" fill="${bg}" stroke="${stroke}" stroke-width="2"/>
  <g transform="translate(0, 0)">
    ${getShipPaths({ fillYellow: '#FFE100', fillWhite: '#FFFFFF', fillDark: isDark ? '#0A0A0A' : '#111111' })}
  </g>
</svg>`;
}

// -------------------------------------------------------------
// 2. Favicon SVG (High contrast, optimized for tabs & dark/light)
// -------------------------------------------------------------
function createFaviconSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <style>
      .bg { fill: #000000; }
      @media (prefers-color-scheme: light) {
        .bg { fill: #111111; }
      }
    </style>
  </defs>
  <!-- Rounded tab tile -->
  <rect width="64" height="64" rx="14" class="bg"/>
  <circle cx="32" cy="32" r="30" stroke="#FFE100" stroke-width="2" fill="none" opacity="0.3"/>
  <g transform="translate(1, -2) scale(0.24)">
    ${getShipPaths({ fillYellow: '#FFE100', fillWhite: '#FFFFFF', fillDark: '#000000' })}
  </g>
</svg>`;
}

// -------------------------------------------------------------
// 3. Horizontal Full Logo (Mark + 'nef' wordmark)
// -------------------------------------------------------------
function createHorizontalLogoSvg({ isDark = true } = {}) {
  const textColor = isDark ? '#FFFFFF' : '#0A0A0A';
  const subColor = isDark ? '#A1A1AA' : '#71717A';
  const bg = isDark ? '#0A0A0A' : '#FFFFFF';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 160" width="600" height="160">
  <rect width="600" height="160" fill="${bg}" rx="16"/>

  <!-- Ship Emblem on left -->
  <g transform="translate(12, -48) scale(0.95)">
    ${getShipPaths({ fillYellow: '#FFE100', fillWhite: '#FFFFFF', fillDark: isDark ? '#0A0A0A' : '#111111' })}
  </g>

  <!-- Divider -->
  <line x1="265" y1="36" x2="265" y2="124" stroke="${isDark ? '#27272A' : '#E4E4E7'}" stroke-width="2"/>

  <!-- Wordmark 'nef' & Subtitle -->
  <g transform="translate(295, 30)">
    <!-- 'nef' with Nikon yellow accent dot/bar -->
    <text x="0" y="62" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="64" letter-spacing="-2" fill="${textColor}">
      nef<tspan fill="#FFE100">.</tspan>
    </text>

    <!-- Subtitle / Tagline -->
    <text x="2" y="90" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="600" font-size="13" letter-spacing="2.5" fill="#FFE100">
      NIKON PICTURE CONTROLS
    </text>
  </g>
</svg>`;
}

// -------------------------------------------------------------
// 4. GitHub README Banner (1280x360)
// -------------------------------------------------------------
function createReadmeBannerSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 360" width="1280" height="360">
  <defs>
    <radialGradient id="bannerGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFE100" stop-opacity="0.16"/>
      <stop offset="60%" stop-color="#FFE100" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#121214"/>
      <stop offset="100%" stop-color="#080809"/>
    </linearGradient>
  </defs>

  <!-- Deep Obsidian Background -->
  <rect width="1280" height="360" fill="url(#bgGrad)" rx="20"/>
  <rect width="1280" height="360" fill="url(#bannerGlow)"/>

  <!-- Border Frame -->
  <rect x="1" y="1" width="1278" height="358" rx="19" fill="none" stroke="#27272A" stroke-width="1.5"/>

  <!-- Top Yellow Accent Line -->
  <path d="M 40 1 L 240 1" stroke="#FFE100" stroke-width="3" stroke-linecap="round"/>

  <!-- Grid / Viewfinder Marks (Photography touch) -->
  <g stroke="#3F3F46" stroke-width="1.5" opacity="0.4">
    <!-- Top-left crosshair -->
    <path d="M 40 40 L 56 40 M 40 40 L 40 56"/>
    <!-- Top-right crosshair -->
    <path d="M 1240 40 L 1224 40 M 1240 40 L 1240 56"/>
    <!-- Bottom-left crosshair -->
    <path d="M 40 320 L 56 320 M 40 320 L 40 304"/>
    <!-- Bottom-right crosshair -->
    <path d="M 1240 320 L 1224 320 M 1240 320 L 1240 304"/>
  </g>

  <!-- Center-left: Iconic Nef Ship -->
  <g transform="translate(110, 40) scale(1.1)">
    ${getShipPaths({ fillYellow: '#FFE100', fillWhite: '#FFFFFF', fillDark: '#0F0F10' })}
  </g>

  <!-- Center-right: Brand Text & Badges -->
  <g transform="translate(460, 95)">
    <!-- Wordmark -->
    <text x="0" y="70" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="84" letter-spacing="-3" fill="#FFFFFF">
      nef<tspan fill="#FFE100">.</tspan>
    </text>

    <!-- Nikon Yellow Category Pill -->
    <g transform="translate(195, 12)">
      <rect width="168" height="26" rx="6" fill="#FFE100"/>
      <text x="84" y="17" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="800" letter-spacing="1.2" fill="#000000">
        RAW &amp; RECIPES
      </text>
    </g>

    <!-- Tagline -->
    <text x="4" y="115" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="500" font-size="20" fill="#E4E4E7">
      The Creative Picture Control Studio for Nikon Cameras
    </text>

    <!-- Subtitle / Stats -->
    <text x="4" y="148" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="400" font-size="14" fill="#A1A1AA">
      142+ Curated Film Simulations &amp; Color Grades  •  NP3 Live Viewer  •  Instant Camera Load
    </text>

    <!-- Chips / Feature Tags -->
    <g transform="translate(4, 175)">
      <!-- Chip 1 -->
      <g>
        <rect width="94" height="26" rx="13" fill="#18181B" stroke="#27272A" stroke-width="1"/>
        <text x="47" y="17" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="11" font-weight="600" fill="#FFE100">
          .NEF / .NP3
        </text>
      </g>
      <!-- Chip 2 -->
      <g transform="translate(104, 0)">
        <rect width="112" height="26" rx="13" fill="#18181B" stroke="#27272A" stroke-width="1"/>
        <text x="56" y="17" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="11" font-weight="600" fill="#FFFFFF">
          Nikon Z Series
        </text>
      </g>
      <!-- Chip 3 -->
      <g transform="translate(226, 0)">
        <rect width="128" height="26" rx="13" fill="#18181B" stroke="#27272A" stroke-width="1"/>
        <text x="64" y="17" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="11" font-weight="600" fill="#FFFFFF">
          In-Camera Ready
        </text>
      </g>
    </g>
  </g>
</svg>`;
}

// -------------------------------------------------------------
// MAIN EXECUTION: Generate SVGs, PNGs, and ICO
// -------------------------------------------------------------
async function run() {
  console.log('Generating brand assets...');

  // 1. Write SVGs
  const iconDarkSvg = createNefIconSvg({ isDark: true });
  const iconLightSvg = createNefIconSvg({ isDark: false });
  const faviconSvg = createFaviconSvg();
  const horizontalDarkSvg = createHorizontalLogoSvg({ isDark: true });
  const horizontalLightSvg = createHorizontalLogoSvg({ isDark: false });
  const bannerSvg = createReadmeBannerSvg();

  fs.writeFileSync(path.join(BRAND_DIR, 'nef-icon.svg'), iconDarkSvg);
  fs.writeFileSync(path.join(BRAND_DIR, 'nef-icon-light.svg'), iconLightSvg);
  fs.writeFileSync(path.join(BRAND_DIR, 'nef-favicon.svg'), faviconSvg);
  fs.writeFileSync(path.join(BRAND_DIR, 'nef-logo-horizontal.svg'), horizontalDarkSvg);
  fs.writeFileSync(path.join(BRAND_DIR, 'nef-logo-light.svg'), horizontalLightSvg);
  fs.writeFileSync(path.join(BRAND_DIR, 'nef-github-banner.svg'), bannerSvg);

  // Also write directly to web/public
  fs.writeFileSync(path.join(WEB_PUBLIC_DIR, 'favicon.svg'), faviconSvg);
  fs.writeFileSync(path.join(WEB_PUBLIC_DIR, 'logo.svg'), iconDarkSvg);

  console.log('Saved SVG files.');

  // 2. Render PNGs using Resvg
  function renderPng(svgStr: string, width: number, outputPath: string) {
    const resvg = new Resvg(svgStr, { fitTo: { mode: 'width', value: width } });
    const png = resvg.render().asPng();
    fs.writeFileSync(outputPath, png);
    return png;
  }

  // Favicon sizes
  renderPng(faviconSvg, 16, path.join(BRAND_DIR, 'favicon-16.png'));
  renderPng(faviconSvg, 32, path.join(BRAND_DIR, 'favicon-32.png'));
  renderPng(faviconSvg, 48, path.join(BRAND_DIR, 'favicon-48.png'));

  // App & Touch icons
  renderPng(iconDarkSvg, 180, path.join(WEB_PUBLIC_DIR, 'apple-touch-icon.png'));
  renderPng(iconDarkSvg, 180, path.join(BRAND_DIR, 'apple-touch-icon.png'));
  renderPng(iconDarkSvg, 192, path.join(WEB_PUBLIC_DIR, 'icon-192.png'));
  renderPng(iconDarkSvg, 512, path.join(WEB_PUBLIC_DIR, 'icon-512.png'));
  renderPng(iconDarkSvg, 512, path.join(BRAND_DIR, 'nef-icon-512.png'));
  renderPng(iconDarkSvg, 1024, path.join(BRAND_DIR, 'nef-icon-1024.png'));

  // Logos & Banners
  renderPng(horizontalDarkSvg, 1200, path.join(BRAND_DIR, 'nef-logo-horizontal.png'));
  renderPng(bannerSvg, 1280, path.join(BRAND_DIR, 'nef-github-banner.png'));

  console.log('Saved PNG files.');

  // 3. Generate multi-resolution .ico favicon with ffmpeg
  const icoDestBrand = path.join(BRAND_DIR, 'favicon.ico');
  const icoDestWeb = path.join(WEB_PUBLIC_DIR, 'favicon.ico');
  const fav32Png = path.join(BRAND_DIR, 'favicon-32.png');

  execSync(`ffmpeg -y -i "${fav32Png}" "${icoDestBrand}" 2>/dev/null`);
  fs.copyFileSync(icoDestBrand, icoDestWeb);
  console.log('Saved favicon.ico files.');
}

run().catch((err) => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
