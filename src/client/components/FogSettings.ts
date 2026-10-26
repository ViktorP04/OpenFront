import { html, type TemplateResult } from "lit";
import { translateText } from "../Utils";

export type FogScale = 1 | 2 | 4 | 8;

export function renderFogSettings(
  enabled: boolean,
  scale: FogScale,
  trails: boolean,
  onScale: (scale: FogScale) => void,
  onTrails: (enabled: boolean) => void,
): TemplateResult[] {
  if (!enabled) return [];
  return [
    html` <div
      class="rounded-xl border border-white/20 bg-white/5 p-4 space-y-2"
    >
      <span class="block text-xs font-bold uppercase text-white"
        >${translateText("game_settings.fog_resolution")}</span
      >
      <select
        data-fog-resolution
        aria-label=${translateText("game_settings.fog_resolution")}
        class="w-full bg-slate-800 border border-white/20 rounded-lg p-2 text-white"
        .value=${String(scale)}
        @change=${(event: Event) => onScale(Number((event.target as HTMLSelectElement).value) as FogScale)}
      >
        ${([1, 2, 4, 8] as const).map((value) => html`<option value=${value} ?selected=${scale === value}>${translateText(`game_settings.fog_resolution_${value}`)}</option>`)}
      </select>
      <p class="text-xs text-white/60">
        ${translateText("game_settings.fog_resolution_description")}
      </p>
    </div>`,
    html` <label
      class="rounded-xl border border-white/20 bg-white/5 p-4 space-y-2 cursor-pointer"
    >
      <span
        class="flex gap-3 items-center text-xs font-bold uppercase text-white"
      >
        <input
          data-fog-trails
          type="checkbox"
          .checked=${trails}
          @change=${(event: Event) => onTrails((event.target as HTMLInputElement).checked)}
        />
        ${translateText("game_settings.fog_visibility_trails")}
      </span>
      <span class="block text-xs text-white/60"
        >${translateText("game_settings.fog_visibility_trails_description")}</span
      >
    </label>`,
  ];
}
