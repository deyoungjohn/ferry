import type { SendLinkData } from '../paylink/link';

export function getLinkStatusRank(link: SendLinkData): number {
  if (link.status === 'claimed' || link.lockStatus === 'claimed') return 4;
  if (link.status === 'expired' || link.lockStatus === 'expired') return 3;
  if (link.lockStatus === 'locked') return 2;
  if (link.lockStatus === 'pending_lock') return 1;
  return 0;
}

export function mergeTwoLinks(
  existing: SendLinkData,
  incoming: SendLinkData,
): SendLinkData {
  const rankExisting = getLinkStatusRank(existing);
  const rankIncoming = getLinkStatusRank(incoming);

  let winner: SendLinkData;
  let loser: SendLinkData;

  if (rankIncoming > rankExisting) {
    winner = incoming;
    loser = existing;
  } else if (rankExisting > rankIncoming) {
    winner = existing;
    loser = incoming;
  } else {
    // If status rank is equal, newer createdAt wins
    const timeExisting = existing.createdAt ?? 0;
    const timeIncoming = incoming.createdAt ?? 0;
    if (timeIncoming >= timeExisting) {
      winner = incoming;
      loser = existing;
    } else {
      winner = existing;
      loser = incoming;
    }
  }

  return {
    ...loser,
    ...winner,
    secret: winner.secret ?? loser.secret,
    orderId: winner.orderId ?? loser.orderId,
    recoveryJson: winner.recoveryJson ?? loser.recoveryJson,
    txId: winner.txId ?? loser.txId,
    refundDate: winner.refundDate ?? loser.refundDate,
    note: winner.note ?? loser.note,
  };
}

/**
 * Merges incoming send links into existing send links by ID.
 * The newer status wins; nothing is deleted.
 * Returns the merged list sorted newest first.
 */
export function mergeSendLinks(
  existing: SendLinkData[],
  incoming: SendLinkData[],
): SendLinkData[] {
  const byId = new Map<string, SendLinkData>();

  for (const link of existing) {
    if (link.id) {
      byId.set(link.id, link);
    }
  }

  for (const link of incoming) {
    if (!link.id) continue;
    const current = byId.get(link.id);
    if (!current) {
      byId.set(link.id, link);
    } else {
      byId.set(link.id, mergeTwoLinks(current, link));
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
  );
}
