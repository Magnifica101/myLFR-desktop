import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronUp, Eye, History, Pencil, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { Button, Card, Empty, Loading, PageHeader, Status } from '../components/ui';
import { PageHelp } from '../components/PageHelp';
import { useToast } from '../components/ToastProvider';
import { desktop } from '../lib/desktop';
import { errorMessage, formatDate, formatDateTime, formatQuantityValue, quantityInputToScaledQuantity, quantityToInput, reportingUnitLabel, reportingUnitShortLabel } from '../lib/format';
import type { Fisher, Landing, LandingRevision, ReportingUnit } from '../lib/types';

interface DraftItem { code: string; description: string; reportingUnit: ReportingUnit; quantity: string }
/** `remembered` holds weights typed on stocks taken off while this form is open, so putting a stock back restores its weight. It goes when the form closes. */
interface Draft { id?: string; fisherId: string; vesselId: string; landingDate: string; invoiceNumber: string; items: DraftItem[]; remembered?: Record<string, string> }
interface LandingSearch { fromDate: string; toDate: string; fisherId: string; vesselId: string; fishstockCode: string; invoiceNumber: string }

function withoutItem(draft: Draft, code: string): Draft {
  const taken = draft.items.find((item) => item.code === code);
  const remembered = { ...draft.remembered };
  if (taken?.quantity.trim()) remembered[code] = taken.quantity; else delete remembered[code];
  return { ...draft, items: draft.items.filter((item) => item.code !== code), remembered };
}

function withItems(draft: Draft, stocks: Array<{ code: string; description: string; reportingUnit: ReportingUnit }>): Draft {
  const remembered = { ...draft.remembered };
  const added = stocks.map((stock) => {
    const quantity = remembered[stock.code] ?? '';
    delete remembered[stock.code];
    return { code: stock.code, description: stock.description, reportingUnit: stock.reportingUnit, quantity };
  });
  return { ...draft, items: [...added, ...draft.items], remembered };
}

const emptyDraft = (): Draft => ({ fisherId: '', vesselId: '', landingDate: new Date().toISOString().slice(0, 10), invoiceNumber: '', items: [] });
const emptySearch = (): LandingSearch => ({ fromDate: '', toDate: '', fisherId: '', vesselId: '', fishstockCode: '', invoiceNumber: '' });

function landingTotals(items: Landing['items']) {
  const totals = new Map<ReportingUnit, number>();
  for (const item of items) totals.set(item.reportingUnit, (totals.get(item.reportingUnit) ?? 0) + item.quantity);
  return [...totals.entries()].map(([unit, quantity]) => ({ unit, value: formatQuantityValue(quantity, unit) }));
}

