const CATCH_UP_SECONDS = 0.42;
const MAX_PROGRESS_PER_SECOND = 0.42;
const MAX_FRAME_SECONDS = 1 / 30;
const WRITING_SCROLL_VIEWPORTS = 1.2;
const ARRIVAL_SCROLL_VIEWPORTS = 0.032;
const SETTLED = 0.0001;

export function handwritingTarget(top: number, stageHeight: number): number {
  return Math.max(
    0,
    Math.min(
      1,
      (-top / Math.max(1, stageHeight) - ARRIVAL_SCROLL_VIEWPORTS) / WRITING_SCROLL_VIEWPORTS
    )
  );
}

export function handwritingStep(progress: number, target: number, elapsed: number): number {
  const seconds = Math.max(0, Math.min(MAX_FRAME_SECONDS, elapsed));
  const remaining = target - progress;
  const step = Math.min(
    Math.abs(remaining) * (1 - Math.exp(-seconds / CATCH_UP_SECONDS)),
    MAX_PROGRESS_PER_SECOND * seconds
  );
  const next = progress + Math.sign(remaining) * step;
  return Math.abs(target - next) < SETTLED ? target : next;
}
