import type { MapFeatures, MapYaml } from '@tensrai/shared';
import { load } from 'js-yaml';
import { parsePGM } from '@/lib/map/pgm-parser';
import type { Grid } from '../editor/grid';

const isOrigin = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

// A map saved by mapping tools, chosen as files: its image, its YAML and, if there is one, the
// robot's metadata.json with tags and missions.
export const readLocalMap = async (files: File[]) => {
  const pgm = files.find(file => /\.pgm$/i.test(file.name));
  const yamlFile = files.find(file => /\.ya?ml$/i.test(file.name));
  const json = files.find(file => /\.json$/i.test(file.name));
  if (!pgm || !yamlFile) throw new Error('Choose a map image (.pgm) and its settings (.yaml).');
  const parsedYaml = load(await yamlFile.text()) as Partial<MapYaml> | null;
  if (!parsedYaml || !(Number(parsedYaml.resolution) > 0) || !isOrigin(parsedYaml.origin)) {
    throw new Error(`${yamlFile.name} needs a resolution and an origin.`);
  }
  const image = parsePGM(await pgm.arrayBuffer());
  const grid: Grid = {
    width: image.width,
    height: image.height,
    maxVal: image.maxVal,
    data: new Uint8Array(image.data),
  };
  const features = json ? (JSON.parse(await json.text()) as MapFeatures) : {};
  return {
    name: yamlFile.name.replace(/\.ya?ml$/i, ''),
    grid,
    yaml: parsedYaml as MapYaml,
    features,
  };
};
