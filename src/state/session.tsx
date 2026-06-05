/**
 * Single-user in-memory session for one menu scan. No persistence — a fresh
 * scan overwrites the last. Holds everything the screens hand off to each other.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { Answers, MenuItem, Pick, Question } from '@/lib/types';

type SessionState = {
  imageUri: string | null;
  items: MenuItem[];
  questions: Question[];
  answers: Answers;
  picks: Pick[];
};

type SessionValue = SessionState & {
  setScan: (input: { imageUri: string; items: MenuItem[]; questions: Question[] }) => void;
  setAnswers: (answers: Answers) => void;
  setPicks: (picks: Pick[]) => void;
  reset: () => void;
};

const EMPTY: SessionState = {
  imageUri: null,
  items: [],
  questions: [],
  answers: {},
  picks: [],
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(EMPTY);

  const value = useMemo<SessionValue>(
    () => ({
      ...state,
      setScan: ({ imageUri, items, questions }) =>
        setState({ imageUri, items, questions, answers: {}, picks: [] }),
      setAnswers: (answers) => setState((s) => ({ ...s, answers })),
      setPicks: (picks) => setState((s) => ({ ...s, picks })),
      reset: () => setState(EMPTY),
    }),
    [state]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
