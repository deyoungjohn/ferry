# Mainnet keys

The first mainnet swaps need three fresh keys: a deployer EVM key, a solver EVM
key and a solver BCH key. Generate them offline on the maintainer's machine and
keep them out of the repository.

## Why fresh random keys

Do not reuse a Hardhat, Anvil, tutorial or hand-typed key. Well-known development
keys and simple repeating-byte keys can already have EIP-7702 delegations on
mainnet. A delegation changes the account's code and can silently change how a
signature is checked. `keys:check` refuses the known development keys and simple
repeating-byte patterns, and the optional online check refuses any account with
code or an EIP-7702 delegation on a configured chain.

## Generate

Run this on an offline or trusted machine, in the repository root:

```bash
pnpm --dir scripts/keys keys:generate
```

The default output is `.env.mainnet.local` in the repository root. It is
gitignored and created with mode 0600. To use another path:

```bash
pnpm --dir scripts/keys keys:generate /secure/offline/ferry-mainnet.env
```

The generator refuses to overwrite an existing file. It also refuses a path
inside a git repository unless that path is gitignored. It prints only the
public addresses and a ready-to-commit addresses block; it never prints a key.
The file contains the three values the deploy scripts and solver read:

```dotenv
DEPLOYER_EVM_PRIVATE_KEY=
SOLVER_EVM_PRIVATE_KEY=
SOLVER_BCH_WIF=
```

It also records the matching public addresses as comments so `keys:check` can
detect a key/address mismatch.

## Check

```bash
pnpm --dir scripts/keys keys:check .env.mainnet.local
```

The check is offline and prints a PASS/FAIL list by name. It verifies the file
mode, key formats, WIF network and compression, recorded EVM and BCH addresses,
that all three keys differ, and that no key is a known development key or a
simple repeating-byte key. It prints the public addresses and the Minimum-tier
funding targets; it never prints a key.

For the account-level check, export only the RPC variables you want to use (the
script never reads `.env.local` itself) and run:

```bash
pnpm --dir scripts/keys keys:check .env.mainnet.local --online
```

`--online` reads `eth_getCode` on every configured mainnet chain and fails if
either EVM address has code or an EIP-7702 delegation (`0xef0100...`).

## Back up

Keep the generated file offline. Make two copies on separate offline media and
label them with the date and the public addresses, not the key values. Do not
put a copy in cloud storage, a chat, a screenshot or the repository. The public
addresses can go in `preparation/evidence/README.md`; the key file cannot.

## Put the solver key on the server

Keep the deployer key off the solver server. On the offline machine, make a
solver-only environment file that contains `SOLVER_EVM_PRIVATE_KEY`,
`SOLVER_BCH_WIF` and the non-secret solver settings. Copy only that file:

```bash
scp solver.env ferry@your-server:/etc/ferry/solver.env
```

On the server:

```bash
chmod 600 /etc/ferry/solver.env
chown ferry:ferry /etc/ferry/solver.env
```

Load it with the service manager, not with a shell profile. Do not copy the
full key file to the server, and do not put the deployer key there.

## If a key leaks

1. Stop the solver immediately so it cannot sign another swap.
2. Move the remaining solver inventory to a newly generated address.
3. Generate fresh solver keys, update the server environment and restart only
   after the old keys are removed.
4. If the deployer key leaks, move any remaining deployment gas to a safe
   address. The deployed contract has no owner, so the deployer key is not an
   ongoing control key.
5. Rotate the operator token if it could have been exposed with the key. Check
   logs and on-chain activity for unexpected spends or delegations.

## History scan

Before opening the launch PR, run the local history scan:

```bash
pnpm --dir scripts/keys history
```

It fails on a tracked non-test file or a commit message that contains a
64-hex value assigned to a name ending in `PRIVATE_KEY`, or a WIF-shaped string.
It reports only the path or commit and the rule, never the matched value. Test
fixtures under `test/`/`tests/` and `*.test.*`/`*.spec.*` files are excluded
because the repository keeps fixed throwaway keys there.

## Root command aliases

This checkout does not add root `keys:generate` or `keys:check` aliases because
the root workspace files are owned by the maintainers. If the aliases are added,
the short forms are `pnpm keys:generate` and `pnpm keys:check <file>`. Until then,
use the `pnpm --dir scripts/keys ...` forms above.
