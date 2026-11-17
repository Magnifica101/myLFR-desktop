import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { Button, Card, Empty, Loading, PageHeader, Status } from '../components/ui';
import { PageHelp } from '../components/PageHelp';
import { useToast } from '../components/ToastProvider';
import { desktop } from '../lib/desktop';
import { errorMessage, reportingUnitLabel } from '../lib/format';
import { FISHING_YEAR_OPTIONS, fishingYearLabel, type FishingYearStartMonth } from '../lib/fishingYear';
import type { Fishstock, ReportingUnit, UserFishstock } from '../lib/types';

const REPORTING_UNITS: ReportingUnit[] = ['greenweightKg', 'meatweightKg', 'count'];

interface StockDraft {
  /** The stock's current code when editing; absent when adding. */
  originalCode?: string;
  landingCount: number;
  originalYear?: FishingYearStartMonth;
  code: string;
  description: string;
  reportingUnit: ReportingUnit;
  fishingYearStartMonth: FishingYearStartMonth | '';
}

const newDraft = (): StockDraft => ({ landingCount: 0, code: '', description: '', reportingUnit: 'greenweightKg', fishingYearStartMonth: '' });

const landingsLabel = (count: number) => `${count} landing${count === 1 ? '' : 's'}`;

/** Existing stocks that look like the one being added: the same species letters, or a name sharing its first word. */
async function findSimilarStocks(code: string, description: string): Promise<Fishstock[]> {
  const species = code.match(/^[A-Z]+/)?.[0] ?? '';
  const firstWord = description.trim().split(/\s+/)[0] ?? '';
  const searches = [species.length >= 2 ? species : '', firstWord.length >= 3 ? firstWord : ''].filter(Boolean);
  const results = (await Promise.all(searches.map((term) => desktop.searchFishstocks(term, 10)))).flat();
  const unique = new Map(results.filter((stock) => stock.code !== code).map((stock) => [stock.code, stock]));
  return [...unique.values()].slice(0, 5);
}

