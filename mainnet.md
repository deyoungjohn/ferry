# Mainnet results

Real swaps settled on mainnet through Ferry, read from the public solver record at `https://ferry.incepture.dev` on 2026-11-20 14:18:30 UTC. Every row is a completed swap; each transaction links to its chain's explorer. Amounts are what the person sent and received; the difference is the quoted fee.

**Who made these swaps:** test swaps run by the project owner with the owner's own wallets, to exercise every route. They are real mainnet transactions, not outside users.

**The contract:** FerryHTLC `0xfC28c2596C553353578a5a444d2316514009DAdF`, the same address on all six EVM chains (created through the standard deterministic deployer). Source verified on Etherscan (Ethereum), Arbiscan (Arbitrum) and Sourcify (Base, BNB Chain, Arc, Robinhood Chain). Bitcoin Cash locks are per-swap CashScript covenants (no deployment).

**Earlier contract:** swaps 1 to 14 (Base and Arbitrum One, 19 November) went through an earlier deployment of the same contract, `0x8b968625F983420B571C102eC0b57F7e509c916e` (different compiler settings, also ownerless and source verified on Sourcify). Swaps 15 to 27 use `0xfC28…DAdF`.

**MUSD:** no MUSD swap had completed at submission. Later swaps, including MUSD once funded, appear in the Recent swaps table on <https://ferry.incepture.dev>.

**Totals:** 27 completed swaps, $186.76 settled, median time 93 s (28 s fastest, 4547 s slowest).

## Routes covered

| Chain           | Token | EVM → Bitcoin Cash | Bitcoin Cash → EVM |
| --------------- | ----- | ------------------ | ------------------ |
| Base            | USDC  | ✅ 9               | ✅ 3               |
| Ethereum        | USDC  | ✅ 1               | ✅ 1               |
| Ethereum        | USDT  | ✅ 1               | ✅ 1               |
| BNB Chain       | USDT  | ✅ 1               | ✅ 1               |
| Robinhood Chain | USDG  | ✅ 1               | ✅ 1               |
| Arc             | USDC  | ✅ 1               | ✅ 1               |
| Arbitrum One    | USDC  | ✅ 2               | ✅ 1               |
| Arbitrum One    | USDT  | ✅ 1               | ✅ 1               |

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
