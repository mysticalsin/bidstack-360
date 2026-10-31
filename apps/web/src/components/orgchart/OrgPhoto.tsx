// A person's photo as the API gives it: an external https URL, or the API's
// own photo path (auth required, so fetched as a blob). Initials otherwise.
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { buildApiUrl, getAuthToken } from '@/lib/api';
import { initials } from '@/lib/orgchart/tree';

export function OrgPhoto({ url, name }: { url: string | null | undefined; name: string }) {
  const apiPath = url && url.startsWith('/') ? url : null;
  const blob = useQuery({
    queryKey: ['orgchart-photo', apiPath],
    queryFn: async () => {
      const token = await getAuthToken();
      const res = await fetch(buildApiUrl(apiPath!), { headers: token ? { Authorization: `Bearer ${token}` } : undefined, credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      return URL.createObjectURL(await res.blob());
    },
    enabled: Boolean(apiPath),
    staleTime: 5 * 60_000,
    retry: false,
  });
  useEffect(() => () => { if (blob.data) URL.revokeObjectURL(blob.data); }, [blob.data]);
  const src = apiPath ? blob.data : url && url.startsWith('https://') ? url : null;
  return src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{initials(name)}</span>;
}
