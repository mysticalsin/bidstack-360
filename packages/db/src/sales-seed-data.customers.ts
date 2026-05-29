/**
 * sales-seed-data.customers.ts — customer fixtures for the sales module.
 *
 * Extracted from sales-seed-data.ts (BS-R1 file-size refactor).
 * Re-exported from sales-seed-data.ts — import from there, not here.
 */

export type CustomerSeed = {
  name: string;
  countryCode: string; // ISO-3166 alpha-2
  salespersonEmail: string; // must match a fixtureUsers email
  currency: 'CAD' | 'USD' | 'EUR';
};

// Mirrors customers from the reference screenshot, expanded for 8 countries.
export const fixtureSalesCustomers: CustomerSeed[] = [
  {
    name: 'La Presse Inc',
    countryCode: 'CA',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'FLORIDA GUL COAST UNIVERSITY',
    countryCode: 'US',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Centre de Services Scolaire des Découvreurs',
    countryCode: 'CA',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Cégep de Lanaudière, Guillaume Chartrand',
    countryCode: 'CA',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Brilliance Employment & Enterprise Strategy Inc.',
    countryCode: 'CA',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Softchoice LP',
    countryCode: 'CA',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Dublin City Schools',
    countryCode: 'US',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Nuovo Photography',
    countryCode: 'IT',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Technologies Plotly Inc',
    countryCode: 'CA',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'University of Toronto',
    countryCode: 'CA',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'BBC Studios',
    countryCode: 'GB',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Mercedes-Benz AG',
    countryCode: 'DE',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Sanofi SA',
    countryCode: 'FR',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Telefónica España',
    countryCode: 'ES',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Banco do Brasil',
    countryCode: 'BR',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Tata Consultancy Services',
    countryCode: 'IN',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'USD',
  },
  {
    name: 'New York City Department of Education',
    countryCode: 'US',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Los Angeles Unified School District',
    countryCode: 'US',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Université de Montréal',
    countryCode: 'CA',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Bibliothèque et Archives nationales du Québec',
    countryCode: 'CA',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'CAD',
  },
];
