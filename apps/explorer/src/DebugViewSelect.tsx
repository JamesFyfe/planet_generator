import { DEBUG_CHANNEL_REGISTRY, isDebugChannelId } from "@planet/engine";
import { usePlanetStore } from "./store";

export function DebugViewSelect() {
  const debugChannel = usePlanetStore((state) => state.debugChannel);
  const setDebugChannel = usePlanetStore((state) => state.setDebugChannel);

  return (
    <label className="debug-view">
      Debug view
      <select
        aria-label="Debug view"
        data-testid="debug-view"
        value={debugChannel}
        onChange={(event) => {
          const value = event.target.value;
          if (isDebugChannelId(value)) setDebugChannel(value);
        }}
      >
        {DEBUG_CHANNEL_REGISTRY.map((channel) => (
          <option key={channel.id} value={channel.id}>
            {channel.label}
          </option>
        ))}
      </select>
    </label>
  );
}
