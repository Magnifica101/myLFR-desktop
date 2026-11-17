import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronDown, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { Button, Card, Empty, Loading, PageHeader, Status } from '../components/ui';
import { PageHelp } from '../components/PageHelp';
import { useToast } from '../components/ToastProvider';
import { desktop } from '../lib/desktop';
import { errorMessage } from '../lib/format';
import type { Fisher, FisherInput, VesselInput, RegisteredVessel } from '../lib/types';

interface VesselDraft extends VesselInput {
  key: string;
  hasLandingHistory: boolean;
  originalArchived: boolean;
  removed?: boolean;
  registrationNeedsReview?: boolean;
  linkedPermitHolders?: string[];
  otherRecordedNames?: string[];
}
interface FisherDraft extends Omit<FisherInput, 'vessels'> { vessels: VesselDraft[] }
const empty: FisherDraft = { name: '', permitNumber: '', vessels: [] };

export default function Fishers() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<FisherDraft | null>(null);
  const [newVesselKey, setNewVesselKey] = useState<string | null>(null);
  const newVesselRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!newVesselKey || !newVesselRow.current) return;
    const row = newVesselRow.current;
    row.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    row.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    const timeout = window.setTimeout(() => setNewVesselKey(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [newVesselKey]);
  const [showArchivedVessels, setShowArchivedVessels] = useState(false);
  const [vesselAction, setVesselAction] = useState<{ index: number; action: 'archive' | 'delete' } | null>(null);
  const [fisherAction, setFisherAction] = useState<{ fisher: Fisher; action: 'archive' | 'delete' } | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (vesselAction || fisherAction) confirmation.current?.showModal();
    else confirmation.current?.close();
  }, [vesselAction, fisherAction]);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();
  const fishers = useQuery({ queryKey: ['fishers', includeArchived], queryFn: () => desktop.listFishers(includeArchived) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fishers'] });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => desktop.setFisherArchived(id, archived),
    onSuccess: (_, { archived }) => { toast.show(archived ? 'Permit holder archived.' : 'Permit holder restored.', 'success'); void refresh(); },
    onError: (caught) => toast.show(errorMessage(caught), 'error'),
  });
  const remove = useMutation({
    mutationFn: desktop.removeFisher,
    onSuccess: () => { toast.show('Permit holder deleted.', 'success'); void refresh(); },
    onError: (caught) => toast.show(errorMessage(caught), 'error'),
  });

  function edit(fisher?: Fisher) {
    setError('');
    setNewVesselKey(null);
    setEditing(fisher ? {
      id: fisher.id,
      name: fisher.name,
      permitNumber: fisher.permitNumber,
      vessels: fisher.vessels.map((vessel) => ({ id: vessel.id, key: vessel.id, name: vessel.name, vesselNumber: vessel.vesselNumber ?? '', isArchived: vessel.isArchived, originalArchived: vessel.isArchived, hasLandingHistory: vessel.hasLandingHistory, registrationNeedsReview: vessel.registrationNeedsReview, linkedPermitHolders: vessel.linkedPermitHolders, otherRecordedNames: vessel.otherRecordedNames })),
    } : structuredClone(empty));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setError('');
    try {
      await desktop.upsertFisher({
        id: editing.id, name: editing.name, permitNumber: editing.permitNumber,
        vessels: editing.vessels.filter((vessel) => !vessel.removed).map(({ id, name, vesselNumber, isArchived, linkExisting }) => ({ id, name, vesselNumber: vesselNumber.trim(), isArchived: !!isArchived, ...(linkExisting ? { linkExisting: true } : {}) })),
      });
      setEditing(null);
      toast.show('Permit holder saved.', 'success');
      await refresh();
    } catch (caught) { setError(errorMessage(caught)); }
  }

  function updateVessel(index: number, patch: Partial<VesselDraft>) {
    setError('');
    setEditing((current) => current ? { ...current, vessels: current.vessels.map((vessel, itemIndex) => itemIndex === index ? { ...vessel, ...patch } : vessel) } : current);
  }

  /** A vessel added in this editing session has nothing saved yet, so it leaves the form at once. */
  function removeNewVessel(index: number) {
    setError('');
    setEditing((current) => current ? { ...current, vessels: current.vessels.filter((_, itemIndex) => itemIndex !== index) } : current);
  }

  function addVessel() {
    if (!editing) return;
    const key = crypto.randomUUID();
    setEditing({ ...editing, vessels: [...editing.vessels, { key, name: '', vesselNumber: '', isArchived: false, originalArchived: false, hasLandingHistory: false }] });
    setNewVesselKey(key);
  }

  const removingSharedLink = !!(vesselAction && editing && (editing.vessels[vesselAction.index].linkedPermitHolders?.length ?? 0) > 1);
  const searchTerm = search.trim().toLocaleLowerCase();
  const visibleFishers = fishers.data?.filter((fisher) =>
    !searchTerm
    || fisher.name.toLocaleLowerCase().includes(searchTerm)
    || fisher.permitNumber.toLocaleLowerCase().includes(searchTerm)
  ) ?? [];

  return (
    <div className="page">
      <PageHeader title="Permit holders" description="Manage permit holders and vessels" actions={<PageHelp page="permit-holders" />} />
      <Card className="fisher-toolbar">
        <div className="split fisher-toolbar-heading">
          <div><h2>Manage permit holders</h2><p className="muted">Add, edit or archive your permit holders and vessels</p></div>
          <Button onClick={() => edit()}><Plus size={17} /> Add permit holder</Button>
        </div>
        <div className="fisher-filters">
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label="Search permit holders"
              placeholder="Search name or permit number"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="fisher-archive-options">
            <label className="fisher-archive-filter"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Show archived permit holders</label>
            <label className="fisher-archive-filter"><input type="checkbox" checked={showArchivedVessels} onChange={(event) => setShowArchivedVessels(event.target.checked)} /> Show archived vessels</label>
          </div>
        </div>
      </Card>
      {fishers.isPending ? <Loading /> : fishers.isError ? <Status tone="error">{errorMessage(fishers.error)}</Status> : !fishers.data.length ? <Empty>No permit holders have been added.</Empty> : (
        <>
          <div className="split fisher-list-heading">
            <div><h2>{includeArchived ? 'Permit holders' : 'Current permit holders'}</h2><p className="muted">{visibleFishers.length} {visibleFishers.length === 1 ? 'permit holder' : 'permit holders'} shown.</p></div>
          </div>
          <div className="stack">
            {!visibleFishers.length ? <Empty>No permit holders match that search.</Empty> : visibleFishers.map((fisher) => <Card className="fisher-card" key={fisher.id}>
              <details className="fisher-details">
                <summary aria-label={`Show or hide details for ${fisher.name}${fisher.isArchived ? ', archived' : ''}`}>
                  <span className="fisher-summary">
                    <strong>{fisher.name}</strong>
                    <span>{fisher.permitNumber}</span>
                  </span>
                  {fisher.isArchived ? <span className="pill fisher-archive-badge">Archived</span> : null}
                  <span className="fisher-details-toggle" aria-hidden="true"><span className="fisher-details-toggle-label" /><ChevronDown size={17} /></span>
                </summary>
                <div className="fisher-details-content">
                  <div className="inline no-print fisher-details-actions">
                    <Button aria-label={`Edit ${fisher.name}`} variant="secondary" onClick={() => edit(fisher)}><Pencil size={16} /> Edit</Button>
                    <Button aria-label={`${fisher.isArchived ? 'Restore' : 'Archive'} ${fisher.name}`} variant="secondary" disabled={archive.isPending} onClick={() => fisher.isArchived ? archive.mutate({ id: fisher.id, archived: false }) : setFisherAction({ fisher, action: 'archive' })}>{fisher.isArchived ? <RotateCcw size={16} /> : <Archive size={16} />} {fisher.isArchived ? 'Restore' : 'Archive'}</Button>
                    <Button aria-label={`Permanently remove ${fisher.name}`} variant="ghost" title="Remove only when no history exists" disabled={remove.isPending} onClick={() => setFisherAction({ fisher, action: 'delete' })}><Trash2 size={16} /></Button>
                  </div>
                  {fisher.vessels.some((vessel) => showArchivedVessels || !vessel.isArchived) ? <div className="table-wrap"><table><thead><tr><th>Vessel</th><th>Vessel number</th></tr></thead><tbody>{fisher.vessels.filter((vessel) => showArchivedVessels || !vessel.isArchived).map((vessel) => <tr key={vessel.id}><td>{vessel.name} {vessel.isArchived ? <span className="pill vessel-archive-badge">Archived</span> : null}</td><td>{vessel.vesselNumber || '—'}</td></tr>)}</tbody></table></div> : <p className="muted">{fisher.vessels.length ? <>All vessels are archived. Choose <strong>Show archived vessels</strong> to view them.</> : 'Shore-based / no vessels recorded.'}</p>}
                </div>
              </details>
            </Card>)}
          </div>
        </>
      )}
      {editing ? <div className="modal-backdrop"><Card className="modal">
        <div className="split"><h2 id="fisher-editor-title">{editing.id ? 'Edit permit holder' : 'Add permit holder'}</h2><Button aria-label="Close permit holder editor" variant="ghost" onClick={() => setEditing(null)}><X size={17} /></Button></div>
        {error ? <Status tone="error">{error}</Status> : null}
        <form onSubmit={save} className="stack" style={{ marginTop: 16 }}>
          <div className="form-grid">
            <div className="field"><label htmlFor="fisher-name">Name</label><input id="fisher-name" required maxLength={120} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></div>
            <div className="field"><label htmlFor="fisher-permit">Permit number</label><input id="fisher-permit" required maxLength={60} value={editing.permitNumber} onChange={(event) => setEditing({ ...editing, permitNumber: event.target.value })} /></div>
          </div>
          <div className="split"><h3>Vessels</h3><Button type="button" variant="secondary" onClick={addVessel}><Plus size={16} /> Add vessel</Button></div>
          <p className="muted vessel-editor-help">{editing.id
            ? <><strong>Archive</strong> applies only to this permit holder. Changes apply when you choose <strong>Save permit holder</strong>.</>
            : <>Choose <strong>Add vessel</strong> to link an existing vessel or record a new one. No vessel is needed for a shore-based permit holder.</>}</p>
          {editing.id ? <label className="fisher-archive-filter vessel-archive-filter"><input type="checkbox" checked={showArchivedVessels} onChange={(event) => setShowArchivedVessels(event.target.checked)} /> Include archived vessels</label> : null}
          {editing.vessels.map((vessel, index) => {
            const changed = vessel.removed || !!vessel.isArchived !== vessel.originalArchived;
            if (vessel.originalArchived && !showArchivedVessels && !changed) return null;
            const unsaved = !vessel.id;
            const status = unsaved ? 'New vessel' : vessel.removed ? ((vessel.linkedPermitHolders?.length ?? 0) > 1 ? 'Link will be removed' : 'Will be deleted') : changed ? (vessel.isArchived ? 'Will be archived' : 'Will be restored') : vessel.isArchived ? 'Archived' : '';
            return <div className={`vessel-editor-row${changed ? ' vessel-editor-pending' : ''}${vessel.key === newVesselKey ? ' vessel-editor-new' : ''}`} key={vessel.key} ref={vessel.key === newVesselKey ? newVesselRow : undefined}>
              <VesselFields vessel={vessel} onChange={(patch) => updateVessel(index, patch)} alreadyLinked={editing.vessels.filter((other) => other.key !== vessel.key && !other.removed).map((other) => other.vesselNumber.trim())} />
              <div className="split vessel-editor-actions">
                <span className={status ? 'pill' : 'muted'}>{status || (vessel.hasLandingHistory ? 'Landing history retained' : 'No landing history')}</span>
                {unsaved ? <Button type="button" variant="secondary" aria-label={`Remove new vessel${vessel.name ? ` ${vessel.name}` : ''}`} onClick={() => removeNewVessel(index)}><X size={16} /> Remove</Button>
                  : changed ? <Button type="button" variant="secondary" aria-label={`Undo change to ${vessel.name}`} onClick={() => updateVessel(index, { removed: false, isArchived: vessel.originalArchived })}><RotateCcw size={16} /> Undo</Button>
                  : vessel.isArchived ? <Button type="button" variant="secondary" aria-label={`Restore vessel ${vessel.name}`} onClick={() => updateVessel(index, { isArchived: false })}><RotateCcw size={16} /> Restore</Button>
                    : <Button type="button" variant="secondary" aria-label={vessel.hasLandingHistory ? `Archive vessel ${vessel.name}` : (vessel.linkedPermitHolders?.length ?? 0) > 1 ? `Remove link to ${vessel.name}` : `Delete vessel ${vessel.name}`} onClick={() => setVesselAction({ index, action: vessel.hasLandingHistory ? 'archive' : 'delete' })}>{vessel.hasLandingHistory ? <Archive size={16} /> : <Trash2 size={16} />} {vessel.hasLandingHistory ? 'Archive' : (vessel.linkedPermitHolders?.length ?? 0) > 1 ? 'Remove link' : 'Delete'}</Button>}
              </div>
            </div>;
          })}
          <div className="form-actions"><Button type="submit">Save permit holder</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
        </form>
      </Card></div> : null}
      <dialog ref={confirmation} className="vessel-confirm-dialog" aria-labelledby="vessel-confirm-title" aria-describedby="vessel-confirm-description" onCancel={() => { setVesselAction(null); setFisherAction(null); }}>
        {fisherAction ? <>
          <h2 id="vessel-confirm-title">{fisherAction.action === 'archive' ? 'Archive' : 'Delete'} permit holder?</h2>
          <p><strong>{fisherAction.fisher.name}</strong> — Permit {fisherAction.fisher.permitNumber}</p>
          <p id="vessel-confirm-description">{fisherAction.action === 'archive'
            ? 'Archiving removes this permit holder from new landing selections. All landing history is kept and still counts in reports. You can restore the permit holder later.'
            : 'This permanently deletes the permit holder and their vessel links. A permit holder can only be deleted if they have no landing history. This cannot be undone.'}</p>
          <div className="form-actions"><Button variant="secondary" autoFocus onClick={() => setFisherAction(null)}>Cancel</Button><Button variant={fisherAction.action === 'delete' ? 'danger' : 'primary'} onClick={() => {
            if (fisherAction.action === 'archive') archive.mutate({ id: fisherAction.fisher.id, archived: true });
            else remove.mutate(fisherAction.fisher.id);
            setFisherAction(null);
          }}>{fisherAction.action === 'archive' ? 'Archive' : 'Delete'}</Button></div>
        </> : vesselAction && editing ? <>
          <h2 id="vessel-confirm-title">{vesselAction.action === 'archive' ? 'Archive' : removingSharedLink ? 'Remove link for' : 'Delete'} {editing.vessels[vesselAction.index].name || 'this vessel'}?</h2>
          <p id="vessel-confirm-description">{vesselAction.action === 'archive'
            ? 'This vessel has landing history for this permit holder and cannot be deleted. Archiving removes it from new landing selections for this permit holder and keeps its history. Links to other permit holders are unchanged.'
            : (editing.vessels[vesselAction.index].linkedPermitHolders?.length ?? 0) > 1 ? <>This vessel has no landing history for this permit holder. Only this link will be removed when you choose <strong>Save permit holder</strong>. The vessel and its other permit holder links are kept.</> : <>This vessel has no landing history. It will be permanently deleted when you choose <strong>Save permit holder</strong>.</>}</p>
          <div className="form-actions"><Button variant="secondary" autoFocus onClick={() => setVesselAction(null)}>Cancel</Button><Button onClick={() => {
            updateVessel(vesselAction.index, vesselAction.action === 'archive' ? { isArchived: true } : { removed: true });
            setVesselAction(null);
          }}>{vesselAction.action === 'archive' ? 'Archive vessel' : removingSharedLink ? 'Remove link' : 'Delete vessel'}</Button></div>
        </> : null}
      </dialog>
    </div>
  );
}

