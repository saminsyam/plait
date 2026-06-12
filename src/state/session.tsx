/**
 * Single-user in-memory session for one menu scan, modeled as the AI-waiter's
 * working state. A fresh scan overwrites the last.
 *
 * Flow: camera → setScan (menu + orientation + gated candidate pool) → picks.
 * The picks screen holds TWO independent, cached result sets for the same scan:
 *
 *   • Popular — ranked off dietary profile + online crowd reviews, no questions.
 *   • Custom  — ranked through the refine narrowing flow (recorded Q/A).
 *
 * Generating Custom never overwrites Popular, so the user can switch back and
 * forth between them for free (no re-ranking). The deterministic hard-gate runs
 * ONCE at scan time: blocked items never enter `candidates`, and `verifyById`
 * carries the "ask staff" reasons for the verify survivors.
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
  /** Chosen spice tolerance (1 mild · 2 medium · 3 hot), or null before it's set. */
  spice: number | null;
  /** Whole-menu footer/header notes (mirrors menuContext.restaurant_notes). */
  restaurantNotes: string[];

  // ── Popular result: dietary profile + online crowd reviews, no questions.
  popularPicks: Pick[];
  /** True once a Popular ranking has completed for this scan. */
  popularReady: boolean;

  // ── Custom result: the refine narrowing flow's ranked picks + its Q/A.
  customPicks: Pick[];
  customQuestions: Question[];
  customAnswers: Answers;
  /** True once a Custom ranking exists (the toggle reveals the Custom view). */
  customReady: boolean;
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
  /** Record the Popular ranking (dietary + reviews). */
  setPopular: (input: { spice: number; picks: Pick[] }) => void;
  /** Record the Custom ranking (refine flow) without touching Popular. */
  setCustom: (input: {
    questions: Question[];
    answers: Answers;
    spice: number;
    picks: Pick[];
  }) => void;
  reset: () => void;
};

const EMPTY: SessionState = {
  imageUri: null,
  items: [],
  menuContext: null,
  candidates: [],
  verifyById: {},
  blocked: [],
  spice: null,
  restaurantNotes: [],
  popularPicks: [],
  popularReady: false,
  customPicks: [],
  customQuestions: [],
  customAnswers: {},
  customReady: false,
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
  const setPopular = useCallback<SessionValue['setPopular']>(
    ({ spice, picks }) =>
      setState((s) => ({ ...s, spice, popularPicks: picks, popularReady: true })),
    []
  );
  const setCustom = useCallback<SessionValue['setCustom']>(
    ({ questions, answers, spice, picks }) =>
      setState((s) => ({
        ...s,
        spice,
        customQuestions: questions,
        customAnswers: answers,
        customPicks: picks,
        customReady: true,
      })),
    []
  );
  const reset = useCallback(() => setState(EMPTY), []);

  const value = useMemo<SessionValue>(
    () => ({ ...state, setScan, setPopular, setCustom, reset }),
    [state, setScan, setPopular, setCustom, reset]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
