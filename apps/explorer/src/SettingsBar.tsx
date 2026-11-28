import {
  PLANET_PRESETS,
  encodePlanetQuery,
  matchingPlanetPreset,
  planetParamsFromJson,
  planetParamsToJson,
} from "@planet/engine";
import { useEffect, useRef, useState } from "react";
import { usePlanetStore } from "./store";

function writeParamsToUrl(params: Parameters<typeof encodePlanetQuery>[0]): void {
  const query = encodePlanetQuery(params);
  const next = `${window.location.pathname}?${query}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(null, "", next);
}

export function SettingsBar() {
  const params = usePlanetStore((state) => state.params);
  const debugChannel = usePlanetStore((state) => state.debugChannel);
  const applyPreset = usePlanetStore((state) => state.applyPreset);
  const replaceParams = usePlanetStore((state) => state.replaceParams);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const preset = matchingPlanetPreset(params);

  useEffect(() => {
    writeParamsToUrl(usePlanetStore.getState().params);
    return usePlanetStore.subscribe((state) => {
      writeParamsToUrl(state.params);
    });
  }, []);

  const save = () => {
    const blob = new Blob([planetParamsToJson(params)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "planet-settings.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="settings-bar">
      <label>
        Preset
        <select
          aria-label="Preset"
          data-testid="preset-select"
          value={preset?.id ?? ""}
          onChange={(event) => {
            const id = event.target.value;
            if (id) applyPreset(id);
          }}
        >
          <option value="" disabled={preset !== undefined}>
            Custom
          </option>
          {PLANET_PRESETS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={save}>
        Save JSON
      </button>
      <button type="button" onClick={() => fileRef.current?.click()}>
        Load JSON
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Load settings JSON"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void file.text().then(
            (text) => {
              try {
                replaceParams(planetParamsFromJson(text));
                setError(null);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not read settings");
              }
            },
            () => setError("Could not read settings"),
          );
        }}
      />
      <p className="params-readout" data-testid="params-readout">
        <strong>Planet</strong>
        <br />
        seed <span data-testid="value-seed">{params.seed}</span>
        <br />
        radius <span data-testid="value-radius">{params.radius}</span> m
        <br />
        relief <span data-testid="value-amplitude">{params.amplitude}</span> m
        <br />
        sea level <span data-testid="value-sea-level">{params.seaLevel}</span> m
        <br />
        view <span data-testid="value-debug-view">{debugChannel}</span>
        <br />
        <span className="settings-hint">The address bar is the share link.</span>
      </p>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {preset ? <p className="settings-hint">{preset.summary}</p> : null}
    </div>
  );
}
