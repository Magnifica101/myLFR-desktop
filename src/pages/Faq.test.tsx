import { render as renderWithoutRouter, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { FAQ_GROUPS, findFaqQuestion, searchFaq } from '../lib/faq';
import Faq from './Faq';

// Pages render a Help button that navigates, so they need a router.
const render = (ui: Parameters<typeof renderWithoutRouter>[0], options?: Parameters<typeof renderWithoutRouter>[1]) => renderWithoutRouter(ui, { wrapper: MemoryRouter, ...options });

const questions = FAQ_GROUPS.flatMap((group) => group.questions);

describe('FAQ content', () => {
  it('is organised by when the receiver needs it', () => {
    expect(FAQ_GROUPS.map((group) => group.title)).toEqual([
      'Before you start',
      'Every landing',
      'Return day (the 15th)',
      'New fishing year',
      'Keeping records safe',
      'When something goes wrong',
    ]);
  });

  it('gives every question a unique id and links only to questions that exist', () => {
    const ids = [...FAQ_GROUPS.map((group) => group.id), ...questions.map((question) => question.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const question of questions) {
      for (const id of question.seeAlso ?? []) {
        expect(findFaqQuestion(id), `${question.id} links to ${id}`).toBeDefined();
        expect(id).not.toBe(question.id);
      }
    }
  });

  it('closes every bold marker it opens', () => {
    for (const question of questions) {
      const text = JSON.stringify(question.answer);
      expect((text.match(/\*\*/g) ?? []).length % 2, question.id).toBe(0);
    }
  });

  it('finds questions containing every searched word, in any case, ignoring bold markers', () => {
    const found = searchFaq(FAQ_GROUPS, 'RESTORE backup').flatMap((group) => group.questions.map((question) => question.id));
    expect(found).toContain('restore');
    expect(found).not.toContain('record-landing');
    expect(searchFaq(FAQ_GROUPS, 'Record a landing').flatMap((group) => group.questions).length).toBeGreaterThan(0);
    expect(searchFaq(FAQ_GROUPS, 'zzzz')).toEqual([]);
    expect(searchFaq(FAQ_GROUPS, '   ')).toBe(FAQ_GROUPS);
  });
});

describe('FAQ page', () => {
  it('shows every group with its questions closed', () => {
    render(<Faq />);

    for (const group of FAQ_GROUPS) expect(screen.getByRole('heading', { level: 2, name: group.title })).toBeInTheDocument();
    expect(screen.getByText('How do I record a landing?').closest('details')).not.toHaveAttribute('open');
  });

  it('opens a question to show its answer, with button names in bold', async () => {
    const user = userEvent.setup();
    render(<Faq />);

    await user.click(screen.getByText('How do I record a landing?'));

    const details = screen.getByText('How do I record a landing?').closest('details')!;
    expect(details).toHaveAttribute('open');
    expect(details.querySelector('strong')?.textContent).toBe('Landings');
  });

  it('narrows the questions as the receiver searches, and says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Faq />);

    await user.type(screen.getByRole('textbox', { name: 'Search the FAQ' }), 'uninstall');
    expect(screen.getByText('How do I uninstall myLFR?')).toBeInTheDocument();
    expect(screen.queryByText('How do I record a landing?')).not.toBeInTheDocument();
    expect(screen.getByText(/questions? found\./)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search the FAQ' }), ' zzzz');
    expect(screen.getByText(/No questions match that search/)).toBeInTheDocument();
  });

  it('follows a see-also link to the related question, clearing the search and opening it', async () => {
    const user = userEvent.setup();
    render(<Faq />);

    await user.type(screen.getByRole('textbox', { name: 'Search the FAQ' }), 'move myLFR to a new computer');
    await user.click(screen.getByText('How do I move myLFR to a new computer?'));
    await user.click(screen.getByRole('button', { name: 'Where do I get myLFR, and how do I install it?' }));

    expect(screen.getByRole('textbox', { name: 'Search the FAQ' })).toHaveValue('');
    const summary = screen.getByText('Where do I get myLFR, and how do I install it?', { selector: 'summary span' }).closest('summary')!;
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(summary).toHaveFocus();
  });
});
