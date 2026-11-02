import { useEffect, useId, useRef } from 'react';
import type { FormEventHandler, ReactNode } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  busy?: boolean;
  wide?: boolean;
}

export function Dialog({ title, description, children, footer, onClose, onSubmit, busy = false, wide = false }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    if (!dialog) return;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const content = <>
    <div className="cq-dialog-body">{children}</div>
    {footer && <div className="cq-dialog-footer">{footer}</div>}
  </>;

  return <dialog ref={ref} className={`cq-dialog${wide ? ' cq-dialog-wide' : ''}`}
    aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="cq-dialog-header">
      <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <button type="button" onClick={onClose} disabled={busy} className="cq-icon-button" aria-label={`Close ${title}`}><X size={19} /></button>
    </div>
    {onSubmit ? <form onSubmit={onSubmit} className="cq-dialog-content">{content}</form> : <div className="cq-dialog-content">{content}</div>}
  </dialog>;
}
