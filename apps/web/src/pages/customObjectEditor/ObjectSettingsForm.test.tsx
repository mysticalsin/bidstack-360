// The settings form copies labels into its own state on first paint and
// then ignores the next object. CustomObjectEditorPage stays mounted when
// /settings/custom-objects/:id changes, and Save posts that state to the id
// in the URL. A second synthetic object must replace the copy, or the demo
// writes the previous object's labels onto it.
import { type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObjectSettingsForm } from './ObjectSettingsForm';

type UpdateDef = ComponentProps<typeof ObjectSettingsForm>['updateDef'];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

const vendor = {
  key: 'vendor_sample',
  labelSingular: 'Sample Vendor',
  labelPlural: 'Sample Vendors',
  description: 'Synthetic vendor file',
  color: '#6366f1',
};

const asset = {
  key: 'asset_sample',
  labelSingular: 'Sample Asset',
  labelPlural: 'Sample Assets',
  description: 'Synthetic asset file',
  color: '#10b981',
};

function mutation() {
  return {
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  };
}

function renderForm(
  def: typeof vendor,
  updateDef: ReturnType<typeof mutation>,
) {
  return render(
    <ObjectSettingsForm
      def={def}
      updateDef={updateDef as unknown as UpdateDef}
    />,
  );
}

describe('ObjectSettingsForm: editor follows the object in the URL', () => {
  afterEach(() => cleanup());

  it('replaces a typed draft when the page opens a different synthetic object', () => {
    const updateDef = mutation();
    const view = renderForm(vendor, updateDef);

    fireEvent.change(screen.getByRole('textbox', { name: 'Singular label' }), {
      target: { value: 'Not the asset' },
    });

    view.rerender(
      <ObjectSettingsForm
        def={asset}
        updateDef={updateDef as unknown as UpdateDef}
      />,
    );

    // The immutable key already follows the URL. The editable copy must too.
    expect(screen.getByText('asset_sample')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Singular label' }) as HTMLInputElement).value).toBe(
      'Sample Asset',
    );
    expect((screen.getByRole('textbox', { name: 'Plural label' }) as HTMLInputElement).value).toBe(
      'Sample Assets',
    );
    expect((screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value).toBe(
      'Synthetic asset file',
    );
    expect(
      screen.getByRole('button', { name: 'Select color #10b981' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('saves the object in the URL, not the draft left by the previous one', async () => {
    const first = mutation();
    const second = mutation();
    const view = renderForm(vendor, first);

    fireEvent.change(screen.getByRole('textbox', { name: 'Singular label' }), {
      target: { value: 'Not the asset' },
    });

    view.rerender(
      <ObjectSettingsForm
        def={asset}
        updateDef={second as unknown as UpdateDef}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    });

    expect(first.mutateAsync).not.toHaveBeenCalled();
    expect(second.mutateAsync).toHaveBeenCalledWith({
      labelSingular: 'Sample Asset',
      labelPlural: 'Sample Assets',
      description: 'Synthetic asset file',
      color: '#10b981',
    });
  });

  it('keeps an in-progress edit when the same object renders again', () => {
    const updateDef = mutation();
    const view = renderForm(vendor, updateDef);

    fireEvent.change(screen.getByRole('textbox', { name: 'Singular label' }), {
      target: { value: 'Sample Vendor file' },
    });

    view.rerender(
      <ObjectSettingsForm
        def={{ ...vendor }}
        updateDef={updateDef as unknown as UpdateDef}
      />,
    );

    expect((screen.getByRole('textbox', { name: 'Singular label' }) as HTMLInputElement).value).toBe(
      'Sample Vendor file',
    );
  });
});
