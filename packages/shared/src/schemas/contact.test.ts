import { describe, expect, it } from 'vitest';
import { Contact } from './contact';

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
