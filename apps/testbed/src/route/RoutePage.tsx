import { SystemPage } from '../common/SystemPage';

export function RoutePage() {
  return (
    <SystemPage
      name="Route Cache"
      endpoint="/api/route/ping"
      message="Route Cache testbed is not implemented yet."
    />
  );
}
