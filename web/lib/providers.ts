/*
  Compute-provider catalogue + quoting. This is the *buyer-side* view of the marketplace's
  supply: the seller dashboard (/sell) advertises nodes; the buyer picks one and the chosen
  node's id flows through as `payment.supplier_id` in the JobSpec (a free-form string in the
  API contract, so this needs no new endpoint).

  Quote model: faster GPUs cost more per unit of work. work = ligands × exhaustiveness.
  credits = rate × work. It's a transparent, monotonic stand-in for real spot pricing.
*/

export interface Provider {
  id: string;
  name: string;
  gpu: string;
  region: string;
  /** Credits per unit of work (ligand × exhaustiveness). Premium hardware = higher rate. */
  rate: number;
  /** Rough relative throughput, for the "~Xs/ligand" hint. */
  secPerLigand: number;
}

export const PROVIDERS: Provider[] = [
  { id: "node-1", name: "Aurora", gpu: "NVIDIA A100 80GB", region: "us-east", rate: 0.9, secPerLigand: 8 },
  { id: "node-2", name: "Helios", gpu: "NVIDIA RTX 4090", region: "eu-west", rate: 0.55, secPerLigand: 14 },
  { id: "node-3", name: "Pico", gpu: "NVIDIA RTX 3090", region: "ap-south", rate: 0.35, secPerLigand: 22 },
];

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Quote in credits for a given provider + workload. Always at least the provider rate. */
export function quoteCredits(
  provider: Provider,
  ligands: number,
  exhaustiveness: number,
): number {
  const work = Math.max(1, ligands) * Math.max(1, exhaustiveness);
  return Math.max(1, Math.round(provider.rate * work));
}

/** Rough wall-clock estimate (seconds) for the run, for display only. */
export function etaSeconds(provider: Provider, ligands: number): number {
  return Math.max(provider.secPerLigand, Math.round(provider.secPerLigand * Math.max(1, ligands)));
}