export default function Landings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState<LandingSearch>(emptySearch);
  const [appliedFilters, setAppliedFilters] = useState<LandingSearch>(emptySearch);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<{ title: string; rows: LandingRevision[] } | null>(null);
  const [deletedLandingDetails, setDeletedLandingDetails] = useState<LandingRevision | null>(null);
  const [deletingLanding, setDeletingLanding] = useState<Landing | null>(null);
  const deletionConfirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deletingLanding) deletionConfirmation.current?.showModal();
    else deletionConfirmation.current?.close();
  }, [deletingLanding]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const fishers = useQuery({ queryKey: ['fishers', false], queryFn: () => desktop.listFishers(false) });
  const allFishers = useQuery({ queryKey: ['fishers', true], queryFn: () => desktop.listFishers(true) });
  const landings = useQuery({
    queryKey: ['landings', appliedFilters, hasSearched],
    queryFn: () => desktop.listLandings({
      fisherId: appliedFilters.fisherId || null,
      vesselId: appliedFilters.vesselId || null,
      fishstockCode: appliedFilters.fishstockCode || null,
      invoiceNumber: appliedFilters.invoiceNumber.trim() || null,
      fromDate: appliedFilters.fromDate || null,
      toDate: appliedFilters.toDate || null,
      limit: hasSearched ? 500 : 10,
    }),
  });
  const deleted = useQuery({ queryKey: ['deleted-landings'], queryFn: () => desktop.listDeletedLandings(200), enabled: showDeleted });
  const fishstocks = useQuery({ queryKey: ['fishstock-search', search], queryFn: () => desktop.searchFishstocks(search), enabled: search.trim().length > 0 });
  const favorites = useQuery({ queryKey: ['favorite-fishstocks'], queryFn: desktop.listFavoriteFishstocks, enabled: showFavorites });
  const selectedFisher: Fisher | undefined = useMemo(() => allFishers.data?.find((fisher) => fisher.id === draft?.fisherId), [draft?.fisherId, allFishers.data]);
  const searchVessels = useMemo(() => {
    const availableFishers = filters.fisherId
      ? allFishers.data?.filter((fisher) => fisher.id === filters.fisherId)
      : allFishers.data;
    return [...new Map(availableFishers?.flatMap((fisher) => fisher.vessels.map((vessel) => [vessel.id, { ...vessel, fisherName: fisher.name }] as const)) ?? []).values()];
  }, [allFishers.data, filters.fisherId]);
  const filteredDeleted = useMemo(() => deleted.data?.filter((entry) => (
    (!appliedFilters.fromDate || entry.landingDate >= appliedFilters.fromDate)
    && (!appliedFilters.toDate || entry.landingDate <= appliedFilters.toDate)
    && (!appliedFilters.fisherId || entry.fisherId === appliedFilters.fisherId)
    && (!appliedFilters.vesselId || entry.vesselId === appliedFilters.vesselId)
    && (!appliedFilters.fishstockCode || entry.items.some((item) => item.fishstockCode === appliedFilters.fishstockCode))
    && (!appliedFilters.invoiceNumber.trim() || (entry.invoiceNumber ?? '').toLocaleLowerCase().includes(appliedFilters.invoiceNumber.trim().toLocaleLowerCase()))
  )), [appliedFilters, deleted.data]);
  const invalidate = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['landings'] }), queryClient.invalidateQueries({ queryKey: ['landing-years'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] }), queryClient.invalidateQueries({ queryKey: ['deleted-landings'] })]); };
  const remove = useMutation({ mutationFn: desktop.deleteLanding, onSuccess: async () => { setDeletingLanding(null); toast.show('Landing deleted; its final snapshot remains in history.', 'success'); await invalidate(); }, onError: (caught) => toast.show(errorMessage(caught), 'error') });
  const addPreviousFishstocks = useMutation({
    mutationFn: async () => {
      if (!draft?.fisherId) return [];
      return desktop.listPreviousLandingFishstocks(draft.fisherId, draft.vesselId || null, draft.id);
    },
    onSuccess: (stocks) => {
      if (!stocks.length) {
        toast.show('No fishstocks were found in a previous landing for this permit holder and vessel.', 'info');
        return;
      }
      if (!draft) return;
      const existingCodes = new Set(draft.items.map((item) => item.code));
      const newStocks = stocks.filter((stock) => !existingCodes.has(stock.code));
      setDraft(withItems(draft, newStocks));
      toast.show(newStocks.length ? `Added ${newStocks.length} fishstock${newStocks.length === 1 ? '' : 's'} from the previous matching landing.` : 'Those fishstocks are already on this landing.', 'success');
    },
    onError: (caught) => toast.show(errorMessage(caught), 'error'),
  });

  function edit(landing?: Landing) {
    setError(''); setSearch(''); setShowFavorites(false);
    setDraft(landing ? { id: landing.id, fisherId: landing.fisherId, vesselId: landing.vesselId ?? '', landingDate: landing.landingDate, invoiceNumber: landing.invoiceNumber ?? '', items: landing.items.map((item) => ({ code: item.fishstockCode, description: item.description, reportingUnit: item.reportingUnit, quantity: quantityToInput(item.quantity, item.reportingUnit) })) } : emptyDraft());
  }

  function addFishstock(code: string, description: string, reportingUnit: ReportingUnit) {
    if (!draft || draft.items.some((item) => item.code === code)) return;
    setDraft(withItems(draft, [{ code, description, reportingUnit }]));
    setSearch('');
  }

  function toggleFavoriteFishstock(code: string, description: string, reportingUnit: ReportingUnit) {
    if (!draft) return;
    if (draft.items.some((item) => item.code === code)) {
      setDraft(withoutItem(draft, code));
      return;
    }
    addFishstock(code, description, reportingUnit);
  }

  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft) return; setError('');
    const items = draft.items.map((item) => ({ fishstockCode: item.code, quantity: quantityInputToScaledQuantity(item.quantity, item.reportingUnit) ?? 0 }));
    try {
      await desktop.saveLanding({ id: draft.id, fisherId: draft.fisherId, vesselId: draft.vesselId || null, landingDate: draft.landingDate, invoiceNumber: draft.invoiceNumber || null, items });
      setDraft(null); toast.show(draft.id ? 'Landing updated.' : 'Landing recorded.', 'success'); await invalidate();
    } catch (caught) { setError(errorMessage(caught)); }
  }

  async function showHistory(landing: Landing) {
    try { setHistory({ title: `${formatDate(landing.landingDate)} — ${landing.fisherName}`, rows: await desktop.listLandingRevisions(landing.id) }); }
    catch (caught) { toast.show(errorMessage(caught), 'error'); }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedFilters(filters);
    setHasSearched(true);
  }

  function clearSearch() {
    const cleared = emptySearch();
    setFilters(cleared);
    setAppliedFilters(cleared);
    setHasSearched(false);
    setShowDeleted(false);
  }

  return (
    <div className="page">
      <PageHeader title="Landings" description="Record or edit landings, and search current or archived records." actions={<PageHelp page="landings" />} />
      {!fishers.isPending && !fishers.data?.length ? <Status tone="warning">Add an active permit holder before recording a landing.</Status> : null}
      <Card className="landing-pathways"><div><h2>What would you like to do?</h2><p className="muted">You can still see earlier versions after editing a landing.</p></div><div className="page-actions"><Button onClick={() => edit()} disabled={!fishers.data?.length}><Plus size={17} /> Record a landing</Button><Button variant="secondary" onClick={() => setSearchOpen((open) => !open)} aria-expanded={searchOpen}>{searchOpen ? <ChevronUp size={17} /> : <Search size={17} />}{searchOpen ? 'Hide search' : 'Search landings'}</Button></div></Card>
      {searchOpen ? <Card><h2>Search landings</h2><form className="stack" onSubmit={submitSearch}><div className="form-grid"><div className="field"><label htmlFor="landing-from">From date</label><input id="landing-from" type="date" value={filters.fromDate} onChange={(event) => setFilters({ ...filters, fromDate: event.target.value })} /></div><div className="field"><label htmlFor="landing-to">To date</label><input id="landing-to" type="date" value={filters.toDate} onChange={(event) => setFilters({ ...filters, toDate: event.target.value })} /></div></div><div className="form-grid landing-filter-row"><div className="field"><label htmlFor="landing-fisher">Permit holder</label><select id="landing-fisher" value={filters.fisherId} onChange={(event) => setFilters({ ...filters, fisherId: event.target.value, vesselId: '' })}><option value="">All permit holders</option>{allFishers.data?.map((fisher) => <option key={fisher.id} value={fisher.id}>{fisher.name} — {fisher.permitNumber}{fisher.isArchived ? ' (archived)' : ''}</option>)}</select></div><div className="field"><label htmlFor="landing-vessel">Vessel</label><select id="landing-vessel" value={filters.vesselId} onChange={(event) => setFilters({ ...filters, vesselId: event.target.value })}><option value="">All vessels</option>{searchVessels.map((vessel) => <option key={vessel.id} value={vessel.id}>{vessel.name}{filters.fisherId ? '' : ` — ${vessel.vesselNumber ?? 'registration needs review'}`}</option>)}</select></div><div className="field"><label htmlFor="landing-fishstock">Fishstock code</label><input id="landing-fishstock" placeholder="e.g. SNA1" maxLength={20} autoComplete="off" spellCheck={false} value={filters.fishstockCode} onChange={(event) => setFilters({ ...filters, fishstockCode: event.target.value.replace(/\s+/g, '').toUpperCase() })} /></div><div className="field"><label htmlFor="landing-invoice">Invoice number</label><input id="landing-invoice" placeholder="Any part of the number" maxLength={120} autoComplete="off" spellCheck={false} value={filters.invoiceNumber} onChange={(event) => setFilters({ ...filters, invoiceNumber: event.target.value })} /></div></div><label className="inline"><input style={{ width: 'auto' }} type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} /> Include archived (deleted) landings</label><div className="form-actions"><Button type="submit"><Search size={17} /> Search</Button><Button type="button" variant="ghost" onClick={clearSearch}>Clear filters</Button></div></form></Card> : null}
      {landings.isPending ? <Loading /> : landings.isError ? <Status tone="error">{errorMessage(landings.error)}</Status> : !landings.data.length ? <Empty>{hasSearched ? 'No current landings match these filters.' : 'No landings have been recorded yet.'}</Empty> : <Card><div className="split landing-list-heading"><div><h2>{hasSearched ? 'Search results' : 'Recent landings'}</h2><p className="muted">{hasSearched ? `Showing ${landings.data.length} matching landing${landings.data.length === 1 ? '' : 's'}.` : 'Showing the 10 most recent landings.'}</p></div></div><div className="table-wrap"><table className="landing-table"><colgroup><col className="col-date" /><col className="col-holder" /><col className="col-vessel" /><col className="col-invoice" /><col className="col-count" /><col className="col-total" /><col className="col-unit" /><col className="col-actions" /></colgroup><thead><tr><th>Date</th><th>Permit holder</th><th>Vessel</th><th>Invoice</th><th className="numeric">Fishstocks</th><th className="numeric">Total</th><th>Unit</th><th className="no-print">Actions</th></tr></thead><tbody>{landings.data.map((landing) => { const totals = landingTotals(landing.items); return <tr key={landing.id}><td>{formatDate(landing.landingDate)}</td><td>{landing.fisherName}<br /><span className="muted">{landing.fisherNumber}</span></td><td>{landing.vesselName ?? 'Shore-based'}</td><td>{landing.invoiceNumber ?? '—'}</td><td className="numeric">{landing.items.length}</td><td className="numeric">{totals.map(({ unit, value }) => <div key={unit}>{value}</div>)}</td><td>{totals.map(({ unit }) => <div key={unit}>{reportingUnitShortLabel(unit)}</div>)}</td><td className="no-print"><div className="inline"><Button variant="ghost" onClick={() => edit(landing)} title="Edit"><Pencil size={15} /></Button><Button variant="ghost" onClick={() => showHistory(landing)} title="History"><History size={15} /></Button><Button variant="ghost" onClick={() => setDeletingLanding(landing)} title="Delete"><Trash2 size={15} /></Button></div></td></tr>; })}</tbody></table></div></Card>}
      {showDeleted ? <Card><div className="split landing-list-heading"><div><h2>Deleted landing history</h2>{filteredDeleted?.length ? <p className="muted">{`Showing ${filteredDeleted.length} deleted landing${filteredDeleted.length === 1 ? '' : 's'}.`}</p> : null}</div></div>{deleted.isPending ? <Loading /> : !filteredDeleted?.length ? <Empty>No deleted landings match these filters.</Empty> : <div className="table-wrap"><table className="landing-table" aria-label="Deleted landings"><colgroup><col className="col-date" /><col className="col-holder" /><col className="col-vessel" /><col className="col-invoice" /><col className="col-count" /><col className="col-total" /><col className="col-unit" /><col className="col-actions" /></colgroup><thead><tr><th>Date</th><th>Permit holder</th><th>Vessel</th><th>Invoice</th><th className="numeric">Fishstocks</th><th className="numeric">Total</th><th>Unit</th><th className="no-print">Actions</th></tr></thead><tbody>{filteredDeleted.map((entry) => { const totals = landingTotals(entry.items); return <tr key={entry.id}><td>{formatDate(entry.landingDate)}<br /><span className="muted">Deleted {formatDateTime(entry.createdAt)}</span></td><td>{entry.fisherName}<br /><span className="muted">{entry.fisherNumber}</span></td><td>{entry.vesselName ?? 'Shore-based'}</td><td>{entry.invoiceNumber ?? '—'}</td><td className="numeric">{entry.items.length}</td><td className="numeric">{totals.map(({ unit, value }) => <div key={unit}>{value}</div>)}</td><td>{totals.map(({ unit }) => <div key={unit}>{reportingUnitShortLabel(unit)}</div>)}</td><td className="no-print"><div className="inline"><span className="pill">Deleted</span><Button type="button" variant="ghost" onClick={() => setDeletedLandingDetails(entry)} title="View details" aria-label="View details"><Eye size={15} /></Button></div></td></tr>; })}</tbody></table></div>}</Card> : null}
      {draft ? <div className="modal-backdrop"><Card className="modal modal-wide"><div className="split"><div><h2>{draft.id ? 'Edit landing' : 'New landing'}</h2><p className="muted">Enter the landing details, then add each fishstock and the quantity received.</p></div><Button variant="ghost" onClick={() => setDraft(null)}><X size={17} /></Button></div>{error ? <Status tone="error">{error}</Status> : null}<form onSubmit={save} className="stack" style={{ marginTop: 16 }}><div className="form-grid"><div className="field"><label htmlFor="draft-fisher">Permit holder</label><select id="draft-fisher" required value={draft.fisherId} onChange={(event) => setDraft({ ...draft, fisherId: event.target.value, vesselId: '' })}><option value="">Select permit holder</option>{allFishers.data?.filter((fisher) => !fisher.isArchived || landings.data?.some((landing) => landing.id === draft?.id && landing.fisherId === fisher.id)).map((fisher) => <option value={fisher.id} key={fisher.id}>{fisher.name} — {fisher.permitNumber}</option>)}</select></div><div className="field"><label htmlFor="draft-vessel">Vessel</label><select id="draft-vessel" value={draft.vesselId} disabled={!draft.fisherId} onChange={(event) => setDraft({ ...draft, vesselId: event.target.value })}><option value="">Shore-based / no vessel</option>{selectedFisher?.vessels.filter((vessel) => !vessel.isArchived || landings.data?.some((landing) => landing.id === draft?.id && landing.vesselId === vessel.id)).map((vessel) => <option value={vessel.id} key={vessel.id}>{vessel.name}{vessel.vesselNumber ? ` — ${vessel.vesselNumber}` : ''}{vessel.isArchived ? ' (archived)' : ''}</option>)}</select></div><div className="field"><label>Received date</label><input required type="date" value={draft.landingDate} onChange={(event) => setDraft({ ...draft, landingDate: event.target.value })} /></div><div className="field"><label>Invoice number</label><input maxLength={120} value={draft.invoiceNumber} onChange={(event) => setDraft({ ...draft, invoiceNumber: event.target.value })} /></div></div><div className="field"><div className="split compact-split"><label htmlFor="fishstock-search">Add fishstock</label><div className="inline"><Button type="button" variant="secondary" disabled={!draft.fisherId || addPreviousFishstocks.isPending} onClick={() => addPreviousFishstocks.mutate()}><History size={16} /> {addPreviousFishstocks.isPending ? 'Adding…' : 'Add from previous landing'}</Button><Button type="button" variant="secondary" onClick={() => setShowFavorites(true)}><Star size={16} /> Add from favourites</Button></div></div><div className="search-anchor"><div className="search-box"><Search size={17} /><input id="fishstock-search" placeholder="Search code or description" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && search) { event.preventDefault(); event.stopPropagation(); setSearch(''); } }} /></div>{fishstocks.data?.length ? <ul className="search-results search-results-floating">{fishstocks.data.map((stock) => <li key={stock.code}><button type="button" className="search-result" onClick={() => addFishstock(stock.code, stock.description, stock.reportingUnit)}><strong>{stock.code}</strong><small>{stock.description} • {reportingUnitLabel(stock.reportingUnit)}</small></button></li>)}</ul> : null}</div></div>{!draft.items.length ? <Empty>Add at least one fishstock.</Empty> : draft.items.map((item, index) => <div className="item-row" key={item.code}><div><strong>{item.code}</strong><div className="muted">{item.description}</div></div><div className="field"><label>{reportingUnitLabel(item.reportingUnit)}</label><input required inputMode={item.reportingUnit === 'count' ? 'numeric' : 'decimal'} placeholder={item.reportingUnit === 'count' ? '0' : '0.00'} value={item.quantity} onChange={(event) => setDraft({ ...draft, items: draft.items.map((current, itemIndex) => itemIndex === index ? { ...current, quantity: event.target.value } : current) })} /></div><Button type="button" variant="ghost" onClick={() => setDraft(withoutItem(draft, item.code))}><Trash2 size={16} /></Button></div>)}<div className="form-actions"><Button type="submit">Save landing</Button><Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div></form></Card></div> : null}
      {showFavorites && draft ? <div className="modal-backdrop modal-backdrop-raised"><Card className="modal"><div className="split"><div><h2>Favourite fishstocks</h2><p className="muted">Select a fishstock to add it. Select it again to remove it.</p></div><Button variant="ghost" aria-label="Close favourite fishstocks" onClick={() => setShowFavorites(false)}><X size={17} /></Button></div>{favorites.isPending ? <Loading label="Loading favourites…" /> : favorites.isError ? <Status tone="error">{errorMessage(favorites.error)}</Status> : !favorites.data?.length ? <Empty>No favourites yet. Add them from the Species page.</Empty> : <div className="favorite-picker-grid">{favorites.data.map((stock) => { const added = draft.items.some((item) => item.code === stock.code); return <Button key={stock.code} type="button" variant="ghost" className={`favorite-pick${added ? ' favorite-pick-selected' : ''}`} aria-label={`${added ? 'Remove' : 'Add'} ${stock.code}`} aria-pressed={added} onClick={() => toggleFavoriteFishstock(stock.code, stock.description, stock.reportingUnit)}>{stock.code}</Button>; })}</div>}</Card></div> : null}
      {history ? <div className="modal-backdrop"><Card className="modal"><div className="split"><div><h2>Landing history</h2><p className="muted">{history.title}</p></div><Button variant="ghost" onClick={() => setHistory(null)}><X size={17} /></Button></div><div className="stack">{history.rows.map((entry) => <div className="revision" key={entry.id}><strong>Version {entry.versionNumber} • {entry.operation}</strong><div className="muted">{formatDateTime(entry.createdAt)}</div><div>{entry.items.map((item) => `${item.fishstockCode}: ${formatQuantityValue(item.quantity, item.reportingUnit)} ${reportingUnitShortLabel(item.reportingUnit)}`).join(' • ')}</div></div>)}</div></Card></div> : null}
      {deletedLandingDetails ? <div className="modal-backdrop"><Card className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="deleted-landing-title"><div className="split"><div><h2 id="deleted-landing-title">Deleted landing details</h2><p className="muted">Read-only snapshot • Deleted {formatDateTime(deletedLandingDetails.createdAt)}</p></div><Button variant="ghost" aria-label="Close deleted landing details" onClick={() => setDeletedLandingDetails(null)}><X size={17} /></Button></div><div className="stack"><div className="form-grid"><div><strong>Landing date</strong><div>{formatDate(deletedLandingDetails.landingDate)}</div></div><div><strong>Permit holder</strong><div>{deletedLandingDetails.fisherName} — {deletedLandingDetails.fisherNumber}</div></div><div><strong>Vessel</strong><div>{deletedLandingDetails.vesselName ?? 'Shore-based'}{deletedLandingDetails.vesselNumber ? ` — ${deletedLandingDetails.vesselNumber}` : ''}</div></div><div><strong>Invoice number</strong><div>{deletedLandingDetails.invoiceNumber ?? '—'}</div></div></div><div><strong>Fishstocks and quantities</strong><div className="table-wrap"><table><thead><tr><th>Fishstock</th><th>Description</th><th className="numeric">Quantity</th><th>Reporting unit</th></tr></thead><tbody>{deletedLandingDetails.items.map((item) => <tr key={item.id}><td>{item.fishstockCode}</td><td>{item.description}</td><td className="numeric">{formatQuantityValue(item.quantity, item.reportingUnit)}</td><td>{reportingUnitLabel(item.reportingUnit)}</td></tr>)}</tbody></table></div></div></div><div className="form-actions"><Button type="button" onClick={() => setDeletedLandingDetails(null)}>Close</Button></div></Card></div> : null}
      <dialog ref={deletionConfirmation} className="vessel-confirm-dialog" aria-labelledby="delete-landing-title" aria-describedby="delete-landing-description" onCancel={() => setDeletingLanding(null)}>
        {deletingLanding ? <>
          <h2 id="delete-landing-title">Delete landing?</h2>
          <p><strong>{formatDate(deletingLanding.landingDate)} — {deletingLanding.fisherName}</strong>{deletingLanding.invoiceNumber ? ` — Invoice ${deletingLanding.invoiceNumber}` : ''}</p>
          <p id="delete-landing-description">This removes the landing from active reports. Its final snapshot remains read-only in history.</p>
          <div className="form-actions"><Button variant="secondary" autoFocus disabled={remove.isPending} onClick={() => setDeletingLanding(null)}>Cancel</Button><Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(deletingLanding.id)}>{remove.isPending ? 'Deleting…' : 'Delete landing'}</Button></div>
        </> : null}
      </dialog>
    </div>
  );
}
