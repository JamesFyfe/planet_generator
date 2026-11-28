import {
  BIOME_RULES,
  ICE_CAP_TEMPERATURE_MAX,
  biomeIndex,
  climateBinContains,
  type BiomeId,
  type BiomeRule,
} from "../data/biomes";
import { clamp } from "../vec3";

export interface BiomeQuery {
  temperature: number;
  /** 0 dry, 1 saturated. */
  moisture: number;
  /** Meters above sea level. Negative is underwater. */
  seaRelativeHeight: number;
  slope: number;
  materialId: number;
  shoreWidth: number;
  /** Higher keeps a biome until the sample is closer to its bin edge. */
  sharpness: number;
}

export interface BiomeChoice {
  biomeId: number;
  secondaryBiomeId: number;
  /** Weight of {@link biomeId}. The rest belongs to the secondary id. */
  weight: number;
}

interface ScoredRule {
  rule: BiomeRule;
  /** 1 at the bin center, 0 at the edge, negative outside. */
  confidence: number;
}

/**
 * Picks a biome from the data table.
 * Open water is ocean unless it is cold enough for an ice cap, which is still
 * a temperature test. Overrides (beach, rock, alpine, wetland) win on priority.
 * The secondary id is the climate bin underneath, so the shader can blend.
 */
export function classifyBiome(query: BiomeQuery): BiomeChoice {
  if (query.seaRelativeHeight < 0) {
    if (query.temperature < ICE_CAP_TEMPERATURE_MAX) return solid("ice_cap");
    return solid("ocean");
  }

  const matches: ScoredRule[] = [];
  let base: ScoredRule | undefined;
  for (const rule of BIOME_RULES) {
    const confidence = ruleConfidence(rule, query);
    if (confidence === null) continue;
    const scored = { rule, confidence };
    matches.push(scored);
    if (rule.priority === 0 && (!base || confidence > base.confidence)) base = scored;
  }

  if (matches.length === 0 || !base) {
    return solid("bare_rock");
  }

  matches.sort((a, b) => {
    if (b.rule.priority !== a.rule.priority) return b.rule.priority - a.rule.priority;
    return b.confidence - a.confidence;
  });
  const winner = matches[0];
  if (!winner) return solid("bare_rock");

  const secondary = winner.rule.priority === 0 ? nearestOtherBase(winner.rule, query) : base.rule;
  const softness = 1 / Math.max(query.sharpness, 0.05);
  const edge = clamp((softness - winner.confidence) / softness, 0, 0.65);
  const secondaryId = biomeIndex(secondary.id);
  const primaryId = biomeIndex(winner.rule.id);
  if (secondaryId === primaryId)
    return { biomeId: primaryId, secondaryBiomeId: primaryId, weight: 1 };
  return {
    biomeId: primaryId,
    secondaryBiomeId: secondaryId,
    weight: 1 - edge,
  };
}

function solid(id: BiomeId): BiomeChoice {
  const index = biomeIndex(id);
  return { biomeId: index, secondaryBiomeId: index, weight: 1 };
}

/** Null when the rule does not apply. */
function ruleConfidence(rule: BiomeRule, query: BiomeQuery): number | null {
  if (!climateBinContains(rule, query.temperature, query.moisture)) return null;
  const altitude = query.seaRelativeHeight;
  if (rule.altitudeMin !== undefined && altitude < rule.altitudeMin) return null;
  if (rule.altitudeMax !== undefined) {
    const max = rule.altitudeMax === "shore" ? query.shoreWidth : rule.altitudeMax;
    if (altitude > max) return null;
  }
  if (rule.slopeMin !== undefined && query.slope < rule.slopeMin) return null;
  if (rule.slopeMax !== undefined && query.slope > rule.slopeMax) return null;
  if (rule.materials && !rule.materials.includes(query.materialId)) return null;

  const tempSpan = Math.max(rule.tempMax - rule.tempMin, 1e-3);
  const moistureSpan = Math.max(rule.moistureMax - rule.moistureMin, 1e-3);
  const tempMid = (rule.tempMin + rule.tempMax) / 2;
  const moistureMid = (rule.moistureMin + rule.moistureMax) / 2;
  const tempFit = 1 - Math.abs(query.temperature - tempMid) / (tempSpan / 2);
  const moistureFit = 1 - Math.abs(query.moisture - moistureMid) / (moistureSpan / 2);
  return Math.min(tempFit, moistureFit);
}

function nearestOtherBase(winner: BiomeRule, query: BiomeQuery): BiomeRule {
  let best: BiomeRule | undefined;
  let bestDistance = Infinity;
  for (const rule of BIOME_RULES) {
    if (rule.priority !== 0 || rule === winner) continue;
    const distance = ruleDistance(rule, query);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = rule;
    }
  }
  return best ?? winner;
}

function ruleDistance(rule: BiomeRule, query: BiomeQuery): number {
  const temperature = outside(query.temperature, rule.tempMin, rule.tempMax) / 40;
  const moisture = outside(query.moisture, rule.moistureMin, rule.moistureMax);
  return Math.hypot(temperature, moisture);
}

function outside(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}
