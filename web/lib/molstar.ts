/*
  Thin re-export of the Mol* pieces the viewer needs, plus small helpers. Kept in ONE
  module so the heavy engine is pulled in via a single dynamic import() boundary (client
  only) and never lands in the SSR / initial bundle.

  We deliberately use the headless `PluginContext` (NOT `mol-plugin-ui`) so no Mol* SCSS
  skin is imported — that's the thing that otherwise breaks Mol* under Turbopack.
*/

import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec";
import { Color } from "molstar/lib/mol-util/color";
import {
  StructureElement,
  StructureProperties,
  StructureSelection,
  type Structure,
} from "molstar/lib/mol-model/structure";
import { Script } from "molstar/lib/mol-script/script";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";

export type { Structure };
export { PluginContext, Color };

const ORANGE = Color(0xf59e0b); // matches the app's residue-selection colour
const CANVAS_BG = Color(0x0a0a0b); // near-black console canvas

/** Create + initialise a headless Mol* plugin bound to the given canvas/container. */
export async function createViewer(
  canvas: HTMLCanvasElement,
  container: HTMLDivElement,
): Promise<PluginContext> {
  const plugin = new PluginContext(DefaultPluginSpec());
  await plugin.init();
  await plugin.initViewerAsync(canvas, container);

  plugin.canvas3d?.setProps({
    renderer: { backgroundColor: CANVAS_BG, selectColor: ORANGE },
    // Depth-cued ambient occlusion + crisp silhouettes — the "publication-grade" look.
    postprocessing: {
      occlusion: { name: "on", params: { samples: 32, radius: 5, bias: 0.8, blurKernelSize: 15, resolutionScale: 1, multiScale: { name: "off", params: {} }, color: Color(0x000000) } },
      outline: { name: "on", params: { scale: 1, threshold: 0.33, color: Color(0x000000), includeTransparent: true } },
    },
  });

  return plugin;
}

/** Parse a PDB string and apply Mol*'s default hierarchy preset (cartoon + ligands). */
export async function loadPdb(plugin: PluginContext, pdbText: string): Promise<void> {
  await plugin.clear();
  const data = await plugin.builders.data.rawData({ data: pdbText });
  const traj = await plugin.builders.structure.parseTrajectory(data, "pdb");
  await plugin.builders.structure.hierarchy.applyPreset(traj, "default");
}

/** The currently loaded Structure (first one), or undefined if nothing is loaded. */
export function currentStructure(plugin: PluginContext): Structure | undefined {
  return plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data;
}

/** Resolve a click event's loci to a "<chain>:<resi>" residue key, or null. */
export function residueKeyFromLoci(loci: unknown): string | null {
  const l = loci as { kind?: string };
  if (!l || l.kind !== "element-loci") return null;
  const loc = StructureElement.Loci.getFirstLocation(loci as StructureElement.Loci);
  if (!loc) return null;
  const chain = StructureProperties.chain.auth_asym_id(loc);
  const resi = StructureProperties.residue.auth_seq_id(loc);
  return `${chain}:${resi}`;
}

/** Mark the given "<chain>:<resi>" residues as the (orange) selection in the viewer. */
export function markResidues(plugin: PluginContext, keys: Set<string>): void {
  const sel = plugin.managers.structure.selection;
  sel.clear();
  if (keys.size === 0) {
    plugin.canvas3d?.requestDraw();
    return;
  }

  const byChain = new Map<string, number[]>();
  for (const key of keys) {
    const [chain, resiStr] = key.split(":");
    const resi = Number(resiStr);
    if (!chain || Number.isNaN(resi)) continue;
    const list = byChain.get(chain) ?? [];
    list.push(resi);
    byChain.set(chain, list);
  }

  const structure = currentStructure(plugin);
  if (!structure) return;

  for (const [chain, resis] of byChain) {
    const query = MS.struct.generator.atomGroups({
      "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), chain]),
      "residue-test": MS.core.set.has([MS.set(...resis), MS.ammp("auth_seq_id")]),
    });
    const result = Script.getStructureSelection(query, structure);
    const loci = StructureSelection.toLociWithSourceUnits(result);
    sel.fromLoci("add", loci);
  }
  plugin.canvas3d?.requestDraw();
}

/** Start/stop the turntable spin. */
export function setSpin(plugin: PluginContext, on: boolean): void {
  plugin.canvas3d?.setProps({
    trackball: { animate: on ? { name: "spin", params: { speed: 1 } } : { name: "off", params: {} } },
  });
}

/** Recentre the camera on the whole structure. */
export function resetCamera(plugin: PluginContext): void {
  plugin.managers.camera.reset();
}
