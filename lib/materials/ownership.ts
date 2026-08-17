// Every R2 object this app is allowed to delete on a user's behalf lives
// under one of these userId-namespaced prefixes: materials/{userId}/...
// (lib/materials/storage.ts) or partner-files/{userId}/... (partner-upload
// route). Ownership is the prefix matching the authenticated caller's own
// userId — never the key the client claims to own.
const OWNED_NAMESPACES = new Set(['materials', 'partner-files']);

export function ownsR2Key(key: string, userId: string): boolean {
  if (!key || !userId) return false;
  const parts = key.split('/');
  if (parts.length < 2) return false;
  const [namespace, owner] = parts;
  if (!OWNED_NAMESPACES.has(namespace)) return false;
  return owner === userId;
}
