// A child agreement already has an account id. The company list only supplies
// the name. A paused or failed read has no name yet. The field said
// "Choose an account". That read has not arrived.
import '@/i18n';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useCompanies: vi.fn(),
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: hookMocks.useCompanies,
}));

vi.mock('@/hooks/useMsa', () => ({
  useCreateMsa: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadMsaVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

import { UploadDialog } from './UploadDialog';

const CHECKING = 'Checking the account name. The list has not arrived.';
const FAILED = 'Could not load the account name.';
const MISSING = 'This account is not in the list.';
const PLACEHOLDER = 'Choose an account';
const ACCOUNT = 'Northwind Advisory';
const OTHER = 'Contoso Print';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

function company(name: string, industry: string | null = 'Consulting') {
  return {
    id: COMPANY_ID,
    name,
    industry,
  };
}

function list(items: Array<{ id: string; name: string; industry: string | null }>) {
  return { items };
}

function renderDialog(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useCompanies.mockReturnValue(query);
  render(
    <UploadDialog
      open
      onOpenChange={() => undefined}
      target={{ mode: 'new', companyId: COMPANY_ID, kind: 'sow' }}
    />,
  );
}

function expectNoEmptyChoice() {
  expect(screen.queryByRole('option', { name: PLACEHOLDER })).toBeNull();
  expect(screen.queryByText(PLACEHOLDER)).toBeNull();
}

describe('UploadDialog preset account name', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused name read as an empty account choice', () => {
    // WHY: a child SOW already has an account id. A paused first read has
    // isLoading false and no name. "Choose an account" says none is selected.
    renderDialog({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoEmptyChoice();
    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Northwind SOW' } });
    expect(screen.getByRole('button', { name: 'Create agreement' }).hasAttribute('disabled')).toBe(false);
  });

  it('does not treat an in-flight name read as an empty account choice', () => {
    // WHY: a slow read also has no name, and isLoading can stay false.
    // The empty choice must not stand in for a read that is still running.
    renderDialog({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNoEmptyChoice();
    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed name read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and the empty choice must not open.
    renderDialog({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('accounts down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoEmptyChoice();
    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Northwind SOW' } });
    expect(screen.getByRole('button', { name: 'Create agreement' }).hasAttribute('disabled')).toBe(false);
  });

  it('lets a failed read win over a stale account name', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Northwind Advisory in the field.
    renderDialog({
      data: list([company(ACCOUNT)]),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('accounts down'),
    });

    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expectNoEmptyChoice();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale name, and it must not look like no account.
    renderDialog({
      data: list([company(ACCOUNT)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('accounts down'),
    });

    expect(screen.queryByRole('option', { name: ACCOUNT })).toBeNull();
    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expectNoEmptyChoice();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('says the account is not in a settled null payload', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking. The id was already chosen,
    // so the field must not say Choose an account.
    renderDialog({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(MISSING)).toBeTruthy();
    expectNoEmptyChoice();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('says the account is not in a settled empty list', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed or that no account was chosen.
    renderDialog({
      data: list([]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(MISSING)).toBeTruthy();
    expectNoEmptyChoice();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not offer a different account when the chosen id is absent', () => {
    // WHY: the dialog is locked to one account. A settled list of other
    // companies is not a catalog to pick from, and it is not an empty choice.
    renderDialog({
      data: list([{ id: '22222222-2222-4222-8222-222222222222', name: OTHER, industry: 'Print' }]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(MISSING)).toBeTruthy();
    expect(screen.queryByText(OTHER)).toBeNull();
    expectNoEmptyChoice();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a loaded account name', () => {
    // WHY: a loaded name stays. The unread line must not replace a name the
    // read already returned, and the locked field must not offer a new choice.
    renderDialog({
      data: list([company(ACCOUNT)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('option', { name: ACCOUNT })).toBeTruthy();
    expectNoEmptyChoice();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a loaded name while a later read is in flight', () => {
    // WHY: a refetch with the name already in hand is not an unread pause.
    // The field must not drop the name or say the list has not arrived.
    renderDialog({
      data: list([company(ACCOUNT)]),
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('option', { name: ACCOUNT })).toBeTruthy();
    expectNoEmptyChoice();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded account with a blank industry', () => {
    // WHY: a blank industry is loaded data. Unread must not drop the name,
    // and the field must not invent an industry.
    renderDialog({
      data: list([company(ACCOUNT, null)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByRole('option', { name: ACCOUNT })).toBeTruthy();
    expect(screen.queryByText('Consulting')).toBeNull();
    expectNoEmptyChoice();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a loaded account with a blank name', () => {
    // WHY: a blank name is loaded data. Unread must not replace it with
    // Choose an account, and the field must not invent a name.
    renderDialog({
      data: list([company('')]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    const account = screen.getByText('Account').closest('label') as HTMLElement;
    expect((within(account).getByRole('combobox') as HTMLSelectElement).value).toBe(COMPANY_ID);
    expect(within(account).getAllByRole('option').some((option) => option.textContent === '')).toBe(true);
    expectNoEmptyChoice();
    expect(screen.queryByText(ACCOUNT)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  it('still offers a choice when no account is chosen and the list has arrived', () => {
    // WHY: a child agreement is the only surface here. A new agreement with
    // no account still offers Choose an account once the list has arrived.
    hookMocks.useCompanies.mockReturnValue({
      data: list([company(ACCOUNT)]),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });
    render(
      <UploadDialog open onOpenChange={() => undefined} target={{ mode: 'new' }} />,
    );

    expect(screen.getByRole('option', { name: PLACEHOLDER })).toBeTruthy();
    expect(screen.getByRole('option', { name: ACCOUNT })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  it('does not ask for an account name on a version upload', () => {
    // WHY: a new version already belongs to an agreement. There is no account
    // field, so a paused company read must not invent a name check.
    hookMocks.useCompanies.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });
    render(
      <UploadDialog
        open
        onOpenChange={() => undefined}
        target={{ mode: 'version', agreementId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Northwind MSA' }}
      />,
    );

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload version' })).toBeTruthy();
  });
});
