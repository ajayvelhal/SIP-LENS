// S2 Password prompt (UI design §4.2, component 6). The value lives only in this component's state and is cleared
// on submit; nothing here persists or logs it.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { announce } from '../../lib/announce';
import { Button } from '../ui/Button';
import { Glyph } from '../ui/Glyph';
import { LinkButton } from '../ui/Link';

interface Props {
  reason: 'required' | 'incorrect';
  attempt: number;
  submitting: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

const WRONG = "That password didn't open the file";

export function PasswordPrompt({ reason, attempt, submitting, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (reason === 'incorrect') {
      announce(WRONG, 'assertive');
      const el = inputRef.current;
      el?.focus();
      el?.select();
    }
  }, [reason, attempt]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value || submitting) return;
    onSubmit(value);
    setValue('');
  };

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 pt-8 md:px-6">
      <form onSubmit={submit} className="rounded-lg border border-border bg-surface p-6" autoComplete="off">
        <Glyph name="lock" size={32} className="text-ink-3" />
        <h1 className="mt-3 text-h2 text-ink-1">This PDF is password-protected</h1>
        <label htmlFor={id} className="mt-5 block text-small text-ink-2">Password for this PDF</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            ref={inputRef}
            id={id}
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={reason === 'incorrect' || undefined}
            aria-describedby={reason === 'incorrect' ? errorId : hintId}
            className={`num min-h-tap w-full min-w-0 flex-1 rounded-sm border bg-surface px-3 text-body text-ink-1 ${reason === 'incorrect' ? 'border-loss' : 'border-border-strong'}`}
          />
          <Button variant="ghost" sm aria-pressed={show} onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</Button>
        </div>
        {reason === 'incorrect' ? (
          <p id={errorId} className="mt-2 flex items-start gap-1 text-small text-loss">
            <Glyph name="cross" size={16} className="mt-0.5" />
            <span>{WRONG}</span>
          </p>
        ) : (
          <p id={hintId} className="mt-2 text-small text-ink-3">CAS PDFs are usually protected with your PAN (in capitals) or the password you chose when requesting the statement.</p>
        )}
        <Button type="submit" className="mt-5 w-full md:w-auto" disabled={submitting || value.length === 0} aria-busy={submitting}>
          {submitting && <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent-ink border-t-transparent" />}
          {submitting ? 'Opening…' : 'Open statement'}
        </Button>
        <div className="mt-4">
          <LinkButton onClick={onCancel} sm>Try another file</LinkButton>
        </div>
        <p className="mt-6 flex items-start gap-1 text-caption text-ink-3">
          <Glyph name="lock" size={14} className="mt-px" />
          <span>It is checked in this tab and never stored.</span>
        </p>
      </form>
    </main>
  );
}
