/**
 * Live status events emitted by the AI pipeline so loading screens can show
 * what is actually happening (instead of pre-scripted flavour text).
 *
 * Events with the same `id` update one loader row: emit `status: 'active'`
 * when a stage starts (re-emit with a new `detail` as it progresses — e.g. a
 * live dish count while the menu read streams in) and `status: 'done'` when
 * it finishes.
 */
export type ProgressEvent = {
  /** Stable step id — events with the same id update one loader row. */
  id: string;
  /** Emoji shown next to the step. */
  icon: string;
  label: string;
  /** Short live detail, e.g. "23 dishes spotted". */
  detail?: string;
  status: 'active' | 'done';
};

export type OnProgress = (event: ProgressEvent) => void;
