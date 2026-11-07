export const isMissionActivePhase = (phase: string | undefined) =>
  phase === 'running' || phase === 'paused' || phase === 'showing' || phase === 'start_pending';

export const isPreviewLikePhase = (phase: string | undefined) =>
  phase === 'preview_pending' || phase === 'showing' || phase === 'start_pending';
