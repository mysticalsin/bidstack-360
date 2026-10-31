// A person's photo as the API gives it: an external https URL, or the API's
// own photo path (auth required, so fetched as a blob). Initials otherwise.
import { useQuery } from '@tanstack/react-query';

import { buildApiUrl, getAuthToken } from '@/lib/api';
import { initials } from '@/lib/orgchart/tree';

// One object URL per photo path for the life of the page. The same photo shows
// in the node and the panel at once, so a per-component revoke would break the
// other copy (and the cached URL) as soon as one of them unmounts.
const objectUrls = new Map<string, string>();

export function OrgPhoto({ url, name }: { url: string | null | undefined; name: string }) {
  const apiPath = url && url.startsWith('/') ? url : null;
  const blob = useQuery({
    queryKey: ['orgchart-photo', apiPath],
    queryFn: async () => {
      const token = await getAuthToken();
      const res = await fetch(buildApiUrl(apiPath!), { headers: token ? { Authorization: `Bearer ${token}` } : undefined, credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const prev = objectUrls.get(apiPath!);
      if (prev) URL.revokeObjectURL(prev);
      const next = URL.createObjectURL(blob);
      objectUrls.set(apiPath!, next);
      return next;
    },
    enabled: Boolean(apiPath),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const src = apiPath ? blob.data : url && url.startsWith('https://') ? url : null;
  return src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{initials(name)}</span>;
}
