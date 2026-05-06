import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useChainId, useSwitchChain } from 'wagmi';
import { useOpenWallet } from '../hooks/useOpenWallet';
import { useEnsName } from '../hooks/useEnsName';
import { useTrackedExternalAddresses } from '../hooks/useTrackedExternalAddresses';
import { VERIFICATION_REGISTRY_ABI } from '../../../infrastructure/blockchain/contractAbis';
import { CONTRACT_ADDRESSES } from '../../../infrastructure/blockchain/contracts';
import { SUPPORTED_CHAIN_IDS } from '../../../shared/constants/chains';
import type { SupportedChainId } from '../../../shared/constants/chains';
import type { TrackedAccount } from '../hooks/useTrackedAccounts';
import type { RegistrationMode } from '../../../app/navigation/types';

// LayoutAnimation needs explicit opt-in on Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const RENEW_WINDOW_SEC = 30 * 24 * 60 * 60;

type AccountState = 'unsigilized' | 'healthy' | 'renewable' | 'expired';

function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

function computeState(account: TrackedAccount, nowSec: number): AccountState {
  if (account.isVerified) {
    const expirySec = account.expiry ? Number(account.expiry) : 0;
    return expirySec - nowSec <= RENEW_WINDOW_SEC ? 'renewable' : 'healthy';
  }
  // Not verified: distinguish never-registered vs expired-registration.
  return account.expiry && account.expiry > 0n ? 'expired' : 'unsigilized';
}

/** Days until expiry (0 if already passed). */
function daysUntil(timestampSec: number, nowSec: number): number {
  return Math.max(0, Math.ceil((timestampSec - nowSec) / 86400));
}

