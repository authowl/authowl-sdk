// Validate ASCII wire segments before canonicalising them.
export function parseApiKey(key: string) {
  const parts = key.split('_');
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [kind, env] = parts;
  const region = parts.length === 5 ? parts[2]! : null;
  const projectId = parts[parts.length - 2]!;
  const random = parts[parts.length - 1]!;
  if (!/^[ps]k$/i.test(kind!) || !/^(live|test)$/i.test(env!)) return null;
  if (region !== null && (region.length > 24 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(region))) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) return null;
  if (!/^[A-Za-z0-9]{20,}$/.test(random) || /\s/.test(key)) return null;
  return { kind: kind!.toLowerCase(), env: env!.toLowerCase(), region: region?.toLowerCase() ?? null, projectId: projectId.toLowerCase() };
}
