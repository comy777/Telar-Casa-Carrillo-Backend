/** Operaciones sobre el árbol de categorías a partir de la lista plana. */
export interface TreeNode {
  id: string;
  parentId: string | null;
}

/** Ancestros de `id`, del padre a la raíz. Tolera ciclos en datos corruptos. */
export function ancestorsOf<T extends TreeNode>(id: string, nodes: readonly T[]): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: T[] = [];
  const seen = new Set<string>([id]);
  let current = byId.get(id)?.parentId ?? null;
  while (current && !seen.has(current)) {
    const node = byId.get(current);
    if (!node) break;
    result.push(node);
    seen.add(current);
    current = node.parentId;
  }
  return result;
}

/** Ids de `id` y de todas sus descendientes. */
export function descendantIdsOf(id: string, nodes: readonly TreeNode[]): string[] {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }
  const result: string[] = [];
  const pending = [id];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (result.includes(current)) continue;
    result.push(current);
    pending.push(...(children.get(current) ?? []));
  }
  return result;
}

/** Niveles que cuelgan de `id` (0 si no tiene hijas). */
export function subtreeHeightOf(
  id: string,
  nodes: readonly TreeNode[],
  seen: ReadonlySet<string> = new Set(),
): number {
  const visited = new Set(seen).add(id);
  const children = nodes.filter((node) => node.parentId === id && !visited.has(node.id));
  if (children.length === 0) return 0;
  return 1 + Math.max(...children.map((child) => subtreeHeightOf(child.id, nodes, visited)));
}
