import { getAddress, parseAbi } from 'viem';
import type { Address, PublicClient, WalletClient } from 'viem';
import { isValidSecret, parseSendLink } from '@ferry/core';
import type { Hex32, SendLink, TxRef } from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import type { EvmChainAdapter } from './adapter.js';
import {
  ChainMismatchError,
  InvalidSecretError,
  UnsupportedAssetError,
} from './errors.js';
import { getSignerSendQueue } from './send-queue.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const erc20SendLinkAbi = parseAbi([
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external',
]);

const blocklistAbiCandidates = [
  parseAbi([
    'function isBlacklisted(address account) external view returns (bool)',
  ]),
  parseAbi([
    'function isBlackListed(address account) external view returns (bool)',
  ]),
  parseAbi(['function isFrozen(address account) external view returns (bool)']),
  parseAbi(['function frozen(address account) external view returns (bool)']),
] as const;

const blocklistFunctionNames = [
  'isBlacklisted',
  'isBlackListed',
  'isFrozen',
  'frozen',
] as const;

export type SendLinkRecipientFailureReason =
  'zero-address' | 'blocklisted' | 'token-not-found';

export class SendLinkRecipientError extends Error {
  constructor(
    readonly reason: SendLinkRecipientFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'SendLinkRecipientError';
  }
}

export interface RecipientTokenCheckResult {
  ok: boolean;
  reason?: SendLinkRecipientFailureReason | undefined;
  isContract: boolean;
  caveats: string[];
  message?: string | undefined;
}

export async function checkRecipientCanReceiveToken(params: {
  client: PublicClient;
  token: Address;
  recipient: Address;
}): Promise<RecipientTokenCheckResult> {
  const token = getAddress(params.token);
  const recipient = getAddress(params.recipient);
  const caveats: string[] = [];

  if (recipient.toLowerCase() === ZERO_ADDRESS) {
    return {
      ok: false,
      reason: 'zero-address',
      isContract: false,
      caveats,
      message: 'Recipient cannot be the zero address',
    };
  }

  const [tokenCode, recipientCode] = await Promise.all([
    params.client.getCode({ address: token }),
    params.client.getCode({ address: recipient }),
  ]);

  if (!tokenCode || tokenCode === '0x') {
    return {
      ok: false,
      reason: 'token-not-found',
      isContract: Boolean(recipientCode && recipientCode !== '0x'),
      caveats,
      message: `Token ${token} has no deployed code`,
    };
  }

  const isContract = Boolean(recipientCode && recipientCode !== '0x');
  if (isContract) {
    caveats.push(
      'Recipient is a contract address; verify it accepts ERC-20 transfers and supports ERC-1271 if signing intents',
    );
  }

  for (let i = 0; i < blocklistAbiCandidates.length; i++) {
    const abi = blocklistAbiCandidates[i]!;
    const fnName = blocklistFunctionNames[i]!;
    try {
      const blocked = await params.client.readContract({
        address: token,
        abi,
        functionName: fnName as never,
        args: [recipient],
      });
      if (blocked === true) {
        return {
          ok: false,
          reason: 'blocklisted',
          isContract,
          caveats,
          message: `Recipient ${recipient} is blocklisted/frozen on token ${token}`,
        };
      }
    } catch {
      // Token does not implement this optional blocklist/freeze view.
    }
  }

  return {
    ok: true,
    isContract,
    caveats,
  };
}

export interface LockSendLinkParams {
  adapter: EvmChainAdapter;
  sendLink: SendLink;
  hashLock: Hex32;
  /** Absolute Unix deadline in seconds (e.g. createdAt + windowSeconds). */
  deadlineSeconds?: number | undefined;
}

export interface LockSendLinkResult {
  lockId: Hex32;
  txRef: TxRef;
  deadline: number;
  isContractRecipient: boolean;
  caveats: string[];
}