/** "Apr 28, 2027" formatting for the expiry date. */
function formatDate(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface Props {
  account: TrackedAccount;
  /** Other tracked addresses already linked to a passport. */
  linkedSiblings: TrackedAccount[];
  /** True when this is the wallet's currently-active address. */
  isActive: boolean;
  /** Navigate to the scan flow for register / re-register / renew. */
  onSigilize: (address: `0x${string}`, mode: RegistrationMode) => void;
  onUnregistered: () => void;
}

export function AccountRow({ account, linkedSiblings, isActive, onSigilize, onUnregistered }: Props): React.JSX.Element {
  const { address: activeAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const openWallet = useOpenWallet();
  const ensName = useEnsName(account.address);
  const { remove: removeExternal } = useTrackedExternalAddresses();

  const [expanded, setExpanded] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [pendingUnregister, setPendingUnregister] = useState(false);
  const nowSec = Math.floor(Date.now() / 1000);

  const state = computeState(account, nowSec);
  const expirySec = account.expiry ? Number(account.expiry) : 0;
  const linkedSiblingCount = linkedSiblings.filter((s) =>
    account.nullifier && s.nullifier === account.nullifier && s.address.toLowerCase() !== account.address.toLowerCase(),
  ).length;

  const { isSuccess: isConfirmed, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    pollingInterval: 1000,
  });

  useEffect(() => {
    if (isConfirmed && txHash) onUnregistered();
  }, [isConfirmed, txHash, onUnregistered]);

  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((p) => !p);
  }, []);

  const contractAddress = isSupportedChain(chainId)
    ? CONTRACT_ADDRESSES[chainId].verificationRegistry
    : null;

  const submitUnregister = useCallback(async () => {
    if (!contractAddress || !isSupportedChain(chainId)) return;
    try {
      await switchChainAsync({ chainId });
    } catch (switchErr) {
      const e = switchErr as { code?: number };
      const msg = e.code === 4001
        ? 'Network switch declined. Approve in your wallet and retry.'
        : e.code === 4902
        ? 'Add this network to your wallet first, then retry.'
        : 'Could not switch wallet to the right network.';
      Alert.alert('Network', msg);
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: VERIFICATION_REGISTRY_ABI,
        functionName: 'unregister',
        chainId,
      });
      setTxHash(hash);
    } catch {
      Alert.alert('Error', 'Transaction failed. Please try again.');
    }
  }, [contractAddress, chainId, switchChainAsync, writeContractAsync]);

  const promptUnregisterConfirm = useCallback(() => {
    const label = ensName ?? account.shortAddress;
    Alert.alert(
      'Unregister',
      `Remove sigil from ${label}? This wallet will no longer be linked to your passport on-chain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unregister', style: 'destructive', onPress: submitUnregister },
      ],
    );
  }, [ensName, account.shortAddress, submitUnregister]);

  /** If the account isn't active in the wallet, prompt the user to switch first. */
  const requireActiveThen = useCallback((then: () => void) => {
    if (activeAddress?.toLowerCase() === account.address.toLowerCase()) {
      then();
      return;
    }
    setPendingUnregister(true); // re-used flag for either flow; cleared on activation
    Alert.alert(
      'Switch Account',
      `Switch your active wallet account to ${ensName ?? account.shortAddress} to continue.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPendingUnregister(false) },
        { text: 'Open Wallet', onPress: () => openWallet() },
      ],
    );
  }, [activeAddress, account.address, ensName, account.shortAddress, openWallet]);

  const handleUnregister = useCallback(() => {
    requireActiveThen(promptUnregisterConfirm);
  }, [requireActiveThen, promptUnregisterConfirm]);

  // When wallet finally switches to the pending account, run the queued action.
  useEffect(() => {
    if (pendingUnregister && activeAddress?.toLowerCase() === account.address.toLowerCase()) {
      setPendingUnregister(false);
      promptUnregisterConfirm();
    }
  }, [activeAddress, account.address, pendingUnregister, promptUnregisterConfirm]);

  const handleSigilize = useCallback(() => onSigilize(account.address, 'register'), [account.address, onSigilize]);
  const handleReSigilize = useCallback(() => onSigilize(account.address, 'register'), [account.address, onSigilize]);
  const handleRenew = useCallback(() => onSigilize(account.address, 'renew'), [account.address, onSigilize]);

  const handleStopTracking = useCallback(() => {
    Alert.alert(
      'Stop tracking?',
      `Remove ${ensName ?? account.shortAddress} from your accounts list. This does not change anything on-chain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop tracking',
          style: 'destructive',
          onPress: () => { void removeExternal(account.address); onUnregistered(); },
        },
      ],
    );
  }, [account.address, account.shortAddress, ensName, removeExternal, onUnregistered]);

  const displayName = ensName ?? account.shortAddress;
  const showSubAddress = ensName !== null;
  const isExternal = !account.isInWallet;

  return (
    <View
      className={`rounded-2xl ${
        isActive
          ? 'bg-dracula-surface border border-dracula-purple/60'
          : isExternal
          ? 'bg-dracula-surface/60 border border-dracula-comment/20'
          : 'bg-dracula-surface'
      }`}
    >
      {/* Header — always visible, tappable to toggle */}
      <Pressable onPress={toggleExpanded} className="px-4 py-3 flex-row items-center">
        {isActive && <View className="w-2 h-2 rounded-full bg-dracula-green mr-2.5" />}
        <View className="flex-1 min-w-0">
          <Text
            className={`text-sm font-semibold ${isExternal ? 'text-dracula-fg/70' : 'text-dracula-fg'}`}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {showSubAddress && (
            <Text className="text-dracula-comment/60 text-[11px] font-mono mt-0.5" numberOfLines={1}>
              {account.shortAddress}
            </Text>
          )}
        </View>
        {account.isStatusLoading ? (
          <LoadingChip />
        ) : (
          <StatusChip state={state} expirySec={expirySec} nowSec={nowSec} compact={!expanded} />
        )}
        <View
          style={{
            marginLeft: 10,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: 'rgba(98,114,164,0.25)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#f8f8f2', fontSize: 14, lineHeight: 16, fontWeight: '700' }}>
            {expanded ? '▾' : '▸'}
          </Text>
        </View>
      </Pressable>

      {expanded && (
        <View className="px-4 pb-4 pt-0 gap-y-3">
          {account.isStatusLoading ? (
            <View className="flex-row items-center justify-center py-3 gap-x-2">
              <ActivityIndicator size="small" color="#6272a4" />
              <Text className="text-dracula-comment text-xs">Loading status…</Text>
            </View>
          ) : (
            <>
              <ExpandedDetail state={state} expirySec={expirySec} nowSec={nowSec} />

              {linkedSiblingCount > 0 && (
                <Text className="text-dracula-comment/60 text-xs">
                  Linked to {linkedSiblingCount} other sigilized {linkedSiblingCount === 1 ? 'wallet' : 'wallets'} on-chain.
                </Text>
              )}

              {isExternal && (
                <View className="bg-dracula-bg/40 rounded-xl px-3 py-2.5 gap-y-1">
                  <Text className="text-dracula-comment text-xs font-semibold">
                    Not in connected wallet
                  </Text>
                  <Text className="text-dracula-comment/70 text-xs leading-4">
                    You're tracking this address from a passport-recovery scan. Connect the wallet
                    that holds it to sigilize, renew, or unregister.
                  </Text>
                </View>
              )}

              {isConfirming ? (
                <View className="flex-row items-center justify-center py-3 gap-x-2">
                  <ActivityIndicator size="small" color="#bd93f9" />
                  <Text className="text-dracula-comment text-sm">Submitting…</Text>
                </View>
              ) : isExternal ? (
                <DestructiveButton label="Stop tracking" onPress={handleStopTracking} />
              ) : (
                <Actions
                  state={state}
                  onSigilize={handleSigilize}
                  onReSigilize={handleReSigilize}
                  onRenew={handleRenew}
                  onUnregister={handleUnregister}
                />
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Status chip — compact summary shown in the header
// ---------------------------------------------------------------------------

/** Placeholder chip while on-chain status is being fetched. */
function LoadingChip(): React.JSX.Element {
  return (
    <View
      style={{
        backgroundColor: 'rgba(98,114,164,0.20)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <ActivityIndicator size="small" color="#8a92b2" />
      <Text style={{ color: '#8a92b2', fontSize: 11, fontWeight: '600' }}>Loading…</Text>
    </View>
  );
}

function StatusChip({ state, expirySec, nowSec, compact }: { state: AccountState; expirySec: number; nowSec: number; compact: boolean }): React.JSX.Element {
  const tone = STATE_TONE[state];
  let label: string;
  switch (state) {
    case 'unsigilized': label = 'Not sigilized'; break;
    case 'healthy':     label = compact ? 'Sigilized' : `${daysUntil(expirySec, nowSec)} days left`; break;
    case 'renewable':   label = compact ? 'Renew soon' : `${daysUntil(expirySec, nowSec)} days left`; break;
    case 'expired':     label = 'Expired'; break;
  }
  return (
    <View
      style={{
        backgroundColor: tone.bg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      <Text style={{ color: tone.fg, fontSize: 11, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Expanded detail — fuller status sentence within the open card
// ---------------------------------------------------------------------------

function ExpandedDetail({ state, expirySec, nowSec }: { state: AccountState; expirySec: number; nowSec: number }): React.JSX.Element {
  if (state === 'unsigilized') {
    return (
      <Text className="text-dracula-comment text-sm leading-5">
        This wallet has not been sigilized. Sigilizing links it to your passport identity on-chain.
      </Text>
    );
  }
  if (state === 'expired') {
    return (
      <Text className="text-dracula-comment text-sm leading-5">
        Sigil expired on {formatDate(expirySec)}. Re-sigilize to restore protocol access.
      </Text>
    );
  }
  if (state === 'renewable') {
    const days = daysUntil(expirySec, nowSec);
    return (
      <Text className="text-dracula-orange text-sm leading-5">
        Sigil expires in {days} {days === 1 ? 'day' : 'days'} ({formatDate(expirySec)}). Renew to extend.
      </Text>
    );
  }
  // healthy
  return (
    <Text className="text-dracula-comment text-sm leading-5">
      Sigilized · expires {formatDate(expirySec)} ({daysUntil(expirySec, nowSec)} days left).
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Action buttons — set is fully determined by state.
// ---------------------------------------------------------------------------

interface ActionsProps {
  state: AccountState;
  onSigilize: () => void;
  onReSigilize: () => void;
  onRenew: () => void;
  onUnregister: () => void;
}

function Actions({ state, onSigilize, onReSigilize, onRenew, onUnregister }: ActionsProps): React.JSX.Element {
  if (state === 'unsigilized') {
    return <PrimaryButton label="Sigilize" onPress={onSigilize} />;
  }
  if (state === 'healthy') {
    return <DestructiveButton label="Unregister" onPress={onUnregister} />;
  }
  if (state === 'renewable') {
    return (
      <View className="flex-row gap-x-2">
        <View className="flex-1">
          <PrimaryButton label="Renew" onPress={onRenew} />
        </View>
        <View className="flex-1">
          <DestructiveButton label="Unregister" onPress={onUnregister} />
        </View>
      </View>
    );
  }
  // expired
  return (
    <View className="flex-row gap-x-2">
      <View className="flex-1">
        <PrimaryButton label="Re-sigilize" onPress={onReSigilize} />
      </View>
      <View className="flex-1">
        <DestructiveButton label="Unregister" onPress={onUnregister} />
      </View>
    </View>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-xl py-3 items-center bg-dracula-purple active:bg-dracula-purple/80"
    >
      <Text className="text-dracula-fg text-sm font-semibold">{label}</Text>
    </Pressable>
  );
}

function DestructiveButton({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-xl py-3 items-center border border-dracula-red/50 active:bg-dracula-red/10"
    >
      <Text className="text-dracula-red text-sm font-semibold">{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Tone palette
// ---------------------------------------------------------------------------

const STATE_TONE: Record<AccountState, { bg: string; fg: string }> = {
  unsigilized: { bg: 'rgba(98,114,164,0.20)',  fg: '#c8cad6' }, // muted
  healthy:     { bg: 'rgba(80,250,123,0.18)',  fg: '#50fa7b' }, // green
  renewable:   { bg: 'rgba(255,184,108,0.20)', fg: '#ffb86c' }, // orange / warn
  expired:     { bg: 'rgba(255,85,85,0.20)',   fg: '#ff5555' }, // red
};
