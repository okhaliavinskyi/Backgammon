import { chooseTurn, type AiLevel, type MatchState } from '@nardy/core';

self.onmessage = (e: MessageEvent<{ id: number; match: MatchState; level: AiLevel }>) => {
  const { id, match, level } = e.data;
  const steps = chooseTurn(match, level);
  (self as unknown as Worker).postMessage({ id, steps });
};
