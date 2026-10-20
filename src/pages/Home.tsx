import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { Plus } from 'lucide-react';
import WalletBar from '../components/WalletBar';
import CircleCard from '../components/CircleCard';
import { useMyCircles } from '../hooks/useMyCircles';

interface Props {
  onNavigate: (path: string) => void;
}

export default function Home({ onNavigate }: Props) {
  const { address, isConnected } = useAccount();
  const myCircles = useMyCircles(address);

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--surface-strong)] backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="display text-lg font-bold text-[var(--ink)] tracking-tight">Savings Circle</h1>
            <p className="text-xs text-[var(--muted)]">ajo · tanda · susu</p>
          </div>
          <ConnectKitButton />
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {!isConnected ? (
          /* Hero / connect prompt */
          <div className="flex-1 flex flex-col items-center justify-center gap-6 py-16">
            <div className="w-16 h-16 rounded-3xl bg-[var(--accent)] flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="10" r="6" fill="white" fillOpacity="0.9"/>
                <circle cx="8" cy="22" r="4" fill="white" fillOpacity="0.6"/>
                <circle cx="24" cy="22" r="4" fill="white" fillOpacity="0.6"/>
                <line x1="16" y1="16" x2="8" y2="22" stroke="white" strokeWidth="1.5" strokeOpacity="0.5"/>
                <line x1="16" y1="16" x2="24" y2="22" stroke="white" strokeWidth="1.5" strokeOpacity="0.5"/>
              </svg>
            </div>
            <div className="text-center">
              <h2 className="display text-2xl font-bold text-[var(--ink)] mb-2" style={{ letterSpacing: '-0.03em' }}>
                Pool money.<br/>Trust the contract.
              </h2>
              <p className="text-[var(--muted)] text-sm max-w-xs mx-auto text-pretty">
                A rotating savings circle where the contract holds the money instead of a person. Everyone contributes each round; one member takes the pot.
              </p>
            </div>
            <ConnectKitButton label="Connect to get started" />
          </div>
        ) : (
          <>
            {/* Wallet balances */}
            <div className="rounded-2xl bg-[var(--surface-strong)] border border-[var(--border)] overflow-hidden">
              <WalletBar />
            </div>

            {/* My circles */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[var(--ink-2)] uppercase tracking-widest">My Circles</h2>
                <button
                  onClick={() => onNavigate('/create')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
                >
                  <Plus size={14} />
                  Create
                </button>
              </div>

              {myCircles.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-[var(--border)] p-8 text-center">
                  <p className="text-[var(--muted)] text-sm mb-3">You haven't joined any circles yet.</p>
                  <button
                    onClick={() => onNavigate('/create')}
                    className="text-sm font-semibold text-[var(--accent)] hover:underline"
                  >
                    Start a new circle
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {myCircles.map(id => (
                    <CircleCard key={String(id)} circleId={id} onClick={() => onNavigate(`/circle/${id}`)} />
                  ))}
                </div>
              )}
            </section>

            {/* Quick join by ID */}
            <section>
              <h2 className="text-sm font-semibold text-[var(--ink-2)] uppercase tracking-widest mb-3">Join a Circle</h2>
              <JoinById onNavigate={onNavigate} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function JoinById({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        const id = (e.currentTarget.elements.namedItem('circleId') as HTMLInputElement).value.trim();
        if (id) onNavigate(`/circle/${id}`);
      }}
      className="flex gap-2"
    >
      <input
        name="circleId"
        type="number"
        min="0"
        placeholder="Circle ID"
        className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--subtle)] focus:outline-none focus:border-[var(--focus)] tabular-nums"
      />
      <button
        type="submit"
        className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
      >
        Go
      </button>
    </form>
  );
}
