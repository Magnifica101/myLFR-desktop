import { ExternalLink } from 'lucide-react';
import { Button, Card, PageHeader } from '../components/ui';
import { PageHelp } from '../components/PageHelp';
import { desktop } from '../lib/desktop';

const resources = [
  ['Find a fishstock', 'Search FishServe fishstock records.', 'https://register.kupe.fishserve.co.nz/home/FindStock'],
  ['Find a permit', 'Look up commercial fishing permit holders.', 'https://register.kupe.fishserve.co.nz/home/FindPermit'],
  ['Find a vessel', 'Look up registered fishing vessels.', 'https://register.kupe.fishserve.co.nz/home/FindVessel'],
  ['Conversion factor calculator', 'Open the FishServe conversion calculator.', 'https://register.kupe.fishserve.co.nz/home/ConversionFactorCalculator'],
  ['Reporting Regulations', 'Read the Fisheries (Reporting) Regulations 2017.', 'https://www.legislation.govt.nz/regulation/public/2017/0154/latest/DLM7324101.html'],
  ['Recordkeeping Regulations', 'Read the Fisheries (Recordkeeping) Regulations 1990.', 'https://www.legislation.govt.nz/secondary-legislation/pco-drafted/1990/219/en/latest/#DLM139498'],
];

export default function Resources() {
  return <div className="page"><PageHeader title="Resources" description="These resource links open in your web browser and require an internet connection." actions={<PageHelp page="resources" />} /><div className="form-grid">{resources.map(([title, description, url]) => <Card key={url}><h2>{title}</h2><p className="muted">{description}</p><Button variant="secondary" onClick={() => desktop.openApprovedExternalLink(url)}>Open resource <ExternalLink size={16} /></Button></Card>)}</div></div>;
}
