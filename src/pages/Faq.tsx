import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, Search } from 'lucide-react';
import { Card, Empty, PageHeader } from '../components/ui';
import { RichText } from '../components/RichText';
import { FAQ_GROUPS, findFaqQuestion, searchFaq, type FaqBlock, type FaqQuestion } from '../lib/faq';

function Block({ block }: { block: FaqBlock }) {
  if (typeof block === 'string') return <p><RichText text={block} /></p>;
  if ('steps' in block) return <ol>{block.steps.map((step, index) => <li key={index}><RichText text={step} /></li>)}</ol>;
  return <ul>{block.points.map((point, index) => <li key={index}><RichText text={point} /></li>)}</ul>;
}

export default function Faq() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // The question or group to scroll to once it is on the page.
  const [target, setTarget] = useState<string | null>(null);
  const groups = useMemo(() => searchFaq(FAQ_GROUPS, search), [search]);
  const matchCount = groups.reduce((total, group) => total + group.questions.length, 0);
  const location = useLocation();
  // A page's Help button arrives with the question to open.
  const linkedQuestion = (location.state as { question?: string } | null)?.question;

  useEffect(() => {
    const question = linkedQuestion ? findFaqQuestion(linkedQuestion) : undefined;
    if (question) goTo(question.id, question);
  }, [linkedQuestion, location.key]);

  useEffect(() => {
    if (!target) return;
    const element = document.getElementById(`faq-${target}`);
    element?.scrollIntoView?.({ block: 'start' });
    (element?.querySelector('summary') ?? element)?.focus();
    setTarget(null);
  }, [target]);

  function setQuestionOpen(id: string, isOpen: boolean) {
    setOpen((current) => {
      if (current.has(id) === isOpen) return current;
      const next = new Set(current);
      if (isOpen) next.add(id); else next.delete(id);
      return next;
    });
  }

  function goTo(id: string, question?: FaqQuestion) {
    setSearch('');
    if (question) setQuestionOpen(question.id, true);
    setTarget(id);
  }

  return <div className="page">
    <PageHeader title="FAQ" description="Answers to common questions about using myLFR." />
    <Card className="faq-toolbar">
      <div className="search-box">
        <Search size={18} />
        <input aria-label="Search the FAQ" placeholder="Search, for example backup or scallops" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {search.trim()
        ? <p className="muted">{matchCount} {matchCount === 1 ? 'question' : 'questions'} found.</p>
        : <nav className="faq-contents" aria-label="FAQ topics">{FAQ_GROUPS.map((group) => <button key={group.id} type="button" className="faq-topic" onClick={() => goTo(group.id)}>{group.title}</button>)}</nav>}
    </Card>
    {!groups.length ? <Empty>No questions match that search. Try a different word, such as landing, backup or return.</Empty> : groups.map((group) => <section className="faq-group" key={group.id} id={`faq-${group.id}`} tabIndex={-1} aria-labelledby={`faq-${group.id}-title`}>
      <div className="faq-group-heading"><h2 id={`faq-${group.id}-title`}>{group.title}</h2><p className="muted">{group.summary}</p></div>
      {group.questions.map((question) => <Card className="faq-question" key={question.id} id={`faq-${question.id}`}>
        <details open={open.has(question.id)} onToggle={(event) => setQuestionOpen(question.id, event.currentTarget.open)}>
          <summary><span>{question.question}</span><ChevronDown size={18} aria-hidden="true" /></summary>
          <div className="faq-answer">
            {question.answer.map((block, index) => <Block key={index} block={block} />)}
            {question.seeAlso?.length ? <div className="faq-see-also"><span className="muted">See also:</span>{question.seeAlso.map((id) => {
              const related = findFaqQuestion(id);
              return related ? <button key={id} type="button" className="faq-link" onClick={() => goTo(id, related)}>{related.question}</button> : null;
            })}</div> : null}
          </div>
        </details>
      </Card>)}
    </section>)}
  </div>;
}
