import type { ChunkRequest } from "@planet/engine";

export function chunkMeshKey(request: ChunkRequest): string {
  return `${request.face}:${request.lod}:${request.x}:${request.y}`;
}

export function chunkParent(request: ChunkRequest): ChunkRequest | null {
  if (request.lod === 0) return null;
  return {
    face: request.face,
    lod: request.lod - 1,
    x: Math.floor(request.x / 2),
    y: Math.floor(request.y / 2),
  };
}

/** True when `ancestor` contains `node`, including the case where they are the same node. */
export function chunkCovers(ancestor: ChunkRequest, node: ChunkRequest): boolean {
  if (ancestor.face !== node.face || ancestor.lod > node.lod) return false;
  const shift = node.lod - ancestor.lod;
  const scale = 2 ** shift;
  return Math.floor(node.x / scale) === ancestor.x && Math.floor(node.y / scale) === ancestor.y;
}

function nearestResidentAncestor(
  node: ChunkRequest,
  resident: ReadonlySet<string>,
  byKey: ReadonlyMap<string, ChunkRequest>,
): ChunkRequest | null {
  let cursor = chunkParent(node);
  while (cursor) {
    const key = chunkMeshKey(cursor);
    if (resident.has(key)) return byKey.get(key) ?? cursor;
    cursor = chunkParent(cursor);
  }
  return null;
}

/**
 * Meshes to show for this selection.
 * `available` is every chunk that already has data (on the GPU, or ready to upload).
 * A selected leaf is shown only when it is available and no coarser fallback is
 * still covering a sibling that is not. That fallback stays until every selected
 * leaf under it is available, which is what keeps the parent on screen instead
 * of opening a hole. When the selection coarsens, resident descendants stay
 * until the coarser chunk itself is available.
 * The walks are along the quadtree, not a scan of every resident chunk per leaf.
 */
export function chunksToDisplay(
  selection: readonly ChunkRequest[],
  available: readonly ChunkRequest[],
): ChunkRequest[] {
  const byKey = new Map<string, ChunkRequest>();
  for (const node of available) byKey.set(chunkMeshKey(node), node);
  const resident = new Set(byKey.keys());
  const selected = new Map(selection.map((node) => [chunkMeshKey(node), node]));
  const display = new Map<string, ChunkRequest>();

  for (const leaf of selection) {
    const key = chunkMeshKey(leaf);
    if (resident.has(key)) {
      display.set(key, leaf);
      continue;
    }
    const ancestor = nearestResidentAncestor(leaf, resident, byKey);
    if (ancestor) display.set(chunkMeshKey(ancestor), ancestor);
  }

  for (const leaf of selection) {
    const key = chunkMeshKey(leaf);
    if (!display.has(key)) continue;
    let cursor = chunkParent(leaf);
    while (cursor) {
      if (display.has(chunkMeshKey(cursor))) {
        display.delete(key);
        break;
      }
      cursor = chunkParent(cursor);
    }
  }

  for (const node of available) {
    let cursor: ChunkRequest | null = node;
    let selectedAncestor: ChunkRequest | null = null;
    while (cursor) {
      const key = chunkMeshKey(cursor);
      const selectedNode = selected.get(key);
      if (selectedNode) {
        selectedAncestor = selectedNode;
        break;
      }
      cursor = chunkParent(cursor);
    }
    if (!selectedAncestor || resident.has(chunkMeshKey(selectedAncestor))) continue;
    if (nearestResidentAncestor(selectedAncestor, resident, byKey)) continue;
    const parent = chunkParent(node);
    if (parent && resident.has(chunkMeshKey(parent)) && chunkCovers(selectedAncestor, parent)) {
      continue;
    }
    display.set(chunkMeshKey(node), node);
  }

  return [...display.values()];
}
