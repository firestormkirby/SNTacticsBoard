/**
 * harness.ts, the chrome around the device iframe.
 *
 * Deliberately plain DOM: nothing here shares a React tree, a style system or a
 * bundle path with the thing being previewed, so a harness bug can never be
 * mistaken for a bug in your UI.
 */
import config from '../preview.config';
import type { DevicePreset } from './config';

const DEFAULT_DEVICES: DevicePreset[] = [
  { id: 'nomad', label: 'Nomad A6X2', width: 1404, height: 1872, note: '1404 × 1872' },
  { id: 'manta', label: 'Manta A5X2', width: 1920, height: 2560, note: '1920 × 2560' },
];

const devices = config.devices?.length ? config.devices : DEFAULT_DEVICES;
/** 0 means "fit": scale the device to the space available. */
const ZOOMS = [0, 0.35, 0.5, 0.75, 1];

/**
 * localStorage only remembers your last choices. It can be missing or throw
 * (private windows, blocked site data, sandboxed hosting), and the preview
 * must work regardless.
 */
function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the choice just won't survive a reload.
  }
}

const state = {
  scenario: recall('preview:scenario') ?? config.scenarios[0].id,
  device: recall('preview:device') ?? devices[0].id,
  zoom: Number(recall('preview:zoom') ?? '0'),
};
if (!config.scenarios.some(s => s.id === state.scenario)) state.scenario = config.scenarios[0].id;
if (!devices.some(d => d.id === state.device)) state.device = devices[0].id;
if (!ZOOMS.includes(state.zoom)) state.zoom = 0;

let frame = document.getElementById('device') as HTMLIFrameElement;
const wrap = document.getElementById('wrap') as HTMLElement;
const main = document.querySelector('main') as HTMLElement;
const hint = document.getElementById('hint') as HTMLElement;

/**
 * Relative, with the scenario in the hash, so the preview also works when it
 * is hosted under a subpath or somewhere that drops query strings.
 */
function deviceUrl(): string {
  return `device.html#${encodeURIComponent(state.scenario)}`;
}

function scaleFor(dev: DevicePreset): number {
  if (state.zoom) return state.zoom;
  const style = getComputedStyle(main);
  const availW = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availH = main.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 60;
  return Math.max(0.1, Math.min(1, availW / dev.width, availH / dev.height));
}

/**
 * Swapping in a fresh iframe guarantees a full load. Only the hash differs
 * between scenarios, and changing just the hash of a src would not reload.
 */
function loadFrame(): void {
  const next = frame.cloneNode(false) as HTMLIFrameElement;
  next.src = deviceUrl();
  next.setAttribute('data-url', deviceUrl());
  frame.replaceWith(next);
  frame = next;
}

function render(reloadFrame: boolean): void {
  const dev = devices.find(d => d.id === state.device) ?? devices[0];
  const scn = config.scenarios.find(s => s.id === state.scenario) ?? config.scenarios[0];
  const zoom = scaleFor(dev);

  frame.style.width = `${dev.width}px`;
  frame.style.height = `${dev.height}px`;
  wrap.style.transform = `scale(${zoom})`;
  // A scaled iframe still occupies its unscaled size in layout, leaving a
  // page-long gap beneath it. Pull that back to what is actually drawn.
  wrap.style.width = `${dev.width * zoom}px`;
  wrap.style.height = `${dev.height * zoom}px`;

  if (reloadFrame || frame.getAttribute('data-url') !== deviceUrl()) {
    loadFrame();
  }
  frame.style.width = `${dev.width}px`;
  frame.style.height = `${dev.height}px`;

  hint.textContent = [scn.note, dev.note].filter(Boolean).join(' · ');
  paintButtons();
  remember('preview:scenario', state.scenario);
  remember('preview:device', state.device);
  remember('preview:zoom', String(state.zoom));
}

function button(
  label: string, sub: string | null, pressed: boolean, onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'opt';
  b.setAttribute('aria-pressed', String(pressed));
  b.textContent = label;
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    b.appendChild(s);
  }
  b.addEventListener('click', onClick);
  return b;
}

function paintButtons(): void {
  document.getElementById('scenarios')!.replaceChildren(
    ...config.scenarios.map(s =>
      button(s.label, s.note ?? null, s.id === state.scenario, () => {
        state.scenario = s.id;
        render(true);
      })),
  );

  document.getElementById('devices')!.replaceChildren(
    ...devices.map(d =>
      button(d.label, `${d.width} × ${d.height}`, d.id === state.device, () => {
        state.device = d.id;
        render(false);
      })),
  );

  document.getElementById('zooms')!.replaceChildren(
    ...ZOOMS.map(z =>
      button(z ? `${Math.round(z * 100)}%` : 'Fit', null, z === state.zoom, () => {
        state.zoom = z;
        render(false);
      })),
  );
}

document.getElementById('title')!.textContent = config.name;
document.getElementById('reload')!.addEventListener('click', () => render(true));
const popout = document.getElementById('popout') as HTMLAnchorElement;
popout.addEventListener('click', () => {
  popout.href = deviceUrl();
});
window.addEventListener('resize', () => {
  if (!state.zoom) render(false);
});

render(true);
