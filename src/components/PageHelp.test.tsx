import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { findFaqQuestion } from '../lib/faq';
import { PAGE_HELP } from '../lib/pageHelp';
import Faq from '../pages/Faq';
import { PageHelp } from './PageHelp';

it('lists only questions that exist in the FAQ for every page', () => {
  for (const [page, ids] of Object.entries(PAGE_HELP)) {
    expect(ids.length, page).toBeGreaterThan(0);
    for (const id of ids) expect(findFaqQuestion(id), `${page}: ${id}`).toBeDefined();
  }
});

it("lists a page's questions and opens the chosen answer in the FAQ", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/landings']}><Routes>
    <Route path="/landings" element={<PageHelp page="landings" />} />
    <Route path="/faq" element={<Faq />} />
  </Routes></MemoryRouter>);

  const toggle = screen.getByRole('button', { name: 'Help' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  const panel = screen.getByRole('region', { name: 'Help with this page' });
  expect(within(panel).getAllByRole('listitem')).toHaveLength(PAGE_HELP.landings.length);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('region', { name: 'Help with this page' })).not.toBeInTheDocument();
  expect(toggle).toHaveFocus();

  await user.click(toggle);
  const question = findFaqQuestion('delete-landing')!;
  await user.click(screen.getByRole('button', { name: question.question }));
  const answer = document.getElementById('faq-delete-landing')!;
  expect(answer.querySelector('details')).toHaveAttribute('open');
  expect(document.querySelectorAll('.faq-question details[open]')).toHaveLength(1);
});
