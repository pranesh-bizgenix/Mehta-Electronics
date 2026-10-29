'use client';

import { useId, useState, type DragEvent } from 'react';
import { Icon } from './icons';

export interface DroppedFile { name: string; base64: string; size: number; type: string }

const readBase64 = (file: File, onProgress: (pct: number) => void) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
  reader.onerror = () => reject(new Error('The file could not be read.'));
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.readAsDataURL(file);
});

/**
 * Drag-and-drop or click to choose. Checks type and size in the browser for
 * fast feedback; the server re-validates content signature and size.
 */
export function FileDrop({ accept = '.pdf,.png,.jpg,.jpeg', maxBytes = 10 * 1024 * 1024, label = 'Drop the original here or choose a file', hint = 'PDF, PNG or JPEG up to 10 MB', onFile, disabled }: {
  accept?: string; maxBytes?: number; label?: string; hint?: string; onFile: (file: DroppedFile) => Promise<void> | void; disabled?: boolean;
}) {
  const id = useId();
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [name, setName] = useState<string>();

  const take = async (file: File | undefined) => {
    if (!file || disabled) return;
    setError(undefined);
    const allowed = accept.split(',').map((a) => a.trim().toLowerCase());
    if (!allowed.some((a) => file.name.toLowerCase().endsWith(a))) { setError(`That file type is not accepted. Use ${hint}.`); return; }
    if (file.size > maxBytes) { setError(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${(maxBytes / 1048576).toFixed(0)} MB.`); return; }
    setName(file.name); setProgress(0);
    try {
      const base64 = await readBase64(file, setProgress);
      setProgress(100);
      await onFile({ name: file.name, base64, size: file.size, type: file.type });
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setTimeout(() => setProgress(null), 600); }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setActive(false); void take(e.dataTransfer.files[0]); };

  return (
    <div className="stack-sm">
      <label htmlFor={id} className="ds-drop" data-active={active || undefined} onDragOver={(e) => { e.preventDefault(); setActive(true); }} onDragLeave={() => setActive(false)} onDrop={onDrop}>
        <Icon name="upload" />
        <strong>{label}</strong>
        <span className="subtle">{hint}</span>
        <input id={id} type="file" accept={accept} className="sr-only" disabled={disabled} onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {progress !== null && <div className="stack-sm" aria-live="polite"><span className="ds-cell-secondary truncate">{name}</span><div className="ds-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress"><span style={{ width: `${progress}%` }} /></div></div>}
      {error && <p className="ds-field-error" role="alert"><Icon name="alert" />{error}</p>}
    </div>
  );
}
