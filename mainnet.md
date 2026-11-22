# Mainnet results

Real swaps settled on mainnet through Ferry, read from the public solver record at `https://ferry.incepture.dev` on 2026-11-20 14:18:30 UTC. Every row is a completed swap; each transaction links to its chain's explorer. Amounts are what the person sent and received; the difference is the quoted fee.

**Who made these swaps:** test swaps run by the project owner with the owner's own wallets, to exercise every route. They are real mainnet transactions, not outside users.

**The contract:** FerryHTLC `0xfC28c2596C553353578a5a444d2316514009DAdF`, the same address on all six EVM chains (created through the standard deterministic deployer). Source verified on Etherscan (Ethereum), Arbiscan (Arbitrum) and Sourcify (Base, BNB Chain, Arc, Robinhood Chain). Bitcoin Cash locks are per-swap CashScript covenants (no deployment).

**Earlier contract:** swaps 1 to 14 (Base and Arbitrum One, 19 November) went through an earlier deployment of the same contract, `0x8b968625F983420B571C102eC0b57F7e509c916e` (different compiler settings, also ownerless and source verified on Sourcify). Swaps 15 to 27 use `0xfC28…DAdF`.

**MUSD:** USDC to MUSD and MUSD to USDC both completed on Base on 22 November (swaps 49 and 51). Later swaps appear in the Recent swaps table on <https://ferry.incepture.dev>.

**Totals:** 51 swaps listed below. On 22 November the solver reported 60 completed swaps (including pay-link and send-link swaps, not listed here), $501.58 settled and a 44 s fast-lane median. Swaps 1 to 27 were read on 20 November; 28 to 51 on 22 November.

## Routes covered

| Chain           | Token | Bitcoin Cash token | EVM to Bitcoin Cash | Bitcoin Cash to EVM |
| --------------- | ----- | ------------------ | ------------------- | ------------------- |
| Base            | USDC  | PUSD               | ✅ 12               | ✅ 8                |
| Ethereum        | USDC  | PUSD               | ✅ 3                | ✅ 4                |
| Ethereum        | USDT  | PUSD               | ✅ 1                | ✅ 1                |
| BNB Chain       | USDT  | PUSD               | ✅ 1                | ✅ 2                |
| Robinhood Chain | USDG  | PUSD               | ✅ 3                | ✅ 3                |
| Arc             | USDC  | PUSD               | ✅ 2                | ✅ 2                |
| Arbitrum One    | USDC  | PUSD               | ✅ 2                | ✅ 3                |
| Arbitrum One    | USDT  | PUSD               | ✅ 1                | ✅ 1                |
| Base            | USDC  | MUSD               | ✅ 1                | ✅ 1                |

The first swaps (19 Nov) ran while the solver's engine was still being finished, so some took many minutes; later ones settle in about a minute and a half. A swap that is not completed is refunded to its sender and does not appear here.

## Every completed swap

Times are UTC. "Created" is when the quote was made; "Done" is when the last claim confirmed. Transactions: _Lock_ is the swap's first lock, _Counter-lock_ the solver's lock on the other chain, then the two claims.

