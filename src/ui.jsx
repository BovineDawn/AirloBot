import React, { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import { Bot, Loader2, X } from 'lucide-react';

export const api = window.airlo;
export const formatBytes = n => n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(1) + ' MB';
export function Robot({ size = 30 }) { return <span className="robot" style={{ width: size, height: size }} aria-hidden="true"><Bot size={Math.round(size * .66)} strokeWidth={1.7}/></span>; }
export function Spinner() { return <Loader2 className="spin" size={16} aria-hidden="true"/>; }
export function RichText({ children }) { return <div className="markdown"><Markdown components={{ a: ({ children }) => <span className="text-link">{children}</span>, img: () => null }}>{children || ''}</Markdown></div>; }
export function Empty({ title, children, icon: Icon = Bot }) { return <div className="empty-state"><Icon size={28}/><h2>{title}</h2><p>{children}</p></div>; }
export function Modal({ title, children, onClose, className = '' }) {
  const ref = useRef(null), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement;
    dialog.showModal();
    const cancel = e => { e.preventDefault(); close.current(); };
    dialog.addEventListener('cancel', cancel);
    return () => { dialog.removeEventListener('cancel', cancel); dialog.close(); previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} className={'dialog ' + className} aria-label={title} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="dialog-head"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={'Close ' + title}><X size={18}/></button></div>{children}</dialog>;
}
export function Toggle({ label, checked, disabled, onChange }) { return <button type="button" className="switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span/></button>; }
export const shortModelName = model => (model?.display_name || model?.key || 'Choose a model').replace(/[-_]/g, ' ');
