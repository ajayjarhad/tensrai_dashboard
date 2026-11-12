// Callers asking for the same key while a request is in flight share it; nothing is kept once it
// settles, so the next caller always gets a fresh answer.
export const shareInFlight = <T>(
  pending: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>
): Promise<T> => {
  const existing = pending.get(key);
  if (existing) return existing;
  const request = start().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
};
