import { RouteAnalyticsPanel } from '../RouteAnalyticsPanel';

interface RouteAnalyticsPageProps {
  onSelectJob: (jobId: string) => void;
}

export function RouteAnalyticsPage({ onSelectJob }: RouteAnalyticsPageProps) {
  return <RouteAnalyticsPanel onSelectJob={onSelectJob} />;
}
