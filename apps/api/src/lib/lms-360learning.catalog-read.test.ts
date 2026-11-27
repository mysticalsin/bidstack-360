import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({
  getEnv: () => ({
    LMS_360L_ENABLED: 'true',
    LMS_360L_BASE_URL: 'https://lms.example.test',
    LMS_360L_API_KEY: 'synthetic-lms-key',
  }),
}));

import { fetchLmsCourses, LmsError } from './lms-360learning.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const COURSE = {
  _id: 'course-bid-writing',
  name: 'Bid writing clinic',
  description: 'A synthetic course for the catalog read.',
  tags: ['Banking'],
  publicUrl: 'https://academy.example.test/bid-writing',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('live toolkit catalog read', () => {
  it('does not call a non-list catalog body an empty course list', async () => {
    // WHY: a wrapped or failed LMS body is not a settled empty catalog.
    // The parser coerced that body to [] so the page said no courses
    // were published. The payload is not a course list, so the catalog
    // has not arrived.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          courses: [COURSE],
        }),
      ),
    );

    const read = fetchLmsCourses();
    await expect(read).rejects.toBeInstanceOf(LmsError);
    await expect(read).rejects.toThrow('LMS returned an unexpected payload shape');
  });

  it('still returns a settled empty catalog', async () => {
    // WHY: a real empty list is a miss. That stays empty so a failed
    // read is not the only way the catalog can be quiet.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));

    await expect(fetchLmsCourses()).resolves.toEqual([]);
  });

  it('still returns a course that arrived as a list', async () => {
    // WHY: a bare course list is the catalog. The shape check must not
    // turn a real row into an error.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([COURSE])));

    await expect(fetchLmsCourses()).resolves.toEqual([
      {
        id: 'course-bid-writing',
        title: 'Bid writing clinic',
        description: 'A synthetic course for the catalog read.',
        sectorTags: ['Banking'],
        url: 'https://academy.example.test/bid-writing',
      },
    ]);
  });
});
