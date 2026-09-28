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
const ZOOMS = [0.35, 0.5, 0.75, 1];

const state = {
  scenario: localStorage.getItem('preview:scenario') ?? config.scenarios[0].id,
  device: localStorage.getItem('preview:device') ?? devices[0].id,
  zoom: Number(localStorage.getItem('preview:zoom') ?? '0.5'),
};

const frame = document.getElementById('device') as HTMLIFrameElement;
const wrap = document.getElementById('wrap') as HTMLElement;
const hint = document.getElementById('hint') as HTMLElement;

function deviceUrl(): string {
  return `/device.html?scenario=${encodeURIComponent(state.scenario)}`;
}

function render(reloadFrame: boolean): void {
  const dev = devices.find(d => d.id === state.device) ?? devices[0];
  const scn = config.scenarios.find(s => s.id === state.scenario) ?? config.scenarios[0];

  frame.style.width = `${dev.width}px`;
  frame.style.height = `${dev.height}px`;
  wrap.style.transform = `scale(${state.zoom})`;
  // A scaled iframe still occupies its unscaled size in layout, leaving a
  // page-long gap beneath it. Pull that back to what is actually drawn.
  wrap.style.width = `${dev.width * state.zoom}px`;
  wrap.style.height = `${dev.height * state.zoom}px`;

  if (reloadFrame || frame.getAttribute('data-url') !== deviceUrl()) {
    frame.setAttribute('data-url', deviceUrl());
    frame.src = deviceUrl();
  }

  hint.textContent = [scn.note, dev.note].filter(Boolean).join(' · ');
  paintButtons();
  localStorage.setItem('preview:scenario', state.scenario);
  localStorage.setItem('preview:device', state.device);
  localStorage.setItem('preview:zoom', String(state.zoom));
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
      button(`${Math.round(z * 100)}%`, null, z === state.zoom, () => {
        state.zoom = z;
        render(false);
      })),
  );
}

document.getElementById('title')!.textContent = config.name;
document.getElementById('reload')!.addEventListener('click', () => render(true));
document.getElementById('popout')!.addEventListener('click', () => {
  window.open(deviceUrl(), '_blank');
});

render(true);
