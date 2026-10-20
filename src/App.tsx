import { useState, useEffect } from 'react';
import Home from './pages/Home';
import CreateCircle from './pages/CreateCircle';
import CirclePage from './pages/CirclePage';
import MemberProfile from './pages/MemberProfile';
import { CONTRACT_ADDRESS } from './appConfig';

type Route =
  | { page: 'home' }
  | { page: 'create' }
  | { page: 'circle'; id: bigint }
  | { page: 'member'; address: string };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const circleMatch = path.match(/^\/circle\/(\d+)$/);
  if (circleMatch) return { page: 'circle', id: BigInt(circleMatch[1]) };
  const memberMatch = path.match(/^\/member\/(0x[0-9a-fA-F]{40})$/i);
  if (memberMatch) return { page: 'member', address: memberMatch[1] };
  if (path === '/create') return { page: 'create' };
  return { page: 'home' };
}

function routeToHash(path: string): string {
  return '#' + path;
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    function onHashChange() {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function navigate(path: string | number) {
    if (typeof path === 'number') {
      // -1 means go back
      window.history.back();
      return;
    }
    window.location.hash = routeToHash(path);
    setRoute(parseHash(routeToHash(path)));
  }

  if (!CONTRACT_ADDRESS) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6" style={{ background: 'var(--bg-gradient)' }}>
        <div className="max-w-sm text-center">
          <h1 className="display text-xl font-bold text-[var(--ink)] mb-2">Contract not deployed</h1>
          <p className="text-sm text-[var(--muted)]">
            The contract address is empty. Deploy <code className="font-mono bg-[var(--surface-muted)] px-1 rounded">SavingsCircles</code> to Arc Testnet and update <code className="font-mono bg-[var(--surface-muted)] px-1 rounded">CONTRACT_ADDRESS</code> in <code className="font-mono bg-[var(--surface-muted)] px-1 rounded">src/appConfig.ts</code>.
          </p>
        </div>
      </div>
    );
  }

  switch (route.page) {
    case 'create':
      return <CreateCircle onNavigate={navigate} />;
    case 'circle':
      return <CirclePage circleId={route.id} onNavigate={navigate} />;
    case 'member':
      return <MemberProfile address={route.address} onNavigate={navigate} />;
    default:
      return <Home onNavigate={navigate} />;
  }
}
