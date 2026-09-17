import { SystemPage } from '../common/SystemPage';

export function AiPage() {
  return (
    <SystemPage
      name="AI Cache"
      endpoint="/api/ai/ping"
      message="AI Cache testbed is not implemented yet."
    />
  );
}
