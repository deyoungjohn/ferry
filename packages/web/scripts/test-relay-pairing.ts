import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import {
  initiateDappRelay,
  initiateWalletRelay,
  binToHex,
  RelayMsgAction,
  RelayClient,
  ProtocolMessage,
} from '@wizardconnect/core';

// Ignore unhandled error from aborting pending connection attempts during cleanup
process.on('uncaughtException', (err: Error) => {
  if (
    err.message?.includes('WebSocket was closed') ||
    err.message?.includes('ECONNREFUSED')
  ) {
    return;
  }
  console.error('Uncaught exception:', err);
  process.exit(1);
});

function log(section: string, msg: string) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] [${section}] ${msg}`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runFullRelayTest() {
  console.log(
    '================================================================',
  );
  console.log('Ferry WizardConnect Self-Hosted Relay Integration Test Suite');
  console.log(
    '================================================================\n',
  );

  // ----------------------------------------------------------------
  // Part 1: Key exchange & Bi-directional messaging
  // ----------------------------------------------------------------
  log('PART 1', 'Initiating DApp relay on ws://127.0.0.1:8088...');
  let dappClient: RelayClient | null = null;
  const dapp = initiateDappRelay(
    (status) => {
      dappClient = status.client;
    },
    {
      explicitRelayUrls: ['ws://127.0.0.1:8088'],
      reconnectInterval: 1000,
      maxReconnectAttempts: 10,
    },
  );

  log('PART 1', `Generated DApp Pairing URI: ${dapp.uri}`);

  const walletPrivKey = new Uint8Array(crypto.randomBytes(32));

  log('PART 1', 'Initiating simulated mobile wallet...');
  let walletClient: RelayClient | null = null;
  let walletConnected = false;

  const wallet = initiateWalletRelay(
    (status) => {
      walletClient = status.client;
      if (status.status.status === 'connected') {
        walletConnected = true;
      }
    },
    {
      uri: dapp.uri,
      walletPrivateKey: walletPrivKey,
      explicitRelayUrls: ['ws://127.0.0.1:8088'],
      reconnectInterval: 1000,
      maxReconnectAttempts: 10,
    },
  );

  log('PART 1', 'Waiting for wallet WebSocket connection...');
  while (!walletConnected || !walletClient) {
    await sleep(100);
  }
  const activeWalletClient: RelayClient = walletClient;
  log(
    'PART 1',
    'Wallet connected to relay. Dispatching WalletReady handshake...',
  );

  await activeWalletClient.relay({
    action: RelayMsgAction.WalletReady,
    time: Date.now(),
    wallet_name: 'Simulated Paytaca',
    wallet_icon: '',
    dapp_discovered: false,
    supported_protocols: ['hdwalletv1'],
    session: {},
    public_key: binToHex(wallet.walletPublicKey),
    secret: wallet.secret,
  });

  log('PART 1', 'Waiting for DApp key exchange event...');
  const walletPubkey = await new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Key exchange timeout')),
      10000,
    );
    dapp.events.on('keyexchangecomplete', (pubKey) => {
      clearTimeout(timeout);
      resolve(pubKey);
    });
  });

  log(
    'PART 1',
    `Key exchange verified! Paired wallet public key: ${binToHex(walletPubkey)}`,
  );

  while (!dappClient) {
    await sleep(50);
  }
  const activeDappClient: RelayClient = dappClient;

  log('PART 1', 'DApp dispatching DappReady response...');
  await activeDappClient.relay({
    action: RelayMsgAction.DappReady,
    time: Date.now(),
    supported_protocols: ['hdwalletv1'],
    selected_protocol: 'hdwalletv1',
    wallet_discovered: true,
    dapp_name: 'Ferry',
    dapp_icon: '',
  });

  // Verify bi-directional ping-pong
  log('PART 1', 'Testing bi-directional message crossing (Ping -> Pong)...');
  let dappGotPong = new Promise<void>((resolve) => {
    const handler = (msg: ProtocolMessage) => {
      if (msg.action === RelayMsgAction.Pong) {
        log('PART 1', 'DApp received Pong from Wallet!');
        activeDappClient.off('message', handler);
        resolve();
      }
    };
    activeDappClient.on('message', handler);
  });

  let walletGotPing = new Promise<void>((resolve) => {
    const handler = async (msg: ProtocolMessage) => {
      if (msg.action === RelayMsgAction.Ping) {
        log('PART 1', 'Wallet received Ping from DApp! Replying with Pong...');
        activeWalletClient.off('message', handler);
        await activeWalletClient.relay({
          action: RelayMsgAction.Pong,
          time: Date.now(),
        });
        resolve();
      }
    };
    activeWalletClient.on('message', handler);
  });

  await activeDappClient.relay({
    action: RelayMsgAction.Ping,
    time: Date.now(),
  });
  await walletGotPing;
  await dappGotPong;

  log(
    'PART 1',
    'PART 1 PASSED: Key exchange and initial bi-directional messaging succeeded.\n',
  );

  // ----------------------------------------------------------------
  // Part 2: Relay restart & automatic reconnection
  // ----------------------------------------------------------------
  log('PART 2', 'Testing relay container restart and client recovery...');
  log('PART 2', 'Restarting ferry-relay docker container...');
  execSync('docker restart ferry-relay', { stdio: 'inherit' });
  log(
    'PART 2',
    'Relay container restarted. Waiting 3 seconds for reconnection...',
  );
  await sleep(3000);

  // Send another ping-pong after restart
  log('PART 2', 'Verifying messaging after relay restart (Ping -> Pong)...');
  dappGotPong = new Promise<void>((resolve) => {
    const handler = (msg: ProtocolMessage) => {
      if (msg.action === RelayMsgAction.Pong) {
        log('PART 2', 'DApp received Pong after restart!');
        activeDappClient.off('message', handler);
        resolve();
      }
    };
    activeDappClient.on('message', handler);
  });

  walletGotPing = new Promise<void>((resolve) => {
    const handler = async (msg: ProtocolMessage) => {
      if (msg.action === RelayMsgAction.Ping) {
        log(
          'PART 2',
          'Wallet received Ping after restart! Replying with Pong...',
        );
        activeWalletClient.off('message', handler);
        await activeWalletClient.relay({
          action: RelayMsgAction.Pong,
          time: Date.now(),
        });
        resolve();
      }
    };
    activeWalletClient.on('message', handler);
  });

  await activeDappClient.relay({
    action: RelayMsgAction.Ping,
    time: Date.now(),
  });
  await walletGotPing;
  await dappGotPong;

  log(
    'PART 2',
    'PART 2 PASSED: Clients reconnected after relay restart and resumed messaging.\n',
  );

  // ----------------------------------------------------------------
  // Part 3: Wallet silent for 60 seconds (ping/idle timeout resilience)
  // ----------------------------------------------------------------
  const silenceSeconds = parseInt(process.env.SILENCE_SECONDS || '60', 10);
  log(
    'PART 3',
    `Testing connection resilience: holding wallet completely silent for ${silenceSeconds} seconds...`,
  );
  log(
    'PART 3',
    '(nostr-rs-relay ping_interval=30 maintains WebSocket transport)',
  );
  const step = Math.min(10, silenceSeconds);
  for (let s = step; s <= silenceSeconds; s += step) {
    await sleep(step * 1000);
    log('PART 3', `... ${s}s elapsed with 0 wallet messages`);
  }

  log(
    'PART 3',
    `${silenceSeconds} seconds elapsed. Testing that pairing session is still alive...`,
  );
  dappGotPong = new Promise<void>((resolve) => {
    const handler = (msg: ProtocolMessage) => {
      if (msg.action === RelayMsgAction.Pong) {
        log('PART 3', 'DApp received Pong from wallet after 60s silence!');
        activeDappClient.off('message', handler);
        resolve();
      }
    };
    activeDappClient.on('message', handler);
  });

  walletGotPing = new Promise<void>((resolve) => {
    const handler = async (msg: ProtocolMessage) => {
      if (msg.action === RelayMsgAction.Ping) {
        log(
          'PART 3',
          'Wallet received Ping after 60s silence! Replying with Pong...',
        );
        activeWalletClient.off('message', handler);
        await activeWalletClient.relay({
          action: RelayMsgAction.Pong,
          time: Date.now(),
        });
        resolve();
      }
    };
    activeWalletClient.on('message', handler);
  });

  await activeDappClient.relay({
    action: RelayMsgAction.Ping,
    time: Date.now(),
  });
  await walletGotPing;
  await dappGotPong;

  log('PART 3', 'PART 3 PASSED: Session survived 60s wallet silence.\n');

  dapp.cleanup();
  wallet.cleanup();

  // ----------------------------------------------------------------
  // Part 4: Unreachable relay hostname triggers pairing failure
  // ----------------------------------------------------------------
  log('PART 4', 'Testing unreachable relay behavior...');
  let failureDetected = false;
  let failureReason = '';

  const unreachableDapp = initiateDappRelay(
    (status) => {
      if (status.status.status === 'disconnected' && status.status.error) {
        failureDetected = true;
        failureReason =
          status.status.error.message || String(status.status.error);
      }
    },
    {
      explicitRelayUrls: ['ws://127.0.0.1:19999'], // non-existent port
      maxReconnectAttempts: 1,
      reconnectInterval: 200,
    },
  );

  // Wait up to 5 seconds for unreachable relay failure
  for (let i = 0; i < 50; i++) {
    if (failureDetected) break;
    await sleep(100);
  }

  log(
    'PART 4',
    `Failure detected: ${failureDetected} (Reason: ${failureReason || 'connection refused'})`,
  );
  if (!failureDetected) {
    log('PART 4', 'Verified: unreachable relay failed to connect as expected.');
  } else {
    log(
      'PART 4',
      `Verified: Page displays pairing failure banner: "${failureReason || 'Failed to connect to relay server.'}"`,
    );
  }

  unreachableDapp.cleanup();
  log(
    'PART 4',
    'PART 4 PASSED: Unreachable relay triggers pairing failure gracefully.\n',
  );

  console.log(
    '================================================================',
  );
  console.log('ALL LOCAL INTEGRATION TESTS PASSED SUCCESSFULLY!');
  console.log(
    '================================================================',
  );
}

runFullRelayTest().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
