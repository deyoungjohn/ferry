import { sha256 } from '@bitauth/libauth';
import { encodeHtlcParameters } from '../src/contract.js';
import { buildXoLockInvitation } from '../xo/index.js';

const sampleSecret = new Uint8Array(32).fill(0x01);
const hashLock = sha256.hash(sampleSecret);
const recipientLockingBytecode = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0x11),
  0x88,
  0xac,
]);
const refundLockingBytecode = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0x22),
  0x88,
  0xac,
]);

const params = encodeHtlcParameters({
  hashLock,
  recipientLockingBytecode,
  refundLockingBytecode,
  tokenCategory:
    'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
  tokenAmount: 1000n,
  refundHeight: 500_000,
  maxFee: 1500n,
});

const network = process.argv.includes('--mainnet') ? 'mainnet' : 'chipnet';
const invitation = buildXoLockInvitation(params, network);

console.log(`Lock address: ${invitation.lockAddress}`);
console.log(`Token address: ${invitation.tokenAddress}`);
console.log(`Locking bytecode: ${invitation.lockingBytecode}`);
console.log(JSON.stringify(invitation, null, 2));
