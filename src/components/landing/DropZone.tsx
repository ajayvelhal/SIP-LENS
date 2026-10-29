// DropZone (UI design component 4, §8.2): the whole zone is a drop target; the accessible path is the "Choose file"
// label over a visually hidden file input. `disabled` while the reader loads shows the indeterminate ProgressBar.
import { useId, useRef, useState, type DragEvent } from 'react';
import { buttonClass } from '../ui/Button';
import { Glyph } from '../ui/Glyph';
import { LinkButton } from '../ui/Link';
import { ProgressBar } from '../ui/ProgressBar';

interface Props {
  onFiles: (files: ArrayLike<File>) => void;
  onSample: () => void;
  loading: boolean;
  describedBy: string;
}

export function DropZone({ onFiles, onSample, loading, describedBy }: Props) {
  const [over, setOver] = useState(false);
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (loading) return;
    depth.current++;
    if ([...e.dataTransfer.types].includes('Files')) setOver(true);
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (loading) return;
    if (e.dataTransfer.files.length > 0) onFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      aria-describedby={describedBy}
      aria-disabled={loading || undefined}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex min-h-[200px] flex-col items-center justify-center rounded-lg border-2 p-6 text-center transition-colors duration-fast lg:min-h-[260px] ${
        over ? 'border-solid border-accent bg-info-bg' : 'border-dashed border-border-strong bg-sunken'
      } ${loading ? 'opacity-60' : ''}`}
    >
      <Glyph name="document" size={24} className="text-ink-3" />
      <h2 id={headingId} className="mt-3 text-h3 text-ink-1">Drop your CAS PDF here</h2>
      {loading ? (
        <div className="mt-4 w-full max-w-xs">
          <ProgressBar valueText="Loading the reader" label="Loading the reader" />
          <p className="mt-2 text-small text-ink-2">Loading the reader…</p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-body text-ink-2">or</p>
          <label className={buttonClass('primary', false, 'mt-3 min-w-[160px] cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent')}>
            Choose file
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                // FileList is live and empties when the input is reset, so hand over a copy.
                const picked = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                if (picked.length > 0) onFiles(picked);
              }}
            />
          </label>
          <LinkButton onClick={onSample} className="mt-4 text-body">Try with a sample CAS</LinkButton>
        </>
      )}
    </div>
  );
}
