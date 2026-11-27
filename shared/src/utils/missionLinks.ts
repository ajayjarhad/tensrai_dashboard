const stemOf = (filename: string) => filename.trim().replace(/\.ya?ml$/i, '');

// A robot copies another map's missions into a map's metadata, naming the map they belong to in
// `metadataFile`. Such a copy runs on that map, so it isn't one of this map's missions.
export const isMissionFromOtherMap = (
  mission: Record<string, unknown>,
  ownFilenames: ReadonlyArray<string | null | undefined>
) => {
  const file = mission['metadataFile'];
  if (typeof file !== 'string' || !file.trim()) return false;
  const own = ownFilenames.filter((name): name is string => Boolean(name)).map(stemOf);
  return own.length > 0 && !own.includes(stemOf(file));
};
