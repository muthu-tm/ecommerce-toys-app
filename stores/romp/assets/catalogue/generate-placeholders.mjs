#!/usr/bin/env node
/**
 * Generates the ROMP catalogue placeholder artwork.
 *
 * These are **development placeholders**, not real product photography — a freshly seeded
 * store has no photos, and rather than the bare first-letter tile the storefront falls back
 * to, these give the demo catalogue a complete, branded look. Real photography still arrives
 * through the admin upload pipeline (register + finalize), which overwrites the seeded media.
 *
 * Each is a small, self-contained SVG: a warm gradient panel in the brand's palette, a large
 * initial, the product name, and a category motif. Colours are literals here because this is
 * artwork under `stores/`, not application code — the `no-hardcoded-brand` rule is scoped to
 * `apps/`. Run `node generate-placeholders.mjs` from this directory to regenerate.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Brand-adjacent palette pairs (bg gradient stops + accent), rotated per product so the
// grid reads as varied rather than nine identical tiles.
const THEMES = [
  { a: '#1c2411', b: '#2b3a16', accent: '#d8fd4f', ink: '#eef7c6' },
  { a: '#2a1512', b: '#3d1c17', accent: '#ff6f5e', ink: '#ffd9d2' },
  { a: '#101a24', b: '#16283a', accent: '#5ec8ff', ink: '#cfe9ff' },
  { a: '#1d1526', b: '#2c1e3d', accent: '#c79bff', ink: '#e9dcff' },
  { a: '#0f2420', b: '#153a31', accent: '#5ee9a0', ink: '#c8f7e2' },
  { a: '#241f10', b: '#3a3016', accent: '#ffc857', ink: '#ffeec2' },
];

/** A simple category motif drawn with the accent colour, sized within a 520×360 stage. */
function motif(category, accent) {
  switch (category) {
    case 'sensory':
    case 'wooden':
      // Stacked rings.
      return `
        <g fill="none" stroke="${accent}" stroke-width="10" opacity="0.9">
          <ellipse cx="360" cy="250" rx="90" ry="26"/>
          <ellipse cx="360" cy="212" rx="72" ry="21"/>
          <ellipse cx="360" cy="178" rx="54" ry="16"/>
          <ellipse cx="360" cy="150" rx="36" ry="12"/>
        </g>`;
    case 'puzzles':
    case 'jigsaws':
      // Puzzle piece.
      return `
        <path d="M320 150h48a18 18 0 1 1 36 0h48v48a18 18 0 1 1 0 36v48h-48a18 18 0 1 0-36 0h-48v-48a18 18 0 1 0 0-36z"
          fill="${accent}" opacity="0.9"/>`;
    case 'building-stem':
      // Gear.
      return `
        <g transform="translate(360 210)" fill="${accent}" opacity="0.9">
          <circle r="58"/>
          <circle r="24" fill="#0e0e10"/>
          ${Array.from({ length: 8 }, (_, i) => {
            const angle = (i * Math.PI) / 4;
            const x = Math.cos(angle) * 66;
            const y = Math.sin(angle) * 66;
            return `<rect x="${(x - 10).toFixed(1)}" y="${(y - 10).toFixed(1)}" width="20" height="20" rx="4"/>`;
          }).join('')}
        </g>`;
    case 'pretend-play':
      // Star / spotlight.
      return `
        <path d="M360 150l19 46 50 4-38 33 12 49-43-27-43 27 12-49-38-33 50-4z"
          fill="${accent}" opacity="0.9"/>`;
    case 'outdoor':
      // Rocker / arc.
      return `<path d="M300 250q60 -70 120 0" fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round" opacity="0.9"/>`;
    case 'books':
      // Open book.
      return `
        <g fill="none" stroke="${accent}" stroke-width="10" opacity="0.9">
          <path d="M300 170q60 -22 60 12v96q0 -34 -60 -12z"/>
          <path d="M420 170q-60 -22 -60 12v96q0 -34 60 -12z"/>
        </g>`;
    default:
      return `<circle cx="360" cy="210" r="54" fill="${accent}" opacity="0.9"/>`;
  }
}

/** Escapes text for XML content. */
function esc(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(product, index) {
  const theme = THEMES[index % THEMES.length];
  const initial = product.name.trim().slice(0, 1).toUpperCase();
  const name = product.name.length > 34 ? `${product.name.slice(0, 33)}…` : product.name;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="360" viewBox="0 0 520 360" role="img" aria-label="${esc(product.name)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.a}"/>
      <stop offset="1" stop-color="${theme.b}"/>
    </linearGradient>
  </defs>
  <rect width="520" height="360" fill="url(#bg)"/>
  <text x="48" y="150" font-family="'Archivo Black', Arial Black, sans-serif" font-size="150" font-weight="900" fill="${theme.accent}" opacity="0.28">${esc(initial)}</text>
  ${motif(product.category, theme.accent)}
  <text x="48" y="312" font-family="'Archivo', Arial, sans-serif" font-size="24" font-weight="700" fill="${theme.ink}">${esc(name)}</text>
  <text x="48" y="336" font-family="'Archivo', Arial, sans-serif" font-size="14" font-weight="500" fill="${theme.ink}" opacity="0.7">${esc(product.brand)}</text>
</svg>
`;
}

// Kept in step with seed.catalogue.ts. slug/name/brand/category only — enough for artwork.
const products = [
  { slug: 'beechwood-stacking-rings', name: 'Beechwood stacking rings', brand: 'Kaadu', category: 'sensory' },
  { slug: 'first-shapes-puzzle-board', name: 'First shapes puzzle board', brand: 'Kaadu', category: 'puzzles' },
  { slug: 'market-stall-play-set', name: 'Market stall play set', brand: 'Chotu Co.', category: 'pretend-play' },
  { slug: 'gear-machine-builder', name: 'Gear machine builder', brand: 'Tinker Bay', category: 'building-stem' },
  { slug: 'city-map-jigsaw-500', name: 'City map jigsaw, 500 pieces', brand: 'Paper Lane', category: 'jigsaws' },
  { slug: 'balance-board-outdoor', name: 'Curved balance board', brand: 'Chotu Co.', category: 'outdoor' },
  { slug: 'why-does-it-rain-book', name: 'Why does it rain?', brand: 'Paper Lane', category: 'books' },
  { slug: 'weaving-loom-starter', name: 'Lap weaving loom', brand: 'Tinker Bay', category: 'wooden' },
  { slug: 'shadow-theatre-kit', name: 'Shadow theatre kit', brand: 'Chotu Co.', category: 'pretend-play' },
];

for (const [index, product] of products.entries()) {
  const svg = render(product, index);
  writeFileSync(join(here, `${product.slug}.svg`), svg, 'utf8');
  process.stdout.write(`wrote ${product.slug}.svg\n`);
}
