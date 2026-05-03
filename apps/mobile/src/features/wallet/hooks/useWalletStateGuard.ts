import { useEffect, useRef } from 'react';
import { useAccount, useDisconnect } from 'wagmi';

const RECONCILE_DELAY_MS = 1500;

/**
 * AppKit and wagmi each persist their own session metadata. They can drift —
 * AppKit reports a session, wagmi reports disconnected — and the user gets
 * stuck: tapping Connect opens AppKit's connected-account sheet because
 * AppKit thinks it's connected, while HomeScreen renders the disconnected UI
 * because wagmi disagrees. Calling disconnect() reconciles by force-clearing
 * AppKit's storage. No-op for genuinely disconnected users (no connector to
 * disconnect), so it's safe to fire unconditionally after hydration settles.
 */
export function useWalletStateGuard(): void {
  const { status } = useAccount();
  const { disconnect } = useDisconnect();
  const reconciled = useRef(false);

  useEffect(() => {
    if (reconciled.current) return;
    if (status !== 'disconnected') {
      if (status === 'connected') reconciled.current = true;
      return;
    }
    const timer = setTimeout(() => {
      if (reconciled.current) return;
      reconciled.current = true;
      try { disconnect(); } catch { /* no-op for no-session case */ }
    }, RECONCILE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, disconnect]);
}
