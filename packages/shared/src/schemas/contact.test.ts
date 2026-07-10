import { describe, expect, it } from 'vitest';
import { Contact, ContactPatch } from './contact';

describe('Contact schema', () => {
  it('accepts a valid contact', () => {
    const result = Contact.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      customer: 'Mantu',
      name: 'Tony Walteur',
      role: 'CEO',
      email: 'tony@mantu.com',
      phone: null,
      influence: 5,
      sentiment: 'hot',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = Contact.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      customer: 'Mantu',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = Contact.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      customer: 'Mantu',
      name: 'Tony',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });
});

describe('ContactPatch schema — length bounds mirror Contact', () => {
  // WHY: ContactPatch previously omitted the .max() bounds that Contact/ContactCreate
  // carry. An over-length PATCH bypassed validation and committed a value the
  // 200:Contact response schema could not serialize → 500, and the poisoned row then
  // 500'd every subsequent read of that contact AND the whole org contact list. These
  // tests fail if any bound is dropped again.
  it('accepts a value at the 255 boundary', () => {
    expect(ContactPatch.safeParse({ customer: 'A'.repeat(255) }).success).toBe(true);
  });

  it('rejects customer longer than 255', () => {
    expect(ContactPatch.safeParse({ customer: 'A'.repeat(256) }).success).toBe(false);
  });

  it('rejects name longer than 255', () => {
    expect(ContactPatch.safeParse({ name: 'A'.repeat(256) }).success).toBe(false);
  });

  it('rejects role longer than 255', () => {
    expect(ContactPatch.safeParse({ role: 'A'.repeat(256) }).success).toBe(false);
  });

  it('rejects phone longer than 50', () => {
    expect(ContactPatch.safeParse({ phone: '9'.repeat(51) }).success).toBe(false);
  });

  it('still requires at least one field', () => {
    expect(ContactPatch.safeParse({}).success).toBe(false);
  });
});