### 1. 1.00 USDC → 0.99 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x9222f390279664b2936c2302e7820b824afeb00693d80291fdc824d01268d77b`
- Created 2026-11-19 00:23:06, done 2026-11-19 01:22:32 (3566 s)
- Lock (Basescan): [0x3566d7ec…dff5b8](https://basescan.org/tx/0x3566d7ecdc6dc61a986d55158abae57bd4ee9f638438b7c5ad3b8f7ae5dff5b8)
- Counter-lock (Bitcoin Cash): [a01428bc70…f762d3](https://bchexplorer.info/tx/a01428bc70867fb16baafd81715e2057bab8f04a4918bde4e71b6d1c70f762d3)
- User claim (Bitcoin Cash): [9df0f0fdef…39452c](https://bchexplorer.info/tx/9df0f0fdef72e22264bd630ed3a8a0ec020832e0501f1a3e6f5b4e8d9839452c)
- Solver claim (Basescan): [0x2ccfba8a…d96ae0](https://basescan.org/tx/0x2ccfba8a6c586168b7ff74906ea4050610f349076bad06455d525d0c17d96ae0)

### 2. 1.00 USDC → 0.99 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x1252237f5acdf0374323cfa97baa255611da05347baacd0d9e3cb75ba05df0f6`
- Created 2026-11-19 01:35:23, done 2026-11-19 01:54:37 (1154 s)
- Lock (Basescan): [0x0d25a0c1…a7bd0c](https://basescan.org/tx/0x0d25a0c1880cd50ecf72e8819621ef2d61545d7415648a4b4de43c9c98a7bd0c)
- Counter-lock (Bitcoin Cash): [e59feb6d7d…d4af62](https://bchexplorer.info/tx/e59feb6d7d6110cfd72dbabdfece3787b15ed4251943f7cef010a22252d4af62)
- User claim (Bitcoin Cash): [7b63652a4f…f9c3eb](https://bchexplorer.info/tx/7b63652a4feac4ca033435eb0fc97a0c8c1b27b4f925df62b6057d0c7af9c3eb)
- Solver claim (Basescan): [0x0370c472…e8c979](https://basescan.org/tx/0x0370c4727afc6af1aed5fa3210a512cc27753c97b2106011f7e47ebcdee8c979)

### 3. 5.00 USDC → 4.98 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x0587843a75d487ee85d44f52d0b7b9c3e8254afb95a9d8fbdb35a8c1321bc0b1`
- Created 2026-11-19 02:33:21, done 2026-11-19 02:35:03 (102 s)
- Lock (Basescan): [0x4846b2a2…cd9130](https://basescan.org/tx/0x4846b2a274171ae6319f2a4dcebf04d40627b9439cd5ae88d1f3099f51cd9130)
- Counter-lock (Bitcoin Cash): [c6d86c6662…f318fa](https://bchexplorer.info/tx/c6d86c6662429798f4c390954b19337d51ec5692ac9db36704c09219bcf318fa)
- User claim (Bitcoin Cash): [3478c3ca10…39b21a](https://bchexplorer.info/tx/3478c3ca104693b6fbbd18db71cf01d23cf8d2ee30654d5f170ddd93b939b21a)
- Solver claim (Basescan): [0x26568500…3007c2](https://basescan.org/tx/0x26568500c920ce52d20644ed341b4f1f8b197a66194289e9a9d48341fe3007c2)

### 4. 5.00 USDC → 4.98 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x6050fa3ca7045408f362d24fe9fcfded2118df3a5ffaf8a89a66aab1386c057e`
- Created 2026-11-19 03:41:02, done 2026-11-19 03:42:43 (101 s)
- Lock (Basescan): [0x5afd9301…f7daea](https://basescan.org/tx/0x5afd93013dd2f000fbc238c0b6bd61cd877bdf9f5c34b6e0dbc49d9e88f7daea)
- Counter-lock (Bitcoin Cash): [38afd64b92…b55cc1](https://bchexplorer.info/tx/38afd64b929546937d98c5654366c7b530063f554f5b7fea12c152dabeb55cc1)
- User claim (Bitcoin Cash): [c63882d078…e5fc0f](https://bchexplorer.info/tx/c63882d078597f2ab70f4e33c480fb3cea1b0d1d3bdfef79c00611ab08e5fc0f)
- Solver claim (Basescan): [0xb3f44eb8…04cc49](https://basescan.org/tx/0xb3f44eb8ff92d343165ee35cf5c2ea97400d4958be3cd4e676371963fa04cc49)

### 5. 5.00 USDC → 4.98 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x9202853a32c9627c3b45e68ab1066cb36a62ae3a801c47dc765545124e9bf32c`
- Created 2026-11-19 10:05:46, done 2026-11-19 10:07:20 (94 s)
- Lock (Basescan): [0xea949de9…63583b](https://basescan.org/tx/0xea949de9528ff802b9cc05a6ddeae33d580a5b13e37d388dbfff55b5df63583b)
- Counter-lock (Bitcoin Cash): [f83549aaa5…e8ea36](https://bchexplorer.info/tx/f83549aaa572ae736dbbaf5ae0170f92c15d89f970b2038bd48c215a8ae8ea36)
- User claim (Bitcoin Cash): [6d4fc045bb…2ae5ad](https://bchexplorer.info/tx/6d4fc045bbaef292a75d2b8c6cbe24158956956976cba94951defea7dd2ae5ad)
- Solver claim (Basescan): [0x3cf24d01…1803f5](https://basescan.org/tx/0x3cf24d01bd85da064c0430104463880706b5df2c85636f187df0017c5d1803f5)

### 6. 4.00 PUSD → 3.98 USDC (Base, Bitcoin Cash → EVM)

- Order: `0xc1ac8ea191fec857b1e6a53abf1daf96b2680fc7913a08edcf33cdf3c5ebf207`
- Created 2026-11-19 12:04:57, done 2026-11-19 12:05:40 (43 s)
- Lock (Bitcoin Cash): [c9c9aa34c0…89767c](https://bchexplorer.info/tx/c9c9aa34c09ba5d04e55a166e9b0f3b438a1771dd357419ed079a7dc1789767c)
- Counter-lock (Basescan): [0x62686def…762442](https://basescan.org/tx/0x62686def675681fe7af03879053b29bd788cceae61b38210b36a0b81b1762442)
- User claim (Basescan): [0x1c604e24…5a8291](https://basescan.org/tx/0x1c604e24698e700c969073d89c50e68f52df28f4c88d0e5510bc3e40105a8291)
- Solver claim (Bitcoin Cash): [6342405b6e…8f6613](https://bchexplorer.info/tx/6342405b6e19155d34d45ba33674d4c52cfa972148890423960ecdb2e58f6613)

### 7. 7.00 PUSD → 6.97 USDC (Base, Bitcoin Cash → EVM)

- Order: `0xa5074551af8dca23badf55daa8d14e74563ca510fa94f88f726e429257896594`
- Created 2026-11-19 12:17:18, done 2026-11-19 12:17:56 (38 s)
- Lock (Bitcoin Cash): [0ad39f1b86…c4f284](https://bchexplorer.info/tx/0ad39f1b8630fafae3a4510d150e744dcaa648a23fe76227651a2c1601c4f284)
- Counter-lock (Basescan): [0xa33c8d39…bb94f3](https://basescan.org/tx/0xa33c8d392523efa6dc6e3169122c3e9ee1446b9427072dc9bf225b8cc6bb94f3)
- User claim (Basescan): [0xab97c896…d7dc4a](https://basescan.org/tx/0xab97c8967c8dc0476a22d04c8a2434f67011cb46591b6ff28f674b8d6ad7dc4a)
- Solver claim (Bitcoin Cash): [a7d6c4998c…bbf4a1](https://bchexplorer.info/tx/a7d6c4998c3ec4596c2b9cd1ed3405be011be20d55a438cfc96bdc3a71bbf4a1)

### 8. 2.02 USDC → 2.01 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x3eaf8966cc5e291baf184c8260117408c652e24484524aef4c47da60ea4b1474`
- Created 2026-11-19 15:04:44, done 2026-11-19 15:06:20 (96 s)
- Lock (Basescan): [0x510dc2fc…d22dd8](https://basescan.org/tx/0x510dc2fc16c640c61e0506f1ffc0f83beee5d15568ecdff0a04176cebbd22dd8)
- Counter-lock (Bitcoin Cash): [d91f86a413…127dd7](https://bchexplorer.info/tx/d91f86a413598360db41578f4c3e50c18a32ed45a04b83bc8d9f1eacbe127dd7)
- User claim (Bitcoin Cash): [e055c55d68…aaba42](https://bchexplorer.info/tx/e055c55d688486a3f9335eed21f0e87d01c4c2679f7b83602343bdc3f0aaba42)
- Solver claim (Basescan): [0xd108407d…433e70](https://basescan.org/tx/0xd108407d48bff112e0a07c6fb1f09ba094ebf2c7c2031f9ced1413b8c9433e70)

### 9. 2.00 PUSD → 1.99 USDC (Base, Bitcoin Cash → EVM)

- Order: `0x069312d86ae8cc2468ad12b642374ee2d3d6143dfe4011937b76e3c2794567a1`
- Created 2026-11-19 15:17:59, done 2026-11-19 16:33:46 (4547 s)
- Lock (Bitcoin Cash): [528753bd44…8697ce](https://bchexplorer.info/tx/528753bd44233e6c490af6ebe82ef914ae485e61b5bcf5729a821add348697ce)
- Counter-lock (Basescan): [0xbd311c26…a72cd7](https://basescan.org/tx/0xbd311c267ba501b504243f1548ca53ff040bbac6163e9841a98cb42a0ca72cd7)
- User claim (Basescan): [0x32ed42c5…458c67](https://basescan.org/tx/0x32ed42c53841983b29ec6da72bf9d2ae1d1815eaf1706b2e6c3b63cb8e458c67)
- Solver claim (Bitcoin Cash): [09bdb8afba…2cf438](https://bchexplorer.info/tx/09bdb8afbaef0eba3a37e99a884b39c6f4506f369a34036ff134594cf52cf438)

### 10. 8.00 USDC → 7.96 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x831e4d108dd4bd9adc138f235fd7843ee995d6a95624aa382539a9c4b0e5fd9e`
- Created 2026-11-19 16:36:37, done 2026-11-19 16:37:13 (36 s)
- Lock (Basescan): [0xe6dc18b1…e867cb](https://basescan.org/tx/0xe6dc18b17881ef2dce85c69849782967df22635dc759f149e9e2650cd7e867cb)
- Counter-lock (Bitcoin Cash): [cf1e39b3ce…d81847](https://bchexplorer.info/tx/cf1e39b3ce1e4ab9e6629d4e7fa9ba8be0fc24a723f83b447555712d52d81847)
- User claim (Bitcoin Cash): [a9f801f60b…24ecef](https://bchexplorer.info/tx/a9f801f60bcadad6bdd086a58c9babac4562d49b141640eca7b30edf0d24ecef)
- Solver claim (Basescan): [0x7d75adac…11d656](https://basescan.org/tx/0x7d75adac5afd8428f61bef971e35cf11babb2b1a8617ce7fbb2bbfb64711d656)

### 11. 5.00 PUSD → 4.98 USDC (Arbitrum One, Bitcoin Cash → EVM)

- Order: `0x9ed3e80ee944d318829d507e51f6764a6cdf8c45427e0e0263a03c708e0d00b2`
- Created 2026-11-19 19:45:41, done 2026-11-19 19:46:21 (40 s)
- Lock (Bitcoin Cash): [4ae05b46f1…f487cf](https://bchexplorer.info/tx/4ae05b46f11d68df866a634d7018b019303eb930f5556b6a379e5ce73bf487cf)
- Counter-lock (Arbiscan): [0x49fcad6f…84c9f3](https://arbiscan.io/tx/0x49fcad6f6b144e343d41fe3a83c7eb4979948c5dcde4ce150daf10d7ee84c9f3)
- User claim (Arbiscan): [0x525f9ee2…f37cdd](https://arbiscan.io/tx/0x525f9ee29ceb3533cb32aca9e9042a48ef4c764886a81142e6c6398597f37cdd)
- Solver claim (Bitcoin Cash): [3a2b8f3c93…9ae03f](https://bchexplorer.info/tx/3a2b8f3c93a5a3359c7f61e7c7bc9fc08f4406b61e5de66895fa6fc1e19ae03f)

### 12. 5.00 USDC → 4.98 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x6286c96dc2b53dcc5877ef8bd9af2a619283e9f210d7577db0542294a23c55e0`
- Created 2026-11-19 21:16:06, done 2026-11-19 21:16:49 (43 s)
- Lock (Basescan): [0xdcb191ac…d25423](https://basescan.org/tx/0xdcb191ac712bdd19b2347200ac815fdfb8827e076b04e744333a00c04bd25423)
- Counter-lock (Bitcoin Cash): [f8dd981042…bc1c77](https://bchexplorer.info/tx/f8dd98104289686b5c04d368a1de75820a2cab5014b0824fb5b7fb012fbc1c77)
- User claim (Bitcoin Cash): [9964c1f746…3b6c3d](https://bchexplorer.info/tx/9964c1f74699a0a8afd568721d5091123ab2d928677287a9e32d59aa493b6c3d)
- Solver claim (Basescan): [0x50247e43…1b9930](https://basescan.org/tx/0x50247e43ef3f3e66d620519683537162f9a340990480a3c11d9955beab1b9930)

### 13. 8.00 USDC → 7.96 PUSD (Arbitrum One, EVM → Bitcoin Cash)

- Order: `0x72ec9dd955187c9e5d1537478f3152a9ff7dc1452606b130822a9e0dfd8488c6`
- Created 2026-11-19 21:23:48, done 2026-11-19 22:18:16 (3268 s)
- Lock (Arbiscan): [0xe8c1de40…ab96f4](https://arbiscan.io/tx/0xe8c1de40dcd914bdd29beb5a553f2b04f1116164a2e086fb583b651655ab96f4)
- Counter-lock (Bitcoin Cash): [33bd6cda1e…7d5a09](https://bchexplorer.info/tx/33bd6cda1e732a8f028c16ebb4047a29222446a3fa772a996d32e5e0397d5a09)
- User claim (Bitcoin Cash): [54d55dbbdd…522873](https://bchexplorer.info/tx/54d55dbbddce1b3935bdc0dedeacc81f8968c5fa54722c93a243abe58c522873)
- Solver claim (Arbiscan): [0x5feb7d13…e2f7f4](https://arbiscan.io/tx/0x5feb7d1389297f04c2ab93902c0cba2efd99fa825c9ddf1122e5b784ace2f7f4)

### 14. 9.00 USDC → 8.96 PUSD (Arbitrum One, EVM → Bitcoin Cash)

- Order: `0x189b34612d3cdad5e961eb5528a1e58d7d6f43e015f2abb2ae141045957e4da0`
- Created 2026-11-19 22:05:37, done 2026-11-19 22:18:31 (774 s)
- Lock (Arbiscan): [0xad2e34f8…373173](https://arbiscan.io/tx/0xad2e34f8908e250323bbe6c2330b7acd1a52e5c788f4c997a0b6b80ebe373173)
- Counter-lock (Bitcoin Cash): [bf8608af8c…3b8720](https://bchexplorer.info/tx/bf8608af8cd7a774aba095c78d7b19fefd96ecfdf0ceaa1dd41b62cffa3b8720)
- User claim (Bitcoin Cash): [60d995bbdc…01f313](https://bchexplorer.info/tx/60d995bbdcdd9b011e4bc0ccc3c6da7bd454e3ee87ccfed4377c38be0401f313)
- Solver claim (Arbiscan): [0xafca4fff…7ffb75](https://arbiscan.io/tx/0xafca4fff3179844ab6df73b63a3a8eb9ae2558b919a1435cd31d2d4db07ffb75)

### 15. 11.00 PUSD → 10.95 USDC (Arc, Bitcoin Cash → EVM)

- Order: `0x983139914214e4d65fa2596a88479900d8f08fc01551beecd12ae0beab538378`
- Created 2026-11-20 01:48:00, done 2026-11-20 01:49:20 (80 s)
- Lock (Bitcoin Cash): [9501dc9feb…e6ae84](https://bchexplorer.info/tx/9501dc9feb1b15cbee48d0c0716b276bea475f5a819de4496d19b6c8a1e6ae84)
- Counter-lock (Arc Explorer): [0xab9076aa…fb3d8b](https://explorer.arc.io/tx/0xab9076aafd2dc74d02fcf33d93c9ac98f94f9ef310502913735bfca098fb3d8b)
- User claim (Arc Explorer): [0xebaef66a…50349b](https://explorer.arc.io/tx/0xebaef66a1722b807ba06a73059bbbec7462e8888fd3b529fb14eedaa5a50349b)
- Solver claim (Bitcoin Cash): [14583add46…4487be](https://bchexplorer.info/tx/14583add46f1c021fa7340cf212e145357591b7b4c321dc8fedc4b05a34487be)

### 16. 10.95 USDC → 10.90 PUSD (Arc, EVM → Bitcoin Cash)

- Order: `0x4fb8f46ceb4a37d157c9a743be290134b68b13ca560df4c1fc64f544511cf5b7`
- Created 2026-11-20 02:07:45, done 2026-11-20 02:08:30 (45 s)
- Lock (Arc Explorer): [0x67166532…b5f14b](https://explorer.arc.io/tx/0x67166532f73c92dc0446197840ebd8022255f4fd56b098a6dcd6710ae9b5f14b)
- Counter-lock (Bitcoin Cash): [eeee45cf38…7ff5d5](https://bchexplorer.info/tx/eeee45cf38b662faf92dc5d668375cc461de7ee3402e5b4b2f044d94be7ff5d5)
- User claim (Bitcoin Cash): [441a282c73…0af140](https://bchexplorer.info/tx/441a282c735043c65a8ae6f5efed59885e68eb61dfb02993aaabe814950af140)
- Solver claim (Arc Explorer): [0xda24ca00…2d9d08](https://explorer.arc.io/tx/0xda24ca0062156a8f9028db6fdf06118afa27a3b59e8ee7fd5ee36cfaa12d9d08)

### 17. 5.00 PUSD → 4.99 USDT (BNB Chain, Bitcoin Cash → EVM)

- Order: `0x2833ff20b31621308ff757f44e1732a5870301ed3a91d519bbed5991fe400a6a`
- Created 2026-11-20 02:47:01, done 2026-11-20 02:48:04 (63 s)
- Lock (Bitcoin Cash): [2417589b61…2843e9](https://bchexplorer.info/tx/2417589b61ab89e65e71d5f83aac5cdde5446958633306ee795710de232843e9)
- Counter-lock (BscScan): [0x824bc412…db784f](https://bscscan.com/tx/0x824bc412b2fef60b476139284b63bf4179025ebe551e426e6de58474b4db784f)
- User claim (BscScan): [0x3ed34183…6bcdc9](https://bscscan.com/tx/0x3ed3418327a7baa40e849b1e9fe717e271c49129f253408bab443e7c926bcdc9)
- Solver claim (Bitcoin Cash): [90a42bf040…93764f](https://bchexplorer.info/tx/90a42bf040c50754c660fec59780510960b084dd56727be842da679e5893764f)

### 18. 4.99 USDT → 4.98 PUSD (BNB Chain, EVM → Bitcoin Cash)

- Order: `0x8da896f0b5b1ad474ea1fa0dea7767b5d5d847451a382c45ea8e53164bcb01f1`
- Created 2026-11-20 03:43:02, done 2026-11-20 03:44:22 (80 s)
- Lock (BscScan): [0x9da32a23…b31ddb](https://bscscan.com/tx/0x9da32a23e849755b5a88baea88d303a5c1f348f4a5ef16306c1ddccc08b31ddb)
- Counter-lock (Bitcoin Cash): [a1c3d42604…3e88a5](https://bchexplorer.info/tx/a1c3d42604fdc1587b8fd53d5d787b7512069b327edc1d8ee7a943578f3e88a5)
- User claim (Bitcoin Cash): [e073f178a8…017da5](https://bchexplorer.info/tx/e073f178a83a85b937d621809d4ba90ef003824b9bff1b50a48f60891b017da5)
- Solver claim (BscScan): [0x4d9a2478…39bedd](https://bscscan.com/tx/0x4d9a24785ee21b8dca28f53b3dea65488382b7d56e7ee8d128f3554eea39bedd)

### 19. 11.00 PUSD → 10.98 USDG (Robinhood Chain, Bitcoin Cash → EVM)

- Order: `0x52c34f6c2c58578b4dc7074a09d7f6295adac92ad8fcdaf6929fbe0a173db67f`
- Created 2026-11-20 09:29:06, done 2026-11-20 09:29:52 (46 s)
- Lock (Bitcoin Cash): [3892ac5a34…22a606](https://bchexplorer.info/tx/3892ac5a34c20c57a3481e303312ccf4fd122a32f3c1b84223c96acb0022a606)
- Counter-lock (Blockscout): [0xa1069e97…4f89e2](https://robinhoodchain.blockscout.com/tx/0xa1069e97fcf81b4608f2ef74174b44235751afa7045e27c5a1ed1d76db4f89e2)
- User claim (Blockscout): [0xf107ce27…fdd41d](https://robinhoodchain.blockscout.com/tx/0xf107ce27be8095347a78bfb6ae1a856def24d0453bfa195b92ca14ffb1fdd41d)
- Solver claim (Bitcoin Cash): [59ec1cf4be…29a49c](https://bchexplorer.info/tx/59ec1cf4be7d9c2a3d00632495071ff3f107c596ab752c689cf65a927b29a49c)

### 20. 10.98 USDG → 10.96 PUSD (Robinhood Chain, EVM → Bitcoin Cash)

- Order: `0x46f60ffe126fa5b5eccb853b1378e4be41901fa955edc900e8d8c818383f2e85`
- Created 2026-11-20 09:36:53, done 2026-11-20 09:52:53 (960 s)
- Lock (Blockscout): [0xc9c0893c…4c45c7](https://robinhoodchain.blockscout.com/tx/0xc9c0893c8c885de784f61e5f4fed83c2830b46ec7b857fbe4b3c59dddc4c45c7)
- Counter-lock (Bitcoin Cash): [0dfc969bb1…ae49e8](https://bchexplorer.info/tx/0dfc969bb176c46f04e90c080079d861612bafcfd3cdfc34b2f932f304ae49e8)
- User claim (Bitcoin Cash): [18de164ac6…64b261](https://bchexplorer.info/tx/18de164ac6997230596d68fb2a5319df86e821e643947020711a9dcfc964b261)
- Solver claim (Blockscout): [0x46599b62…fbdcdd](https://robinhoodchain.blockscout.com/tx/0x46599b623f16a632f21b5fe1d172b51865c7c38ede96666ca1c5de0ec2fbdcdd)

### 21. 7.50 PUSD → 7.49 USDC (Ethereum, Bitcoin Cash → EVM)

- Order: `0x129cab3a1b6192160dd4b876ab719b64928cfd4f32ccc347cbba874559a789fd`
- Created 2026-11-20 12:08:07, done 2026-11-20 12:12:09 (242 s)
- Lock (Bitcoin Cash): [2409065d51…087c8c](https://bchexplorer.info/tx/2409065d510091bebcec7843e0ccf1f758e052e2806328ad1c446e7739087c8c)
- Counter-lock (Etherscan): [0xf0213098…24fca8](https://etherscan.io/tx/0xf0213098b48cdca8e51430f9393721a817a1f8c3e7366721d36b2e9e3224fca8)
- User claim (Etherscan): [0x4b51520f…b4b883](https://etherscan.io/tx/0x4b51520f1f3364ec4514f96761fb0ca2c42aed2dd04129ef88cbfd6fabb4b883)
- Solver claim (Bitcoin Cash): [958f9fbe8c…126704](https://bchexplorer.info/tx/958f9fbe8cfda021ac077be12996c29068074ea4a835fbb4f1b4833aed126704)

### 22. 7.49 USDC → 7.48 PUSD (Ethereum, EVM → Bitcoin Cash)

- Order: `0xa877f66c7530f792d5a3a00b0d2145c141c144d3469f6c25e6d46bdae9ca94b0`
- Created 2026-11-20 12:14:34, done 2026-11-20 12:21:26 (412 s)
- Lock (Etherscan): [0xaf271a25…5ed8e5](https://etherscan.io/tx/0xaf271a25ba1d37952c1b1f29e4094961c7b908cc943dde69c78b55e33d5ed8e5)
- Counter-lock (Bitcoin Cash): [04fbcb0036…2f554d](https://bchexplorer.info/tx/04fbcb00368a6a898ee8aef41bcd0a9619e2e2e8285221342850ec16712f554d)
- User claim (Bitcoin Cash): [fa8f1f7875…0eed8d](https://bchexplorer.info/tx/fa8f1f78756747fcdab0f033a29537418a44ef0fb95c73a49a77e605f70eed8d)
- Solver claim (Etherscan): [0x83b7a779…b577b6](https://etherscan.io/tx/0x83b7a779277f95638ff972c8ee489566ed39c2a12482904c6bf84c605fb577b6)

### 23. 8.60 PUSD → 8.59 USDT (Ethereum, Bitcoin Cash → EVM)

- Order: `0x3ea41fd4408ea73f79ea992ef289173c6a15a34e5926ac35361d1dc8c2172a69`
- Created 2026-11-20 13:43:48, done 2026-11-20 13:45:42 (114 s)
- Lock (Bitcoin Cash): [0d79fcba55…81cf82](https://bchexplorer.info/tx/0d79fcba554e227889f31e114e5b6ae35c884e6a70ab20885c6e4ed9f581cf82)
- Counter-lock (Etherscan): [0x9c44f11f…05fac9](https://etherscan.io/tx/0x9c44f11f50abbd44cbb19d09ea1cc254418b3a3b8a593d68f95245e08005fac9)
- User claim (Etherscan): [0x87b2a510…269a6b](https://etherscan.io/tx/0x87b2a5107c7dbddf914190de3695a07cd2fb1ef1b8852dcd2326bb3cf4269a6b)
- Solver claim (Bitcoin Cash): [714bc44033…7c5ed9](https://bchexplorer.info/tx/714bc440330f05e506dd26ecfeb10305b9ae9911fd8066e2941c820f4a7c5ed9)

### 24. 8.59 USDT → 8.58 PUSD (Ethereum, EVM → Bitcoin Cash)

- Order: `0x2b186908ff48ede2db730e87ca220e37ec18b8ffe3d77330330c1c67d8ff685c`
- Created 2026-11-20 13:47:06, done 2026-11-20 13:48:39 (93 s)
- Lock (Etherscan): [0x964a9de4…c9a07e](https://etherscan.io/tx/0x964a9de4845e77781f0989c85d717984487bee17163dc5632409c6556cc9a07e)
- Counter-lock (Bitcoin Cash): [3e749b43e3…161e88](https://bchexplorer.info/tx/3e749b43e3f3d6697d2eda4e06ece8ee4c683b352e5d95e6dbff724fe8161e88)
- User claim (Bitcoin Cash): [382ad02774…0a99db](https://bchexplorer.info/tx/382ad0277448b11aac6a6848f6060600dcddc06375357091839dc7e7af0a99db)
- Solver claim (Etherscan): [0x3be601af…1408a6](https://etherscan.io/tx/0x3be601af9dd0a4f7a24c39a2eab1656be1a2450762093ce215fc0da64b1408a6)

### 25. 12.00 PUSD → 11.99 USDT (Arbitrum One, Bitcoin Cash → EVM)

- Order: `0xed0124eeed7660fb21b6747566f7ae7f8aec6e95775c89e21689f6d6144368ff`
- Created 2026-11-20 13:55:45, done 2026-11-20 13:56:13 (28 s)
- Lock (Bitcoin Cash): [009732f81f…cce824](https://bchexplorer.info/tx/009732f81fef29a88312fcd5031123162372127df2b4eee80de8eaa202cce824)
- Counter-lock (Arbiscan): [0x7352edfc…b003fb](https://arbiscan.io/tx/0x7352edfcb801828ccac63f763ceaaac94a6d1a4a2434c817663d1cd57cb003fb)
- User claim (Arbiscan): [0xdd603ff0…ba78fb](https://arbiscan.io/tx/0xdd603ff0c1eec17a834e1b5177d510232fe266f514bb7342a89852913dba78fb)
- Solver claim (Bitcoin Cash): [b1f8dd89a8…a3ed02](https://bchexplorer.info/tx/b1f8dd89a88df5ebe0f345bc53f10c9c21498647540e59c2daff6f5ae1a3ed02)

### 26. 11.99 USDT → 11.98 PUSD (Arbitrum One, EVM → Bitcoin Cash)

- Order: `0x87ebd6cd55a2485dab3abae759583eb51278be5161e6eebd711bfe0a1c647c89`
- Created 2026-11-20 13:58:01, done 2026-11-20 13:58:43 (42 s)
- Lock (Arbiscan): [0xa6af44e8…9510ce](https://arbiscan.io/tx/0xa6af44e8ff0c8d78a9183dc28c6c864b1b672b75077775779d5862436f9510ce)
- Counter-lock (Bitcoin Cash): [5118321efa…e661ba](https://bchexplorer.info/tx/5118321efa44e923d6226042bc66d7521d7dcbef298926455f0acdd1b7e661ba)
- User claim (Bitcoin Cash): [c318ba8311…c8f014](https://bchexplorer.info/tx/c318ba83119081a75352aec76bba2350ba16277191b846b07e4a3e5794c8f014)
- Solver claim (Arbiscan): [0x7e6d0450…196b8c](https://arbiscan.io/tx/0x7e6d0450874fc55edf1765309b272deec4742b52c1f82a10d9a5730f32196b8c)

### 27. 10.00 USDC → 9.99 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x1ec02fbd42ad60e6fc4161ec2367e808dc8e92df2054a1dd494ae80c7e5f20ce`
- Created 2026-11-20 13:59:20, done 2026-11-20 13:59:56 (36 s)
- Lock (Basescan): [0x326817a4…3c92d9](https://basescan.org/tx/0x326817a424704883306dabeb9218f936581ba26b987d2f3eed065cca8d3c92d9)
- Counter-lock (Bitcoin Cash): [3b6fdcf586…d7058d](https://bchexplorer.info/tx/3b6fdcf5869a778f1d84f49e90dca6610103e0512cf590853bf869b097d7058d)
- User claim (Bitcoin Cash): [31e99dd5fb…d00c2e](https://bchexplorer.info/tx/31e99dd5fb65b8ac247a5a9ffe6c25abbd46f9b55e7e4f42a619b17bd0d00c2e)
- Solver claim (Basescan): [0x8c104e0e…054aca](https://basescan.org/tx/0x8c104e0e7e347391dd1e2f1b1dcf0766c9c1ff09b9b11e8c7183274b22054aca)

### 28. 12.01 PUSD → 12.00 USDC (Base, Bitcoin Cash → EVM)

- Order: `0xec9ca1b04cdd680cfca2e18a3e4752cde6d8b36492372f20d2d0e40e441ba3a0`
- Done 2026-11-20 15:10:23 (40 s)
- Lock (Bitcoin Cash): [8ca2d174…921f40](https://bchexplorer.info/tx/8ca2d174820698aca3203c6f68bb890c988015865515f2597be3c28410921f40)
- Counter-lock (Basescan): [0x2a3595b8…386b5a](https://basescan.org/tx/0x2a3595b81f7cc0d19668f37797075053db5c12466f449a68e311537b57386b5a)
- User claim (Basescan): [0x653d9ba4…b1fad0](https://basescan.org/tx/0x653d9ba476db17db0f10f3285368387ed741f487b9a3afbe130e80e4acb1fad0)
- Solver claim (Bitcoin Cash): [07555a66…fb9416](https://bchexplorer.info/tx/07555a66e83e91fa4f1ca5a467d928fbde2fb10e70fe930ceb1b99b9eefb9416)

### 29. 12.00 USDC → 11.99 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x39dd00397e5c868136c9b8e2e70efdb2c89058d8540b707b07c2e8954166ac4f`
- Done 2026-11-20 15:12:31 (62 s)
- Lock (Basescan): [0x8c3dce81…5358e3](https://basescan.org/tx/0x8c3dce81c8e842405685eb6267c49d4dd4ca9cfbfafe81df0e54d148265358e3)
- Counter-lock (Bitcoin Cash): [49331339…2903a2](https://bchexplorer.info/tx/49331339bf8d0379344af1dd982bd99b2626aed458714705a6bd76026f2903a2)
- User claim (Bitcoin Cash): [8f401d00…d683ff](https://bchexplorer.info/tx/8f401d00e9e7fc0e3eab73f2183b4e6faa605980790110c5caaf0c3d26d683ff)
- Solver claim (Basescan): [0x9a988eb9…5289b4](https://basescan.org/tx/0x9a988eb9e3ab7496cdb8aaecc1c5a80008240688237c6da06e69f5d1565289b4)

### 30. 12.01 PUSD → 12.00 USDC (Arbitrum One, Bitcoin Cash → EVM)

- Order: `0xca3c9dc80c1265fe6e6af356f082c61dfaca2758ff4a775f7079b5f628c41825`
- Done 2026-11-20 15:13:38 (26 s)
- Lock (Bitcoin Cash): [97f9ab12…2ef3e1](https://bchexplorer.info/tx/97f9ab12611a5fac92a64bd6b553f57f65b0e86354dab70e4d949a001b2ef3e1)
- Counter-lock (Arbiscan): [0x60be0497…8735ea](https://arbiscan.io/tx/0x60be0497e91045dac903e7b884b4d0a111a9c140d9d1c8cf0b83bfb8a68735ea)
- User claim (Arbiscan): [0xdca72ea9…e753a8](https://arbiscan.io/tx/0xdca72ea96c5d390d1bf8e538cf473ff16217dede9e4433adeeab5293a1e753a8)
- Solver claim (Bitcoin Cash): [28070904…fe4cfc](https://bchexplorer.info/tx/280709040d98abe2f5bd44ab534fbe8fe5e16bd8db2c7b68db45c5645ffe4cfc)

### 31. 4.00 PUSD → 3.99 USDT (BNB Chain, Bitcoin Cash → EVM)

- Order: `0x61acf150d4d61462aa85b21b634aaf49326d672ce3a07e4566e75e19f6ae495d`
- Done 2026-11-20 16:51:18 (44 s)
- Lock (Bitcoin Cash): [a5841aca…1235f9](https://bchexplorer.info/tx/a5841aca4c07bd4b814bcba3c5247595076c4b33e33cf88113dde41b741235f9)
- Counter-lock (BscScan): [0xb99e7383…4f67ea](https://bscscan.com/tx/0xb99e7383525f18d751d00776ebaa30798a92a30cb3b235ffdbdc0c11cb4f67ea)
- User claim (BscScan): [0x45f10218…843061](https://bscscan.com/tx/0x45f10218e02d4bd2d988f7c85be45e4a1570dcadc78bf05802010f6a5b843061)
- Solver claim (Bitcoin Cash): [3eb4e7be…3856ec](https://bchexplorer.info/tx/3eb4e7beacfcd8f1ce7cde1d2bc88f5c76ca91348f4ce3f03e254e7b0b3856ec)

### 32. 14.00 PUSD → 13.99 USDG (Robinhood Chain, Bitcoin Cash → EVM)

- Order: `0x727bb3b91f4ae8fc6e18d4c0ada475f5f9080f395676f6abbb5ae3d933da0f5d`
- Done 2026-11-20 19:10:34 (31 s)
- Lock (Bitcoin Cash): [707f4efb…9066bb](https://bchexplorer.info/tx/707f4efb16454e13dce2de96e97e62ce09b96c4f0137fc135404849e9a9066bb)
- Counter-lock (Blockscout): [0x399fb101…580747](https://robinhoodchain.blockscout.com/tx/0x399fb1011f9f260b1af92be83666b6899a66a8c44c40ee4936e8ba955e580747)
- User claim (Blockscout): [0xf1b0e226…a7501b](https://robinhoodchain.blockscout.com/tx/0xf1b0e22679fdec98faeb6874aaf435216b0b278901bb595e44139bb4b3a7501b)
- Solver claim (Bitcoin Cash): [8d3ac0aa…0cccee](https://bchexplorer.info/tx/8d3ac0aa0a62f4989a0fc517400b90f6174d3cf76b35b6e6ed2efed97d0cccee)

### 33. 14.00 USDG → 13.99 PUSD (Robinhood Chain, EVM → Bitcoin Cash)

- Order: `0x8487ba2bff87d3c90ec91b533f3d8dd31de0f06986c3ab7574cd91b962621bef`
- Done 2026-11-20 20:52:19 (4773 s)
- Lock (Blockscout): [0x9f06aca6…47e627](https://robinhoodchain.blockscout.com/tx/0x9f06aca6e8977a3868fcc58a149b8089ae85b94e689db2545fef2c8bb347e627)
- Counter-lock (Bitcoin Cash): [5929ffb8…1408d6](https://bchexplorer.info/tx/5929ffb870db5878bbca1afd5ac27d168e5fb0160baa504477e792eb231408d6)
- User claim (Bitcoin Cash): [a86c168a…291768](https://bchexplorer.info/tx/a86c168a61c3bb4db440de9846877cc8ca8afc71aa4e24125b146cb0d3291768)
- Solver claim (Blockscout): [0x8284a540…3c9bc9](https://robinhoodchain.blockscout.com/tx/0x8284a540dbb571cd1c9fa9e9b7c78c7547a70feffab7e17c7a1b391f943c9bc9)

### 34. 6.00 PUSD → 5.99 USDC (Base, Bitcoin Cash → EVM)

- Order: `0x16f718f21a80857fb53b12468e7b81dbb5eebcbb624588d18a787c6fdfae65b9`
- Done 2026-11-20 20:57:53 (39 s)
- Lock (Bitcoin Cash): [a1007401…5c79d7](https://bchexplorer.info/tx/a1007401335f2a6528625fc689ad27e3e58de9ee399c6452d77e01676a5c79d7)
- Counter-lock (Basescan): [0xdeb2aefd…c9aa7f](https://basescan.org/tx/0xdeb2aefdbaef6045ee6c5a919adb5ca700cab78ab05c34aa83cda6cd5dc9aa7f)
- User claim (Basescan): [0x67c5e1db…963400](https://basescan.org/tx/0x67c5e1dbb4f2c6b52693f7ba3368da6a8e3b1b6a18cea6510c56a2e922963400)
- Solver claim (Bitcoin Cash): [adfc5ac4…5f5de9](https://bchexplorer.info/tx/adfc5ac4543b08fc4cf50b97fd7f8569fd6a1267fcf666ea7d3eac863e5f5de9)

### 35. 11.00 PUSD → 10.99 USDC (Ethereum, Bitcoin Cash → EVM)

- Order: `0x8ab83e64b1b01d160581fa5343b0863ee72d112bf322ad4769f19275fa93fb8a`
- Done 2026-11-20 21:08:18 (130 s)
- Lock (Bitcoin Cash): [21a35c79…8257bf](https://bchexplorer.info/tx/21a35c79ced23a346dfd296d88a6aaccca706b64769ce2be1960cc56188257bf)
- Counter-lock (Etherscan): [0x1936fafe…18008c](https://etherscan.io/tx/0x1936fafef75dca0d2c9291adca77ccbed0f09dbeea4258069e71daff8418008c)
- User claim (Etherscan): [0x93dd4b96…8518ae](https://etherscan.io/tx/0x93dd4b96b02cf883376243a96b61fd353d1d30fef9a0adc240080826358518ae)
- Solver claim (Bitcoin Cash): [b9419211…f35e8b](https://bchexplorer.info/tx/b9419211f3e70030acc3a6a742d983b5746278bbb14d35cef1bb3cbf7cf35e8b)

### 36. 25.00 PUSD → 24.98 USDG (Robinhood Chain, Bitcoin Cash → EVM)

- Order: `0x3f4d12da46fa73e48feeb0ff15b03c19904c71c2d5bb4967f43e338f8938fdc9`
- Done 2026-11-20 21:16:48 (55 s)
- Lock (Bitcoin Cash): [33b1916f…da0809](https://bchexplorer.info/tx/33b1916fe50848ba76c05ae17bd027415f9b3de1d2fc9dd75a67a2924cda0809)
- Counter-lock (Blockscout): [0x62dca781…847c98](https://robinhoodchain.blockscout.com/tx/0x62dca781f063e7b4afec1c465a69adb5e7355fbebbebb64d6ee50debf9847c98)
- User claim (Blockscout): [0xbd76ed52…05db87](https://robinhoodchain.blockscout.com/tx/0xbd76ed52f9f5157697435be487f7f97158e3c857f6999469aa4bf0045105db87)
- Solver claim (Bitcoin Cash): [e5f79477…36a783](https://bchexplorer.info/tx/e5f7947731e3792e9b1346d1cb1e0bf59b138626fa809c8fb94181c57c36a783)

### 37. 24.98 USDG → 24.96 PUSD (Robinhood Chain, EVM → Bitcoin Cash)

- Order: `0x504cce33bb5342ba626c25b0f3bd67428fd05aaeac2f0ae1055110320ebda01b`
- Done 2026-11-20 22:02:21 (1155 s)
- Lock (Blockscout): [0x6ac64dae…b38d6f](https://robinhoodchain.blockscout.com/tx/0x6ac64dae27e7ca6fe14dd4537af42d330f9f57f1aab085c7bdea120912b38d6f)
- Counter-lock (Bitcoin Cash): [c1827039…c690aa](https://bchexplorer.info/tx/c182703978a0cc539019367515fa6955ff0c0a170bc4d1d51d45789f45c690aa)
- User claim (Bitcoin Cash): [89a10fb0…a79792](https://bchexplorer.info/tx/89a10fb04d7c31289d9ae0ad30d88f4c20878110f9e65e49d6d2bf9d67a79792)
- Solver claim (Blockscout): [0xcbbfabb5…722d37](https://robinhoodchain.blockscout.com/tx/0xcbbfabb5cd6b0aa461412ffe68af65869a39bc3faf4440fb94c21870cd722d37)

### 38. 5.00 PUSD → 4.99 USDC (Ethereum, Bitcoin Cash → EVM)

- Order: `0xa91aea340adeac0b4927fe4118988464c8c0a640a4c1fe8829752d1c53b6be2f`
- Done 2026-11-21 10:38:17 (181 s)
- Lock (Bitcoin Cash): [eb0f427a…17e40d](https://bchexplorer.info/tx/eb0f427ababac7089df5316d56204a8cf0c09f69f6b3497513d4fccd8117e40d)
- Counter-lock (Etherscan): [0xd02db68e…039658](https://etherscan.io/tx/0xd02db68e9d51d02de24bba3a3e936f755189e2f37f0162ab41f24edb4e039658)
- User claim (Etherscan): [0xc6b20eea…9e6525](https://etherscan.io/tx/0xc6b20eea4b8ca6e2b07301ba2a427c782ad38a926d1d164475257be8459e6525)
- Solver claim (Bitcoin Cash): [13d70c71…e0d15a](https://bchexplorer.info/tx/13d70c716c39bd54b484eb74c044ffd1fb7c47a71ed3dae7a843ff6c46e0d15a)

### 39. 4.99 USDC → 4.98 PUSD (Ethereum, EVM → Bitcoin Cash)

- Order: `0x67a0c522546b3f0de571438c5d05f39324760bb52ac8d8f4e922161dbc5da15f`
- Done 2026-11-21 11:54:51 (2828 s)
- Lock (Etherscan): [0xd61a12fb…e55644](https://etherscan.io/tx/0xd61a12fbf10876fe7ee99c88a5ec34a78ecc4d4d84a7bdead38f0adf2be55644)
- Counter-lock (Bitcoin Cash): [23c7221f…28cbf2](https://bchexplorer.info/tx/23c7221f5a43ed72542f892e8d3ac2b7c5333a77a6b10aa135f540e7fd28cbf2)
- User claim (Bitcoin Cash): [80f58682…80e6af](https://bchexplorer.info/tx/80f5868266176622ec448031e3d023929b10e89312e4262d30a981d1a980e6af)
- Solver claim (Etherscan): [0x7af606db…fd4f08](https://etherscan.io/tx/0x7af606db2e1e0fb31d2286fed4f2ee622577c302cf74edc6961b312567fd4f08)

### 40. 12.00 PUSD → 11.99 USDC (Arbitrum One, Bitcoin Cash → EVM)

- Order: `0x5d68ce2fd9b7be9570e88aeeeadfd32f373ebd2942b2866f9a56a8a619c73521`
- Done 2026-11-21 12:00:40 (44 s)
- Lock (Bitcoin Cash): [e370f6dc…bc8028](https://bchexplorer.info/tx/e370f6dca0f6f768a0cead66d797e565725467c20c2b651f93d1e61778bc8028)
- Counter-lock (Arbiscan): [0xfe2f289d…3f5b55](https://arbiscan.io/tx/0xfe2f289da24187d8e1e8ccfa2ec66a4cdd5a1f814e2b73d59fc9dcd6eb3f5b55)
- User claim (Arbiscan): [0xe0f41762…edf18c](https://arbiscan.io/tx/0xe0f4176246a8702fc0d07b34c1103c2dc126cb40ef48bd1d73e34bc2f0edf18c)
- Solver claim (Bitcoin Cash): [a904e8fd…c9727b](https://bchexplorer.info/tx/a904e8fde26526aff234c346ab75dc2c646ef7bf2f17f60873781ac04ac9727b)

### 41. 6.00 PUSD → 5.99 USDC (Arc, Bitcoin Cash → EVM)

- Order: `0x3434e0e8c08479e705c28b13525bc595d01ee540a0dd0de04c8128f4c084146e`
- Done 2026-11-21 12:02:22 (41 s)
- Lock (Bitcoin Cash): [6fa914e9…f5df93](https://bchexplorer.info/tx/6fa914e9592812960f0503de22fd46488331fe497173d54a06a7d1d828f5df93)
- Counter-lock (Arc Explorer): [0x96fdd731…021d38](https://explorer.arc.io/tx/0x96fdd73178b5e9a673c59113819a653d88930da71e111e7c7bc36c0534021d38)
- User claim (Arc Explorer): [0x0c9623b8…cf1e12](https://explorer.arc.io/tx/0x0c9623b8c413e11bfa02253cd86773db516aa7b98aed87a6da050f9f87cf1e12)
- Solver claim (Bitcoin Cash): [a3dd9cc1…c63154](https://bchexplorer.info/tx/a3dd9cc182346485def7e7809382adba050eaba3c403923653c4dfc954c63154)

### 42. 11.00 USDC → 10.99 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0xca47e786380dc3f204620a537925fc8f1b525c4f2a958149eca91b6e0eef5911`
- Done 2026-11-21 13:33:43 (36 s)
- Lock (Basescan): [0xe7b04a26…c13d01](https://basescan.org/tx/0xe7b04a266aee93a8653b08c20c60019f9ae012a097f4c262299e0164fcc13d01)
- Counter-lock (Bitcoin Cash): [772714a6…6092b7](https://bchexplorer.info/tx/772714a6e112a126ccfa7d15308926500e05d3175058607f58a965aa5f6092b7)
- User claim (Bitcoin Cash): [81903352…7a7da2](https://bchexplorer.info/tx/81903352d2ba170d0289b4949b8d3ae4f74b1bb067147a71147525d5d47a7da2)
- Solver claim (Basescan): [0x920c854b…0a6c7f](https://basescan.org/tx/0x920c854ba63a2af5f9685208a413e7b5e22c56a5e601a90b66c160a2a50a6c7f)

### 43. 10.00 PUSD → 9.99 USDC (Base, Bitcoin Cash → EVM)

- Order: `0x54c615914ef639ca812b94251499468962bcab8d6d7d8d23b6b302b0968e4c47`
- Done 2026-11-21 13:58:33 (29 s)
- Lock (Bitcoin Cash): [308fc6c0…7c87d8](https://bchexplorer.info/tx/308fc6c025dde46dc0508877756043c07f3fdd064792ced6f0e99691807c87d8)
- Counter-lock (Basescan): [0x9a0d37a2…ccaee6](https://basescan.org/tx/0x9a0d37a2d6512d3164189b7ab290fe989f9fa36e2a29403a4233cb2ddbccaee6)
- User claim (Basescan): [0xc48b572d…b8a863](https://basescan.org/tx/0xc48b572d3b25c86c8e2d01bed26cdc31b6fa54ca73a491720db649b0ccb8a863)
- Solver claim (Bitcoin Cash): [844e0db3…b21694](https://bchexplorer.info/tx/844e0db396d82da59f6b8e9b4581ec995edb7f4d156695ebdc64a5d9a2b21694)

### 44. 6.00 USDC → 5.99 PUSD (Arc, EVM → Bitcoin Cash)

- Order: `0x4c150cbfc91af227d916f02d30fab11c605d7d3475521f1d1fa9af5786b22e1e`
- Done 2026-11-21 16:30:30 (69 s)
- Lock (Arc Explorer): [0x2739bc4c…d41b47](https://explorer.arc.io/tx/0x2739bc4c47d670e967710ca8a103297a96b261ce593328684e81ffa6eed41b47)
- Counter-lock (Bitcoin Cash): [f9ba0d92…fbcf78](https://bchexplorer.info/tx/f9ba0d92b642014425faa4636ce98a5499a0ce059c993b4d2de1c7d0e2fbcf78)
- User claim (Bitcoin Cash): [de07a326…ff1c1f](https://bchexplorer.info/tx/de07a326343a03073338ecddba8cb75a90ae364bcc2fb902a248a9571eff1c1f)
- Solver claim (Arc Explorer): [0x00224310…33600b](https://explorer.arc.io/tx/0x0022431035d7de204d97904b33b97b7d52f26ec1a0d6c4977e8848a62d33600b)

### 45. 9.00 PUSD → 8.99 USDC (Ethereum, Bitcoin Cash → EVM)

- Order: `0x1efa86afc75705a954c76dd48ac9d9ee9374a16b7c68af13d894fa78ecdf9ec9`
- Done 2026-11-21 16:34:14 (98 s)
- Lock (Bitcoin Cash): [5c9b28c6…aa015f](https://bchexplorer.info/tx/5c9b28c6583eedc13f8907885da1598f1e1a8079c8eb304922339f5c74aa015f)
- Counter-lock (Etherscan): [0x46c33ee0…79334f](https://etherscan.io/tx/0x46c33ee04381f46275e32bc2046915814e3ad18ece44752bc7af5a016779334f)
- User claim (Etherscan): [0xd3e19ad5…224caa](https://etherscan.io/tx/0xd3e19ad53aadaefc3f1c8419160c60bf49d5653c1fc60c675de18bcffd224caa)
- Solver claim (Bitcoin Cash): [2ec31b7d…02e604](https://bchexplorer.info/tx/2ec31b7d917800410cfa8438023f77391fb8a73bed329f773277cd359102e604)

### 46. 8.00 USDC → 7.99 PUSD (Ethereum, EVM → Bitcoin Cash)

- Order: `0xd6cb27f48c6269773d3d9061c3176148f63631c59227a3c55f85f376dbfaf133`
- Done 2026-11-21 16:39:52 (246 s)
- Lock (Etherscan): [0x07d4a3b2…58fbf3](https://etherscan.io/tx/0x07d4a3b2a9975025ae366523f1a372f4d55e4357fae1d321c12a43233158fbf3)
- Counter-lock (Bitcoin Cash): [a6e72eef…4de1a2](https://bchexplorer.info/tx/a6e72eefc8b1168dfe6b5bf2879c94113191d39fa99ef7dd2499c2e21c4de1a2)
- User claim (Bitcoin Cash): [bd75f51b…24ae5c](https://bchexplorer.info/tx/bd75f51bc801bc56bd2d7c8c64e1989c31c5218744ff2de32b1ccf52c224ae5c)
- Solver claim (Etherscan): [0xa40c8df5…cddf78](https://etherscan.io/tx/0xa40c8df5f19c37ebfbec357a2e2562d498b06cec1970104b905975812ccddf78)

### 47. 7.00 USDC → 6.99 PUSD (Base, EVM → Bitcoin Cash)

- Order: `0x2bda4125af038182fbd6dd01c71177069894723a3a320587d6465485faa28a22`
- Done 2026-11-21 22:03:21 (35 s)
- Lock (Basescan): [0xfe47d680…adace5](https://basescan.org/tx/0xfe47d68012108df038069b8faf501a68bafde4f13f42df9d5ff5c8baffadace5)
- Counter-lock (Bitcoin Cash): [445f1108…1c2b54](https://bchexplorer.info/tx/445f1108a15f8824d99e3e0f7fb334c1b473ce753701c0d2a79c6103e91c2b54)
- User claim (Bitcoin Cash): [f2056c2e…98355a](https://bchexplorer.info/tx/f2056c2e02f8e5b9ddbbf9f2371f20870a00d3646cbfb6e787ba5d38e998355a)
- Solver claim (Basescan): [0x7fd93fe4…ee30a8](https://basescan.org/tx/0x7fd93fe4f02d2dab8538f3f97c81074728b757466ac70290daf9a7d0f2ee30a8)

### 48. 6.99 PUSD → 6.98 USDC (Base, Bitcoin Cash → EVM)

- Order: `0xffa7712291ac99b664875de51f44a7aeb9f60a4f7806a9a89fe3e56e4b4f9669`
- Done 2026-11-21 22:03:56 (25 s)
- Lock (Bitcoin Cash): [9463340f…441347](https://bchexplorer.info/tx/9463340fcd3edcc41f7857700a75b702cde83221895ed7218a5a05fa10441347)
- Counter-lock (Basescan): [0xc01293ac…8c346a](https://basescan.org/tx/0xc01293acec456f49ae32e888ffe3ab729adceda71b95471b4fd8254aa98c346a)
- User claim (Basescan): [0xd43d0a2e…a9af92](https://basescan.org/tx/0xd43d0a2e78f98d7e86598678cfc2f2e841977b0e9e235325b11329269da9af92)
- Solver claim (Bitcoin Cash): [4410d6ee…9c904d](https://bchexplorer.info/tx/4410d6eedfd5c83eec14f30dedec6c1f14a16889d434025a023cbd9ded9c904d)

### 49. 5.00 USDC → 4.99 MUSD (Base, EVM → Bitcoin Cash)

- Order: `0x894cb27b6062018a3af41ec15b26dda72e5813d75ba6532ed3d65fcf3ecbfe1f`
- Done 2026-11-22 13:01:40 (39 s)
- Lock (Basescan): [0xed66045c…eba55f](https://basescan.org/tx/0xed66045cb8ddbe85a33f3e4a63a03ad301c8dc0b0895dc79198ecf28fdeba55f)
- Counter-lock (Bitcoin Cash): [c2ff8e90…ef30ba](https://bchexplorer.info/tx/c2ff8e903aed9b0e4de2e39bf62f8cebb00092e2f5206afe9d2d695ca7ef30ba)
- User claim (Bitcoin Cash): [501a0965…8378dc](https://bchexplorer.info/tx/501a09659fefad88fec16704f1de11ad563bcf18ec9ebd193026a7a9c08378dc)
- Solver claim (Basescan): [0x26030ddd…49ad7a](https://basescan.org/tx/0x26030dddeec1609d3e6263e4608d2d0d872359379a58c00bd736e3f77049ad7a)

### 50. 2.00 PUSD → 1.99 USDC (Base, Bitcoin Cash → EVM)

- Order: `0xab4bcf2624496669373a7b7bd6d26360631201f51ce3655f6ef6a679b11343e0`
- Done 2026-11-22 13:09:16 (24 s)
- Lock (Bitcoin Cash): [c327f768…f2cce6](https://bchexplorer.info/tx/c327f7686d71e3119fdf4640efa61969201041aa3067db382adaad22daf2cce6)
- Counter-lock (Basescan): [0xaa7c175e…173d6a](https://basescan.org/tx/0xaa7c175e9f9855f3f109e669a7910f236d681f31b4460107560fd3b2b5173d6a)
- User claim (Basescan): [0xf000748c…4e8105](https://basescan.org/tx/0xf000748c0c61b1224a0ccbb68d15774dec875f98897fc4b7b1febda0724e8105)
- Solver claim (Bitcoin Cash): [b3303b4b…1861f8](https://bchexplorer.info/tx/b3303b4b3bb0018764ad77cc3f268fd631e168c55388e0bdc18b8796871861f8)

### 51. 5.00 MUSD → 4.99 USDC (Base, Bitcoin Cash → EVM)

- Order: `0xccbf0b8eacceb9c84666d87dbfacac5fe22dc59629ced08b6b669648479e49ea`
- Done 2026-11-22 13:40:11 (39 s)
- Lock (Bitcoin Cash): [91c6be8b…515046](https://bchexplorer.info/tx/91c6be8b10116a49d135f7fee6e45c839995870b5350d86213e814b69c515046)
- Counter-lock (Basescan): [0x1feacc64…1f339b](https://basescan.org/tx/0x1feacc6491c6f413ed3d66a3078972789a681780cad97e83962ce51dcd1f339b)
- User claim (Basescan): [0xda041172…e4c349](https://basescan.org/tx/0xda041172a616aca8b982887a33c7b9dc16c0a78c43ec877bea988c17e0e4c349)
- Solver claim (Bitcoin Cash): [2b2b11b2…cb9132](https://bchexplorer.info/tx/2b2b11b2636a5d98456f9dac9846f8c983b5579158de269716c40b3947cb9132)
