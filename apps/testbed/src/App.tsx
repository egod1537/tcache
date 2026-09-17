import { AiPage } from './ai/AiPage';
import { RoutePage } from './route/RoutePage';
import { StatusPage } from './StatusPage';

function HomePage() {
  return (
    <section className="hero">
      <p className="eyebrow">Shared cache infrastructure</p>
      <h1>tcache</h1>
      <p>
        Choose a system to inspect its testbed or view the current deployment.
      </p>
      <div className="cards">
        <a href="/route">
          Route Cache <span>Routing data cache →</span>
        </a>
        <a href="/ai">
          AI Cache <span>AI response cache →</span>
        </a>
        <a href="/status">
          Status <span>Deployment details →</span>
        </a>
      </div>
    </section>
  );
}

function CurrentPage() {
  switch (window.location.pathname.replace(/\/$/, '') || '/') {
    case '/route':
      return <RoutePage />;
    case '/ai':
      return <AiPage />;
    case '/status':
      return <StatusPage />;
    default:
      return <HomePage />;
  }
}

export function App() {
  return (
    <div className="shell">
      <header>
        <a className="brand" href="/">
          tcache
        </a>
        <nav aria-label="Main navigation">
          <a href="/route">Route</a>
          <a href="/ai">AI</a>
          <a href="/status">Status</a>
        </nav>
      </header>
      <main>
        <CurrentPage />
      </main>
      <footer>Trasolve cache infrastructure</footer>
    </div>
  );
}
