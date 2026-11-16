// REQ 1076 — 3MF objects for a composed assembly: one object per shown
// component instance, made of that component's bodies where the assembly
// places them (the composed meshes are already in the assembly frame).
import type { ComposedBody } from './assembly.types';
import type { ThreeMfBody } from './threeMf';

export interface AssemblyThreeMfInput {
  bodies: ComposedBody[];
  /** Instances hidden in the assembly (their bodies are left out). */
  hiddenInstanceIds: Set<string>;
  /** Component bodies hidden individually. */
  hiddenBodyIds: Set<string>;
  /** Display name of a component's part (its part number). */
  nameOf: (body: ComposedBody) => string;
}

export function assemblyThreeMfObjects(input: AssemblyThreeMfInput): { groups: ThreeMfBody[][]; names: string[] } {
  const byInstance = new Map<string, { name: string; bodies: ThreeMfBody[] }>();
  for (const body of input.bodies) {
    if (input.hiddenInstanceIds.has(body.instanceId) || input.hiddenBodyIds.has(body.id)) continue;
    const meshes = body.faces
      .filter(f => f.positions && f.indices && f.indices.length >= 3)
      .map(f => ({ positions: f.positions, indices: f.indices }));
    if (meshes.length === 0) continue;
    let slot = byInstance.get(body.instanceId);
    if (!slot) byInstance.set(body.instanceId, slot = { name: input.nameOf(body), bodies: [] });
    slot.bodies.push({ id: body.id, name: body.name ?? body.id, color: null, meshes });
  }
  // A part used more than once: tell its objects apart by instance id.
  const uses = new Map<string, number>();
  for (const s of byInstance.values()) uses.set(s.name, (uses.get(s.name) ?? 0) + 1);
  const groups: ThreeMfBody[][] = [];
  const names: string[] = [];
  for (const [instanceId, s] of byInstance) {
    groups.push(s.bodies);
    names.push((uses.get(s.name) ?? 0) > 1 ? `${s.name} (${instanceId})` : s.name);
  }
  return { groups, names };
}