function VesselFields({ vessel, onChange, alreadyLinked }: { vessel: VesselDraft; onChange: (patch: Partial<VesselDraft>) => void; alreadyLinked: string[] }) {
  const [lookupNumber, setLookupNumber] = useState('');
  const number = vessel.vesselNumber.trim();
  const valid = /^[1-9][0-9]{0,59}$/.test(number);
  const lookup = useQuery({ queryKey: ['vessel-registration', lookupNumber], queryFn: () => desktop.findVesselByNumber(lookupNumber), enabled: !vessel.id && valid && lookupNumber === number && !vessel.removed, retry: false });
  const match: RegisteredVessel | null | undefined = lookupNumber === number ? lookup.data : null;
  const duplicate = alreadyLinked.includes(number) && valid;
  const shared = (vessel.linkedPermitHolders?.length ?? 0) > 1;
  const lookupRequired = !vessel.id && valid && (lookupNumber !== number || lookup.isPending || lookup.isError);
  const selectRequired = !vessel.id && !!match && !vessel.linkExisting;
  return <>
    {!vessel.id ? <p className="muted" id={`vessel-registration-help-${vessel.key}`}>Enter the registration number to find an existing vessel or add a new one.</p> : null}
    <div className="vessel-editor-fields">
      <div className="field"><label htmlFor={`vessel-registration-${vessel.key}`}>Vessel registration number</label>
        <input id={`vessel-registration-${vessel.key}`} aria-describedby={!vessel.id ? `vessel-registration-help-${vessel.key}` : undefined} required maxLength={60} inputMode="numeric" title="Digits only, starting with 1–9. No internal spaces or leading zeros." readOnly={!!vessel.id && !vessel.registrationNeedsReview} disabled={!!vessel.removed}
          pattern={vessel.id && vessel.registrationNeedsReview && !valid ? undefined : "\\s*[1-9][0-9]*\\s*"}
          value={vessel.vesselNumber} onChange={(event) => { onChange({ vesselNumber: event.target.value, linkExisting: false }); }}
          onBlur={() => { if (valid && !vessel.id) setLookupNumber(number); }}
          ref={(node) => { if (node) node.setCustomValidity(duplicate ? 'This registration is already in the permit holder list.' : lookupRequired ? 'Leave this field to check the registration before saving.' : selectRequired ? 'Select the matching vessel below before saving.' : ''); }} />
      </div>
      <div className="field"><label htmlFor={`vessel-name-${vessel.key}`}>Vessel name</label><input id={`vessel-name-${vessel.key}`} required maxLength={120} disabled={!!vessel.removed || !!vessel.linkExisting} value={vessel.name} onChange={(event) => onChange({ name: event.target.value })} /></div>
    </div>
    {vessel.registrationNeedsReview ? <Status tone="warning">This older registration needs checking. Existing records are kept; enter digits only, starting with 1–9, to correct it.</Status> : null}
    {number && !valid && !vessel.registrationNeedsReview ? <Status tone="warning">Use digits only, starting with 1–9. Internal spaces and leading zeros are not allowed.</Status> : null}
    {duplicate ? <Status tone="warning">This registration is already included for this permit holder.</Status> : null}
    {!vessel.id && valid && lookupNumber === number && lookup.isFetching ? <p className="muted">Checking registration…</p> : null}
    {!vessel.id && lookupNumber === number && lookup.isError ? <Status tone="error">Unable to check this registration. <Button type="button" variant="secondary" onClick={() => void lookup.refetch()}>Try again</Button></Status> : null}
    {!vessel.id && match && !duplicate ? <div className="vessel-existing-match">
      <strong>{match.name} · Registration {match.vesselNumber}</strong>
      <p className="muted">This vessel registration number already exists. Choose <strong>Use this vessel</strong> if this is the same vessel. Each permit holder’s monthly reports will stay separate.</p>
      {vessel.linkExisting ? <span className="pill">Will link when you save</span> : <Button type="button" variant="secondary" onClick={() => onChange({ name: match.name, linkExisting: true })}>Use this vessel</Button>}
    </div> : null}
    {vessel.id && !vessel.registrationNeedsReview ? <p className="muted">The saved registration identifies this vessel. To record a different vessel, choose <strong>Add vessel</strong>.</p> : null}
    {shared ? <p className="muted">Shared with {vessel.linkedPermitHolders?.join(', ')}. Changing its name updates the shared vessel for all of them. <strong>Archive</strong> and <strong>Restore</strong> affect only this permit holder.</p> : null}
    {vessel.otherRecordedNames?.length ? <Status tone="warning">Other names were recorded for this registration: {vessel.otherRecordedNames.join(', ')}. Check the shared vessel name above; historical snapshots keep their original wording.</Status> : null}
  </>;
}