export default function Species() {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<StockDraft | null>(null);
  const [similar, setSimilar] = useState<Fishstock[] | null>(null);
  const [formError, setFormError] = useState('');
  const searchTerm = query.trim();
  const toast = useToast();
  const queryClient = useQueryClient();
  const results = useQuery({
    queryKey: ['fishstock-search', searchTerm],
    queryFn: () => desktop.searchFishstocks(searchTerm, 100),
    enabled: searchTerm.length > 0,
    placeholderData: keepPreviousData,
  });
  const favorites = useQuery({ queryKey: ['favorite-fishstocks'], queryFn: desktop.listFavoriteFishstocks });
  const userStocks = useQuery({ queryKey: ['user-fishstocks'], queryFn: desktop.listUserFishstocks });
  const refresh = () => Promise.all(['fishstock-search', 'favorite-fishstocks', 'user-fishstocks', 'landings'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  const favorite = useMutation({
    mutationFn: ({ code, value }: { code: string; value: boolean }) => desktop.setFishstockFavorite(code, value),
    onSuccess: async () => { await refresh(); },
    onError: (caught) => toast.show(errorMessage(caught), 'error'),
  });
  const remove = useMutation({
    mutationFn: desktop.removeUserFishstock,
    onSuccess: async (_, code) => { toast.show(`${code} was removed.`, 'success'); await refresh(); },
    onError: (caught) => toast.show(errorMessage(caught), 'error'),
  });
  const rows = searchTerm ? results.data ?? [] : favorites.data ?? [];
  const resultTitle = searchTerm ? 'Search results' : 'Favourite fishstocks';
  const resultCount = `${rows.length} ${searchTerm ? 'matching ' : ''}fishstock${rows.length === 1 ? '' : 's'} ${searchTerm ? 'found' : 'saved'}.`;

  function openDraft(stock?: UserFishstock) {
    setFormError(''); setSimilar(null);
    setDraft(stock ? { originalCode: stock.code, landingCount: stock.landingCount, originalYear: stock.fishingYearStartMonth, code: stock.code, description: stock.description, reportingUnit: stock.reportingUnit, fishingYearStartMonth: stock.fishingYearStartMonth } : newDraft());
  }

  function closeDraft() { setDraft(null); setSimilar(null); setFormError(''); }

  async function save(event?: FormEvent, confirmedNotSimilar = false) {
    event?.preventDefault();
    if (!draft || draft.fishingYearStartMonth === '') return;
    setFormError('');
    const input = { code: draft.code, description: draft.description, reportingUnit: draft.reportingUnit, fishingYearStartMonth: draft.fishingYearStartMonth };
    try {
      if (draft.originalCode) {
        if (draft.landingCount > 0 && draft.fishingYearStartMonth !== draft.originalYear
          && !confirm(`Changing the fishing year moves the totals of ${landingsLabel(draft.landingCount)} into the other fishing year. If a return you have already filed included them, myLFR's figures will no longer match it. Change the fishing year?`)) return;
        await desktop.updateUserFishstock(draft.originalCode, input);
        toast.show(`${draft.code} was updated.`, 'success');
      } else {
        if (!confirmedNotSimilar) {
          const matches = await findSimilarStocks(draft.code, draft.description);
          if (matches.length) { setSimilar(matches); return; }
        }
        await desktop.addUserFishstock(input);
        toast.show(`${draft.code} was added.`, 'success');
      }
      closeDraft();
      await refresh();
    } catch (caught) { setSimilar(null); setFormError(errorMessage(caught)); }
  }

  function confirmRemove(stock: UserFishstock) {
    if (confirm(`Remove ${stock.code} (${stock.description})? This can't be undone.`)) remove.mutate(stock.code);
  }

  const locked = !!draft && draft.landingCount > 0;
  return <div className="page">
    <PageHeader title="Species and fishstocks" description="Save your regular fishstocks as favourites, and add new fishstocks that aren't in the list yet." actions={<PageHelp page="species" />} />
    <Card className="species-toolbar"><div className="species-toolbar-heading"><h2>Find a fishstock</h2><p className="muted">Search by code or description, or choose one of your favourites.</p></div><div className="search-box"><Search size={18} /><input aria-label="Search fishstocks" placeholder="Search by code or description" value={query} onChange={(event) => setQuery(event.target.value)} /></div></Card>
    {results.isError || favorites.isError ? <Status tone="error">{errorMessage(results.error ?? favorites.error)}</Status> : null}
    {!rows.length ? <Empty>{searchTerm ? 'No matching fishstocks.' : <>No favourites yet. Search the catalogue and select the <strong>star</strong>.</>}</Empty> : <Card><div className="split species-list-heading"><div><h2>{resultTitle}</h2><p className="muted">{resultCount}</p></div></div><div className="table-wrap"><table><thead><tr><th>Code</th><th>Description</th><th>Favourite</th></tr></thead><tbody>{rows.map((stock) => <tr key={stock.code}><td><strong>{stock.code}</strong>{stock.isUserAdded ? <> <span className="pill">Added by you</span></> : null}</td><td>{stock.description}</td><td><Button variant="ghost" aria-label={`${stock.isFavorite ? 'Remove' : 'Add'} ${stock.code} favourite`} onClick={() => favorite.mutate({ code: stock.code, value: !stock.isFavorite })}><Star size={17} fill={stock.isFavorite ? 'currentColor' : 'none'} /></Button></td></tr>)}</tbody></table></div></Card>}
    <Card><div className="split species-list-heading"><div><h2>Fishstocks you've added</h2><p className="muted">New fishstocks appear over time. Add any that aren't in the list yet. You can change a fishstock you added, but its code and how it's measured are locked once a landing uses it.</p></div><Button onClick={() => openDraft()}><Plus size={17} /> Add a fishstock</Button></div>
      {userStocks.isPending ? <Loading /> : userStocks.isError ? <Status tone="error">{errorMessage(userStocks.error)}</Status> : !userStocks.data.length ? <Empty>You haven't added any fishstocks.</Empty> : <div className="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Measured in</th><th>Fishing year</th><th className="numeric">Landings</th><th className="no-print">Actions</th></tr></thead><tbody>{userStocks.data.map((stock) => <tr key={stock.code}><td><strong>{stock.code}</strong></td><td>{stock.description}</td><td>{reportingUnitLabel(stock.reportingUnit)}</td><td>{fishingYearLabel(stock.fishingYearStartMonth)}</td><td className="numeric">{stock.landingCount}</td><td className="no-print"><div className="inline"><Button variant="ghost" aria-label={`Edit ${stock.code}`} title="Edit" onClick={() => openDraft(stock)}><Pencil size={15} /></Button><Button variant="ghost" aria-label={`Remove ${stock.code}`} title={stock.landingCount ? `Used by ${landingsLabel(stock.landingCount)}, so it can't be removed` : 'Remove'} disabled={stock.landingCount > 0 || remove.isPending} onClick={() => confirmRemove(stock)}><Trash2 size={15} /></Button></div></td></tr>)}</tbody></table></div>}
    </Card>
    {draft ? <div className="modal-backdrop"><Card className="modal"><div className="split"><div><h2>{draft.originalCode ? `Edit ${draft.originalCode}` : 'Add a fishstock'}</h2><p className="muted">{draft.originalCode ? 'Changes apply wherever this fishstock is shown.' : 'Check the details carefully before saving.'}</p></div><Button variant="ghost" aria-label="Close" onClick={closeDraft}><X size={17} /></Button></div>
      {formError ? <Status tone="error">{formError}</Status> : null}
      {similar ? <Status tone="warning"><strong>These fishstocks are already in the list:</strong> {similar.map((stock) => `${stock.code} ${stock.description}`).join('; ')}. Is one of them what you meant? If so, choose <strong>Cancel</strong> and use it instead.<div className="form-actions"><Button type="button" onClick={() => save(undefined, true)}>Add {draft.code} anyway</Button><Button type="button" variant="ghost" onClick={() => setSimilar(null)}>Go back</Button></div></Status> : null}
      <form className="stack" style={{ marginTop: 16 }} onSubmit={save}>
        <div className="form-grid">
          <div className="field"><label htmlFor="stock-code">Fishstock code</label><input id="stock-code" required maxLength={20} autoComplete="off" spellCheck={false} placeholder="e.g. SNA10" disabled={locked} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.replace(/\s+/g, '').toUpperCase() })} />{locked ? <small className="muted">Locked: used by {landingsLabel(draft.landingCount)}.</small> : null}</div>
          <div className="field"><label htmlFor="stock-name">Name</label><input id="stock-name" required maxLength={120} placeholder="e.g. Snapper" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></div>
          <div className="field"><label htmlFor="stock-unit">How it's measured</label><select id="stock-unit" disabled={locked} value={draft.reportingUnit} onChange={(event) => setDraft({ ...draft, reportingUnit: event.target.value as ReportingUnit })}>{REPORTING_UNITS.map((unit) => <option key={unit} value={unit}>{reportingUnitLabel(unit)}</option>)}</select>{locked ? <small className="muted">Locked: used by {landingsLabel(draft.landingCount)}.</small> : <small className="muted">Almost every fishstock is measured in greenweight.</small>}</div>
          <div className="field"><label htmlFor="stock-year">Fishing year</label><select id="stock-year" required value={draft.fishingYearStartMonth} onChange={(event) => setDraft({ ...draft, fishingYearStartMonth: Number(event.target.value) as FishingYearStartMonth })}><option value="" disabled>Choose a fishing year</option>{FISHING_YEAR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
        </div>
        <div className="muted"><strong>Which fishing year?</strong><ul>{FISHING_YEAR_OPTIONS.map((option) => <li key={option.value}>{option.label}: {option.description.charAt(0).toLowerCase() + option.description.slice(1)}{option.value === 1 ? ' only' : ''}.</li>)}</ul>If you're not sure, check with Fisheries New Zealand before adding it: the fishing year decides which year's totals its landings count towards.</div>
        <div className="form-actions"><Button type="submit" disabled={!!similar}>{draft.originalCode ? 'Save changes' : 'Add fishstock'}</Button><Button type="button" variant="ghost" onClick={closeDraft}>Cancel</Button></div>
      </form>
    </Card></div> : null}
  </div>;
}
