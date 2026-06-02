import { describe, expect, it } from 'vitest';

import {
  customObjectFieldEntityType,
  customObjectFieldEntityTypes,
} from './custom-object.helpers.js';

describe('custom object field namespaces', () => {
  it('uses a per-object entity namespace so multiple custom objects can share standard field keys', () => {
    const defId = '7fb7b596-9bfb-4b4f-9eb7-6d096a2f9868';

    expect(customObjectFieldEntityType(defId)).toBe(`CUSTOM_OBJECT:${defId}`);
    expect(customObjectFieldEntityTypes(defId)).toEqual([
      'CUSTOM_OBJECT',
      `CUSTOM_OBJECT:${defId}`,
    ]);
  });
});
