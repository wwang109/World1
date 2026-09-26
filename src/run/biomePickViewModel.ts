// Biome picker view-model — pure, Phaser-free (docs/biome-paths-proposal.md §2.4(d)/§2.5).

import { forecastBand, type BandForecast } from './biomeForecast';
import { biomeBandOffers, biomeLedgerOf, pendingBiomeBand, type RunState } from './runState';

export interface BiomePickOption {
  biomeId: string;
  forecast: BandForecast;
}

export interface BiomePickViewModel {
  band: number;
  options: readonly BiomePickOption[];
}

/** `null` when no pick is due. Otherwise the pending band and its candidates, each previewed through `forecastBand` as if chosen. Read-only. */
export function biomePickViewModelFor(state: Readonly<RunState>): BiomePickViewModel | null {
  const band = pendingBiomeBand(state);
  if (band === null) return null;
  const ledger = biomeLedgerOf(state);
  const offerIds = biomeBandOffers(state, band);
  const options = offerIds.map((biomeId) => ({
    biomeId,
    forecast: forecastBand({ ...state, biomeChoices: { ...ledger, [band]: biomeId } } as RunState, band),
  }));
  return { band, options };
}
