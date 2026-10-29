// src/app/state.ts
// Main-thread state machine (design §3.5). Pure reducer; the worker lifecycle that feeds it lives in hooks/useCasParser.

import type { DocumentType, ParseError, ParseResult, ParseWarning } from '../engine';

/** The engine's ParseError plus the one failure decided purely on the main thread: the reader chunk did not load (§7.3). */
export type UiError = ParseError | { code: 'OFFLINE'; message: string };

export type Source = 'user' | 'sample';

export type AppState =
  | { phase: 'landing' }
  | { phase: 'loading-engine'; source: Source }
  | { phase: 'needs-password'; requestId: string; attempt: number; reason: 'required' | 'incorrect'; source: Source; submitting: boolean }
  | { phase: 'parsing'; requestId: string; page: number; pageCount: number; stage: 'extract' | 'parse'; documentType?: DocumentType; liveWarnings: ParseWarning[]; source: Source }
  | { phase: 'rejected'; error: UiError; source: Source }
  | { phase: 'dashboard'; result: ParseResult; source: Source }
  | { phase: 'unsupported-browser' };

export type Action =
  | { type: 'LOADING_ENGINE'; source: Source }
  | { type: 'NEEDS_PASSWORD'; requestId: string; attempt: number; reason: 'required' | 'incorrect' }
  | { type: 'PASSWORD_SUBMITTED' }
  | { type: 'OPENED'; requestId: string; pageCount: number }
  | { type: 'PROGRESS'; page: number; pageCount: number; stage: 'extract' | 'parse' }
  | { type: 'DETECTED'; documentType: DocumentType }
  | { type: 'LIVE_WARNING'; warning: ParseWarning }
  | { type: 'RESULT'; result: ParseResult }
  | { type: 'REJECTED'; error: UiError; source?: Source }
  | { type: 'RESET' }
  | { type: 'UNSUPPORTED_BROWSER' };

export const initialState: AppState = { phase: 'landing' };

function sourceOf(state: AppState): Source {
  return 'source' in state ? state.source : 'user';
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOADING_ENGINE':
      return { phase: 'loading-engine', source: action.source };
    case 'NEEDS_PASSWORD':
      return { phase: 'needs-password', requestId: action.requestId, attempt: action.attempt, reason: action.reason, source: sourceOf(state), submitting: false };
    case 'PASSWORD_SUBMITTED':
      return state.phase === 'needs-password' ? { ...state, submitting: true } : state;
    case 'OPENED':
      return { phase: 'parsing', requestId: action.requestId, page: 0, pageCount: action.pageCount, stage: 'extract', liveWarnings: [], source: sourceOf(state) };
    case 'PROGRESS':
      return state.phase === 'parsing' ? { ...state, page: action.page, pageCount: action.pageCount, stage: action.stage } : state;
    case 'DETECTED':
      return state.phase === 'parsing' ? { ...state, documentType: action.documentType } : state;
    case 'LIVE_WARNING':
      if (state.phase !== 'parsing') return state;
      if (state.liveWarnings.some((w) => w.id === action.warning.id)) return state;
      return { ...state, liveWarnings: [...state.liveWarnings, action.warning] };
    case 'RESULT':
      return { phase: 'dashboard', result: action.result, source: sourceOf(state) };
    case 'REJECTED':
      if (action.error.code === 'CANCELLED') return initialState;
      return { phase: 'rejected', error: action.error, source: action.source ?? sourceOf(state) };
    case 'RESET':
      return initialState;
    case 'UNSUPPORTED_BROWSER':
      return { phase: 'unsupported-browser' };
    default:
      return state;
  }
}
