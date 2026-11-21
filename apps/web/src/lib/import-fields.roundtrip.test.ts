import { describe, expect, it } from 'vitest';

import { autoMap, TARGET_FIELDS } from './import-fields';

describe('autoMap of the columns this app exports', () => {
  it('maps the companies CSV back onto the company fields, including legal name', () => {
    // WHY: Companies → Export CSV writes these headers. Re-importing that file
    // dropped employees, country, and legal name because none of them equal
    // "Employee count", "Country code", or a legal-name field.
    const mapped = autoMap(
      ['Name', 'Legal Name', 'Domain', 'Industry', 'Employees', 'Country'],
      TARGET_FIELDS.company,
    );
    expect(mapped).toMatchObject({
      Name: 'company.name',
      'Legal Name': 'company.legalName',
      Domain: 'company.domain',
      Industry: 'company.industry',
      Employees: 'company.employeeCount',
      Country: 'company.countryCode',
    });
  });

  it('maps the contacts CSV role and customer onto title and company', () => {
    const mapped = autoMap(
      ['Name', 'Role', 'Customer', 'Email', 'Phone'],
      TARGET_FIELDS.contact,
    );
    expect(mapped).toMatchObject({
      Name: 'contact.name',
      Role: 'contact.title',
      Customer: 'contact.companyName',
      Email: 'contact.email',
      Phone: 'contact.phone',
    });
  });

  it('maps the leads CSV name and company, which the export does not split', () => {
    const mapped = autoMap(['Name', 'Company', 'Email', 'Status'], TARGET_FIELDS.lead);
    expect(mapped).toMatchObject({
      Name: 'lead.name',
      Company: 'lead.companyName',
      Email: 'lead.email',
      Status: 'lead.status',
    });
  });

  it('maps the opportunities export value and due date', () => {
    // The streaming export header is "Value (EUR)" and "Due date". The import
    // field is "Value (amount)" and "Close date", so a re-import kept the name
    // and dropped the money and the day.
    const mapped = autoMap(
      ['Name', 'Customer', 'Stage', 'Value (EUR)', 'Probability', 'Due date'],
      TARGET_FIELDS.opportunity,
    );
    expect(mapped).toMatchObject({
      Name: 'opportunity.name',
      Customer: 'opportunity.customer',
      Stage: 'opportunity.stage',
      'Value (EUR)': 'opportunity.valueMicros',
      Probability: 'opportunity.probability',
      'Due date': 'opportunity.closeDate',
    });
  });
});
