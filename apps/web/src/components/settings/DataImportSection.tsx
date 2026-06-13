import { Card, SectionHeader } from '@/components/ui/Card';

import { CsvImportWizard } from '@/components/import/CsvImportWizard';

export function DataImportSection() {
  return (
    <Card>
      <SectionHeader
        title="Data import"
        caption="Bring companies, contacts, leads, and opportunities in from a CSV export of your previous CRM. Map your columns, choose how duplicates are handled, then import."
      />
      <div className="p-5">
        <CsvImportWizard />
      </div>
    </Card>
  );
}
