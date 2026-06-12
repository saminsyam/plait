/**
 * Single-user in-memory session for one menu scan, modeled as the AI-waiter's
 * working state. A fresh scan overwrites the last.
 *
 * Flow: camera → setScan (menu + orientation + gated candidate pool) →
 * orientation screen → narrowing (engine filters `candidates`) → setOutcome
 * (recorded questions/answers + ranked picks) → results.
 *
 * The deterministic hard-gate runs ONCE at scan time: blocked items never enter
 * `candidates`, and `verifyById` carries the "ask staff" reasons for the verify
 * survivors so reasoning can flag them.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { FilteredItem } from '@/engine/dietaryFilter';
import type { Answers, MenuItem, Pick, Question, VisionMenuContext } from '@/engine/types';

type SessionState = {
  imageUri: string | null;
  /** Every dish read from the menu (full enriched model). */
  items: MenuItem[];
  /** Cuisine + Stage-1 orientation + restaurant notes. */
  menuContext: VisionMenuContext | null;
  /** Safe-to-recommend pool the narrowing engine works on (allowed + verify). */
  candidates: MenuItem[];
  /** item_id → "verify with staff" reasons for verify survivors. */
  verifyById: Record<string, string[]>;
  /** Items the hard-gate removed before ranking, with reasons (the avoid list). */
  blocked: FilteredItem[];
  /** Narrowing questions actually asked + the user's answers (for reasoning/detail). */
  questions: Question[];
  answers: Answers;
  /** Chosen spice tolerance (1 mild · 2 medium · 3 hot), or null before it's set. */
  spice: number | null;
  picks: Pick[];
  /** Whole-menu footer/header notes (mirrors menuContext.restaurant_notes). */
  restaurantNotes: string[];
  /**
   * item_id → crowd-favorite dish name, matched on-device from cached/fetched
   * web reviews. Purely additive flavor: feeds ONE context line into the
   * ranking call and badges the crowd-favorites tile. Never affects the gate.
   */
  crowdFavorites: Record<string, string>;
  /**
   * Where the current picks came from: 'instant' (ranked straight off the
   * scan, no questions) or 'refined' (through the narrowing flow). Null until
   * a ranking has run for this scan.
   */
  picksSource: 'instant' | 'refined' | null;
};

type SessionValue = SessionState & {
  setScan: (input: {
    imageUri: string;
    items: MenuItem[];
    menuContext: VisionMenuContext;
    candidates: MenuItem[];
    verifyById: Record<string, string[]>;
    blocked: FilteredItem[];
  }) => void;
  /** Record a ranking outcome (instant or refined) — questions/answers may be empty. */
  setOutcome: (input: {
    questions: Question[];
    answers: Answers;
    spice: number;
    picks: Pick[];
    source: 'instant' | 'refined';
  }) => void;
  /** Record the review-matched crowd favorites for this scan (itemId → name). */
  setCrowdFavorites: (map: Record<string, string>) => void;
  reset: () => void;
};

const EMPTY: SessionState = {
  imageUri: null,
  items: [],
  menuContext: null,
  candidates: [],
  verifyById: {},
  blocked: [],
  questions: [],
  answers: {},
  spice: null,
  picks: [],
  restaurantNotes: [],
  crowdFavorites: {},
  picksSource: null,
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(EMPTY);

  // Stable setter identities (functional setState only) so screens can list
  // them in effect deps without re-running on every session change.
  const setScan = useCallback<SessionValue['setScan']>(
    ({ imageUri, items, menuContext, candidates, verifyById, blocked }) =>
      setState({
        ...EMPTY,
        imageUri,
        items,
        menuContext,
        candidates,
        verifyById,
        blocked,
        restaurantNotes: menuContext.restaurant_notes,
      }),
    []
  );
  const setOutcome = useCallback<SessionValue['setOutcome']>(
    ({ questions, answers, spice, picks, source }) =>
      setState((s) => ({ ...s, questions, answers, spice, picks, picksSource: source })),
    []
  );
  const setCrowdFavorites = useCallback<SessionValue['setCrowdFavorites']>(
    (map) => setState((s) => ({ ...s, crowdFavorites: map })),
    []
  );
  const reset = useCallback(() => setState(EMPTY), []);

  const value = useMemo<SessionValue>(
    () => ({ ...state, setScan, setOutcome, setCrowdFavorites, reset }),
    [state, setScan, setOutcome, setCrowdFavorites, reset]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
