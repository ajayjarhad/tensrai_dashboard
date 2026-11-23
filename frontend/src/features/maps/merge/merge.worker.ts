import type { MapYaml } from '@tensrai/shared';
import type { Grid } from '../editor/grid';
import { type MergeLayer, mergeGrids } from './merge';

export type MergeRequest = { layers: MergeLayer[]; resolution: number };
export type MergeResponse = { grid?: Grid; yaml?: MapYaml; error?: string };

// The DOM lib types self as a window; in this file it is the worker's own scope.
const ctx = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<MergeRequest>) => {
  try {
    const { grid, yaml } = mergeGrids(event.data.layers, event.data.resolution);
    ctx.postMessage({ grid, yaml } satisfies MergeResponse, [grid.data.buffer]);
  } catch (error) {
    ctx.postMessage({
      error: error instanceof Error ? error.message : 'The merge failed.',
    } satisfies MergeResponse);
  }
};
