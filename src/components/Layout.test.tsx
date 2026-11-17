import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '../styles.css';
import { Layout } from './Layout';

function renderLayout() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<div>Page content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts expanded when no preference is stored', () => {
    renderLayout();

    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Home' })).toBeVisible();
  });

  it('links to the FAQ page from the navigation', () => {
    renderLayout();

    expect(screen.getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/faq');
  });

  it('collapses and expands the navigation with the toggle', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    const openSidebarButton = screen.getByRole('button', { name: 'Open sidebar' });
    expect(openSidebarButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    await user.hover(openSidebarButton);
    expect(screen.getByRole('tooltip', { name: 'Open sidebar' })).toBeVisible();

    await user.click(openSidebarButton);
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Home' })).toBeVisible();
  });

  it('honours the stored preference after a remount', async () => {
    const user = userEvent.setup();
    const firstRender = renderLayout();

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    firstRender.unmount();
    renderLayout();

    expect(screen.getByRole('button', { name: 'Open sidebar' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });
});
