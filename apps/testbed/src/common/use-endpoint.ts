import { useEffect, useState } from 'react';

interface EndpointState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useEndpoint<T>(url: string): EndpointState<T> {
  const [state, setState] = useState<EndpointState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        setState({
          data: (await response.json()) as T,
          error: null,
          loading: false,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setState({
          data: null,
          error: error instanceof Error ? error.message : 'Unknown error',
          loading: false,
        });
      }
    }

    void load();
    return () => controller.abort();
  }, [url]);

  return state;
}
