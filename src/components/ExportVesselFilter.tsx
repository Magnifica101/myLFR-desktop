import type { Vessel } from '../lib/types';

interface ExportVesselFilterProps {
  id: string;
  label: string;
  value: string;
  vessels: Vessel[];
  onChange: (value: string) => void;
}

export default function ExportVesselFilter({ id, label, value, vessels, onChange }: ExportVesselFilterProps) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">All vessels and shore-based</option>
      <option value="shore-based">Shore-based only</option>
      {vessels.map((vessel) => <option key={vessel.id} value={vessel.id}>{vessel.name}{vessel.vesselNumber ? ` — ${vessel.vesselNumber}` : ''}{vessel.isArchived ? ' (archived)' : ''}</option>)}
    </select>
  </div>;
}