export async function lockSendLink(
  params: LockSendLinkParams,
): Promise<LockSendLinkResult> {
  const sendLink = parseSendLink(params.sendLink);
  const { adapter, hashLock } = params;

  if (sendLink.destinationChainId !== adapter.chainId) {
    throw new ChainMismatchError(
      `SendLink destinationChainId ${sendLink.destinationChainId} does not match ${adapter.chainId}`,
    );
  }

  const token = getAddress(sendLink.token);
  const recipient = getAddress(sendLink.recipientAddress);
  const asset = adapter.assets.find(
    (a) => a.address.toLowerCase() === token.toLowerCase(),
  );
  if (!asset) {
    throw new UnsupportedAssetError(token, adapter.id);
  }

  const check = await checkRecipientCanReceiveToken({
    client: adapter.client,
    token,
    recipient,
  });
  if (!check.ok) {
    throw new SendLinkRecipientError(
      check.reason!,
      check.message ?? 'Recipient cannot receive token',
    );
  }

  const walletClient = adapter.walletClient;
  const signer = walletClient?.account;
  if (!walletClient || !signer) {
    throw new Error('WalletClient with account required to lock send link');
  }

  const deadline =
    params.deadlineSeconds ?? sendLink.createdAt + sendLink.windowSeconds;
  const lockId = adapter.lockId(signer.address, hashLock);
  const existing = await adapter.getLock(lockId);
  if (existing.status !== 'absent') {
    return {
      lockId,
      txRef: existing.lockTx,
      deadline: existing.deadline,
      isContractRecipient: check.isContract,
      caveats: check.caveats,
    };
  }

  const queue = getSignerSendQueue(signer.address);
  const hash = await queue.enqueue(async () => {
    const allowance = await adapter.client.readContract({
      address: token,
      abi: erc20SendLinkAbi,
      functionName: 'allowance',
      args: [signer.address, adapter.htlcAddress],
    });

    if (allowance < sendLink.amount) {
      const approveHash = await walletClient.writeContract({
        address: token,
        abi: erc20SendLinkAbi,
        functionName: 'approve',
        args: [adapter.htlcAddress, sendLink.amount],
        chain: null,
        account: signer,
      });
      const approveReceipt = await adapter.client.waitForTransactionReceipt({
        hash: approveHash,
      });
      if (approveReceipt.status !== 'success') {
        throw new Error(`Approve transaction ${approveHash} reverted`);
      }
    }

    const lockHash = await walletClient.writeContract({
      address: adapter.htlcAddress,
      abi: ferryHtlcAbi,
      functionName: 'lock',
      args: [token, recipient, sendLink.amount, hashLock, BigInt(deadline)],
      chain: null,
      account: signer,
    });
    const lockReceipt = await adapter.client.waitForTransactionReceipt({
      hash: lockHash,
    });
    if (lockReceipt.status !== 'success') {
      throw new Error(`Lock transaction ${lockHash} reverted`);
    }
    return lockHash;
  });

  return {
    lockId,
    txRef: { chain: adapter.id, txId: hash as Hex32 },
    deadline,
    isContractRecipient: check.isContract,
    caveats: check.caveats,
  };
}

export interface ClaimSendLinkParams {
  adapter: EvmChainAdapter;
  lockId: Hex32;
  secret: Hex32;
  /** When provided, the recipient self-pays the claim tx; otherwise the adapter/solver relays it. */
  recipientClient?: WalletClient | undefined;
}

export async function claimSendLink(
  params: ClaimSendLinkParams,
): Promise<TxRef> {
  const { adapter, lockId, secret, recipientClient } = params;

  if (!recipientClient) {
    return adapter.claim(lockId, secret);
  }

  const account = recipientClient.account;
  if (!account) {
    throw new Error('recipientClient must have an account for self-paid claim');
  }

  const currentLock = await adapter.getLock(lockId);
  if (currentLock.status === 'claimed') {
    return currentLock.claimTx;
  }
  if (currentLock.status !== 'locked') {
    throw new Error(`Cannot claim lock in state: ${currentLock.status}`);
  }
  if (!isValidSecret(secret, currentLock.hashLock)) {
    throw new InvalidSecretError(lockId);
  }

  const queue = getSignerSendQueue(account.address);
  const hash = await queue.enqueue(async () => {
    const claimHash = await recipientClient.writeContract({
      address: adapter.htlcAddress,
      abi: ferryHtlcAbi,
      functionName: 'claim',
      args: [lockId, secret],
      chain: null,
      account,
    });
    const receipt = await adapter.client.waitForTransactionReceipt({
      hash: claimHash,
    });
    if (receipt.status !== 'success') {
      throw new Error(`Claim transaction ${claimHash} reverted`);
    }
    return claimHash;
  });

  return { chain: adapter.id, txId: hash as Hex32 };
}
