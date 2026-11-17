import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleHelp } from 'lucide-react';
import { findFaqQuestion } from '../lib/faq';
import { PAGE_HELP, type HelpPage } from '../lib/pageHelp';

/** A page heading's Help button: lists that page's FAQ questions and opens the chosen answer. */
export function PageHelp({ page }: { page: HelpPage }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const questions = PAGE_HELP[page].map((id) => findFaqQuestion(id)).filter((question) => !!question);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return <div className="page-help" ref={container}>
    <button ref={toggle} type="button" className="button button-secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}><CircleHelp size={17} aria-hidden="true" /> Help</button>
    {open ? <div className="card page-help-panel" id={panelId} role="region" aria-label="Help with this page">
      <h2>Help with this page</h2>
      <ul>{questions.map((question) => <li key={question.id}><button type="button" className="faq-link" onClick={() => navigate('/faq', { state: { question: question.id } })}>{question.question}</button></li>)}</ul>
      <button type="button" className="faq-link page-help-all" onClick={() => navigate('/faq')}>See all questions in the FAQ</button>
    </div> : null}
  </div>;
}
