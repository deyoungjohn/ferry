/**
 * Serialises transactions per signer so each transaction is sent and mined
 * before the next one is built, preventing nonce collisions across concurrent
 * lock, claim, refund, and relayLock calls.
 */
export class SendQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

const queuesBySigner = new Map<string, SendQueue>();

export function getSignerSendQueue(signerAddress: string): SendQueue {
  const key = signerAddress.toLowerCase();
  let queue = queuesBySigner.get(key);
  if (!queue) {
    queue = new SendQueue();
    queuesBySigner.set(key, queue);
  }
  return queue;
}
