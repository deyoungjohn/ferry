# Ferry

**Move stablecoins in and out of Bitcoin Cash.** Ferry swaps USDC, USDT and USDG on six EVM chains for PUSD and MUSD on Bitcoin Cash, and back, with atomic swaps: either both sides happen or your money comes back. Nothing is wrapped, minted or held by a custodian. It also does pay links (get paid in PUSD by anyone holding dollars on six chains) and send links (send PUSD to someone who only has an EVM wallet), and every swap can be recovered with your wallet on any device.

- **Live app:** <https://ferry.incepture.dev>
- **Documentation:** <https://ferry.incepture.dev/docs>
- **Built for:** BCH BLAZE 2026

> Ferry is live on mainnet with capped swap sizes ($1 to $50). It has not had an external security audit. See [Known limitations](https://ferry.incepture.dev/docs/limitations).

## How a swap works

```text
 You                                         Solver
 ---                                         ------
 lock A on chain X  (hash H, deadline T1)  -->
                                           <--  lock B on chain Y (hash H, deadline T2 < T1)
 claim B with the secret S   (S is now public)
                                           -->  claim A with S
```

1. You lock your stablecoin in `FerryHTLC` on your chain, under the hash of a secret only you know.
2. An independent solver locks the other side on the other chain, under the same hash, with an earlier deadline.
3. You claim the solver's lock by revealing the secret; the solver uses the revealed secret to claim yours.

If anything stops, each lock refunds to its owner after its deadline. The first lock always outlives the second by a statistical margin over Bitcoin Cash block times, checked by the solver and again in your browser. Details: [Atomic swaps](https://ferry.incepture.dev/docs/atomic-swaps) and [Timeouts and refunds](https://ferry.incepture.dev/docs/timing).

## What you can do

| Feature    | What it does                                                                                    | Docs                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Swap in    | USDC, USDT or USDG to PUSD or MUSD in about a minute, gasless on most routes                    | [Swap into Bitcoin Cash](https://ferry.incepture.dev/docs/swap-to-bch)     |
| Swap out   | PUSD or MUSD to an EVM stablecoin, with WizardConnect for the Bitcoin Cash wallet               | [Swap out of Bitcoin Cash](https://ferry.incepture.dev/docs/swap-from-bch) |
| Pay links  | Fixed or open amount; the payer picks any chain and stablecoin                                  | [Pay links](https://ferry.incepture.dev/docs/pay-links)                    |
| Send links | The receiver picks a route and signs one free message; unclaimed links refund                   | [Send links](https://ferry.incepture.dev/docs/send-links)                  |
| Recovery   | One wallet signature finds every swap on any device; `recover.html` works with no server at all | [Recovery](https://ferry.incepture.dev/docs/recovery)                      |

## Mainnet contracts

**FerryHTLC** `0xfC28c2596C553353578a5a444d2316514009DAdF`, the same address on all six chains through the standard deterministic deployer, with no owner, admin, pause or upgrade.

| Chain           | Contract                                                                                               | Source verified on |
| --------------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| Base            | [basescan](https://basescan.org/address/0xfC28c2596C553353578a5a444d2316514009DAdF)                    | Sourcify           |
| Ethereum        | [etherscan](https://etherscan.io/address/0xfC28c2596C553353578a5a444d2316514009DAdF)                   | Etherscan          |
| Arbitrum One    | [arbiscan](https://arbiscan.io/address/0xfC28c2596C553353578a5a444d2316514009DAdF)                     | Arbiscan           |
| BNB Chain       | [bscscan](https://bscscan.com/address/0xfC28c2596C553353578a5a444d2316514009DAdF)                      | Sourcify           |
| Arc             | [explorer.arc.io](https://explorer.arc.io/address/0xfC28c2596C553353578a5a444d2316514009DAdF)          | Sourcify           |
| Robinhood Chain | [blockscout](https://robinhoodchain.blockscout.com/address/0xfC28c2596C553353578a5a444d2316514009DAdF) | Sourcify           |

On Bitcoin Cash each swap gets its own CashScript covenant ([`FerryHTLC.cash`](packages/htlc-bch/contracts/FerryHTLC.cash)), keyless for claims and refunds, holding PUSD (category `2469acc5…a02544`) or MUSD (category `b38a33f7…87f366`).

## Mainnet transactions

On 21 November 2026 the live solver reported **55 completed swaps** and **$475.61 settled**, with a **46 s** median on the fast lane ([`/v1/stats`](https://ferry.incepture.dev/v1/stats)). By 20 November every route had run in both directions. The first 27 swaps, with every transaction (dates 2026, UTC; "Time" is from quote to last claim):

| #   | Date  | Swap                    | Chain           | Time   | Transactions                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----- | ----------------------- | --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 11-19 | 1.00 USDC → 0.99 PUSD   | Base            | 3566 s | [lock](https://basescan.org/tx/0x3566d7ecdc6dc61a986d55158abae57bd4ee9f638438b7c5ad3b8f7ae5dff5b8) · [counter-lock](https://bchexplorer.info/tx/a01428bc70867fb16baafd81715e2057bab8f04a4918bde4e71b6d1c70f762d3) · [your claim](https://bchexplorer.info/tx/9df0f0fdef72e22264bd630ed3a8a0ec020832e0501f1a3e6f5b4e8d9839452c) · [solver claim](https://basescan.org/tx/0x2ccfba8a6c586168b7ff74906ea4050610f349076bad06455d525d0c17d96ae0)                                   |
| 2   | 11-19 | 1.00 USDC → 0.99 PUSD   | Base            | 1154 s | [lock](https://basescan.org/tx/0x0d25a0c1880cd50ecf72e8819621ef2d61545d7415648a4b4de43c9c98a7bd0c) · [counter-lock](https://bchexplorer.info/tx/e59feb6d7d6110cfd72dbabdfece3787b15ed4251943f7cef010a22252d4af62) · [your claim](https://bchexplorer.info/tx/7b63652a4feac4ca033435eb0fc97a0c8c1b27b4f925df62b6057d0c7af9c3eb) · [solver claim](https://basescan.org/tx/0x0370c4727afc6af1aed5fa3210a512cc27753c97b2106011f7e47ebcdee8c979)                                   |
| 3   | 11-19 | 5.00 USDC → 4.98 PUSD   | Base            | 102 s  | [lock](https://basescan.org/tx/0x4846b2a274171ae6319f2a4dcebf04d40627b9439cd5ae88d1f3099f51cd9130) · [counter-lock](https://bchexplorer.info/tx/c6d86c6662429798f4c390954b19337d51ec5692ac9db36704c09219bcf318fa) · [your claim](https://bchexplorer.info/tx/3478c3ca104693b6fbbd18db71cf01d23cf8d2ee30654d5f170ddd93b939b21a) · [solver claim](https://basescan.org/tx/0x26568500c920ce52d20644ed341b4f1f8b197a66194289e9a9d48341fe3007c2)                                   |
| 4   | 11-19 | 5.00 USDC → 4.98 PUSD   | Base            | 101 s  | [lock](https://basescan.org/tx/0x5afd93013dd2f000fbc238c0b6bd61cd877bdf9f5c34b6e0dbc49d9e88f7daea) · [counter-lock](https://bchexplorer.info/tx/38afd64b929546937d98c5654366c7b530063f554f5b7fea12c152dabeb55cc1) · [your claim](https://bchexplorer.info/tx/c63882d078597f2ab70f4e33c480fb3cea1b0d1d3bdfef79c00611ab08e5fc0f) · [solver claim](https://basescan.org/tx/0xb3f44eb8ff92d343165ee35cf5c2ea97400d4958be3cd4e676371963fa04cc49)                                   |
| 5   | 11-19 | 5.00 USDC → 4.98 PUSD   | Base            | 94 s   | [lock](https://basescan.org/tx/0xea949de9528ff802b9cc05a6ddeae33d580a5b13e37d388dbfff55b5df63583b) · [counter-lock](https://bchexplorer.info/tx/f83549aaa572ae736dbbaf5ae0170f92c15d89f970b2038bd48c215a8ae8ea36) · [your claim](https://bchexplorer.info/tx/6d4fc045bbaef292a75d2b8c6cbe24158956956976cba94951defea7dd2ae5ad) · [solver claim](https://basescan.org/tx/0x3cf24d01bd85da064c0430104463880706b5df2c85636f187df0017c5d1803f5)                                   |
| 6   | 11-19 | 4.00 PUSD → 3.98 USDC   | Base            | 43 s   | [lock](https://bchexplorer.info/tx/c9c9aa34c09ba5d04e55a166e9b0f3b438a1771dd357419ed079a7dc1789767c) · [counter-lock](https://basescan.org/tx/0x62686def675681fe7af03879053b29bd788cceae61b38210b36a0b81b1762442) · [your claim](https://basescan.org/tx/0x1c604e24698e700c969073d89c50e68f52df28f4c88d0e5510bc3e40105a8291) · [solver claim](https://bchexplorer.info/tx/6342405b6e19155d34d45ba33674d4c52cfa972148890423960ecdb2e58f6613)                                   |
| 7   | 11-19 | 7.00 PUSD → 6.97 USDC   | Base            | 38 s   | [lock](https://bchexplorer.info/tx/0ad39f1b8630fafae3a4510d150e744dcaa648a23fe76227651a2c1601c4f284) · [counter-lock](https://basescan.org/tx/0xa33c8d392523efa6dc6e3169122c3e9ee1446b9427072dc9bf225b8cc6bb94f3) · [your claim](https://basescan.org/tx/0xab97c8967c8dc0476a22d04c8a2434f67011cb46591b6ff28f674b8d6ad7dc4a) · [solver claim](https://bchexplorer.info/tx/a7d6c4998c3ec4596c2b9cd1ed3405be011be20d55a438cfc96bdc3a71bbf4a1)                                   |
| 8   | 11-19 | 2.02 USDC → 2.01 PUSD   | Base            | 96 s   | [lock](https://basescan.org/tx/0x510dc2fc16c640c61e0506f1ffc0f83beee5d15568ecdff0a04176cebbd22dd8) · [counter-lock](https://bchexplorer.info/tx/d91f86a413598360db41578f4c3e50c18a32ed45a04b83bc8d9f1eacbe127dd7) · [your claim](https://bchexplorer.info/tx/e055c55d688486a3f9335eed21f0e87d01c4c2679f7b83602343bdc3f0aaba42) · [solver claim](https://basescan.org/tx/0xd108407d48bff112e0a07c6fb1f09ba094ebf2c7c2031f9ced1413b8c9433e70)                                   |
| 9   | 11-19 | 2.00 PUSD → 1.99 USDC   | Base            | 4547 s | [lock](https://bchexplorer.info/tx/528753bd44233e6c490af6ebe82ef914ae485e61b5bcf5729a821add348697ce) · [counter-lock](https://basescan.org/tx/0xbd311c267ba501b504243f1548ca53ff040bbac6163e9841a98cb42a0ca72cd7) · [your claim](https://basescan.org/tx/0x32ed42c53841983b29ec6da72bf9d2ae1d1815eaf1706b2e6c3b63cb8e458c67) · [solver claim](https://bchexplorer.info/tx/09bdb8afbaef0eba3a37e99a884b39c6f4506f369a34036ff134594cf52cf438)                                   |
| 10  | 11-19 | 8.00 USDC → 7.96 PUSD   | Base            | 36 s   | [lock](https://basescan.org/tx/0xe6dc18b17881ef2dce85c69849782967df22635dc759f149e9e2650cd7e867cb) · [counter-lock](https://bchexplorer.info/tx/cf1e39b3ce1e4ab9e6629d4e7fa9ba8be0fc24a723f83b447555712d52d81847) · [your claim](https://bchexplorer.info/tx/a9f801f60bcadad6bdd086a58c9babac4562d49b141640eca7b30edf0d24ecef) · [solver claim](https://basescan.org/tx/0x7d75adac5afd8428f61bef971e35cf11babb2b1a8617ce7fbb2bbfb64711d656)                                   |
| 11  | 11-19 | 5.00 PUSD → 4.98 USDC   | Arbitrum One    | 40 s   | [lock](https://bchexplorer.info/tx/4ae05b46f11d68df866a634d7018b019303eb930f5556b6a379e5ce73bf487cf) · [counter-lock](https://arbiscan.io/tx/0x49fcad6f6b144e343d41fe3a83c7eb4979948c5dcde4ce150daf10d7ee84c9f3) · [your claim](https://arbiscan.io/tx/0x525f9ee29ceb3533cb32aca9e9042a48ef4c764886a81142e6c6398597f37cdd) · [solver claim](https://bchexplorer.info/tx/3a2b8f3c93a5a3359c7f61e7c7bc9fc08f4406b61e5de66895fa6fc1e19ae03f)                                     |
| 12  | 11-19 | 5.00 USDC → 4.98 PUSD   | Base            | 43 s   | [lock](https://basescan.org/tx/0xdcb191ac712bdd19b2347200ac815fdfb8827e076b04e744333a00c04bd25423) · [counter-lock](https://bchexplorer.info/tx/f8dd98104289686b5c04d368a1de75820a2cab5014b0824fb5b7fb012fbc1c77) · [your claim](https://bchexplorer.info/tx/9964c1f74699a0a8afd568721d5091123ab2d928677287a9e32d59aa493b6c3d) · [solver claim](https://basescan.org/tx/0x50247e43ef3f3e66d620519683537162f9a340990480a3c11d9955beab1b9930)                                   |
| 13  | 11-19 | 8.00 USDC → 7.96 PUSD   | Arbitrum One    | 3268 s | [lock](https://arbiscan.io/tx/0xe8c1de40dcd914bdd29beb5a553f2b04f1116164a2e086fb583b651655ab96f4) · [counter-lock](https://bchexplorer.info/tx/33bd6cda1e732a8f028c16ebb4047a29222446a3fa772a996d32e5e0397d5a09) · [your claim](https://bchexplorer.info/tx/54d55dbbddce1b3935bdc0dedeacc81f8968c5fa54722c93a243abe58c522873) · [solver claim](https://arbiscan.io/tx/0x5feb7d1389297f04c2ab93902c0cba2efd99fa825c9ddf1122e5b784ace2f7f4)                                     |
| 14  | 11-19 | 9.00 USDC → 8.96 PUSD   | Arbitrum One    | 774 s  | [lock](https://arbiscan.io/tx/0xad2e34f8908e250323bbe6c2330b7acd1a52e5c788f4c997a0b6b80ebe373173) · [counter-lock](https://bchexplorer.info/tx/bf8608af8cd7a774aba095c78d7b19fefd96ecfdf0ceaa1dd41b62cffa3b8720) · [your claim](https://bchexplorer.info/tx/60d995bbdcdd9b011e4bc0ccc3c6da7bd454e3ee87ccfed4377c38be0401f313) · [solver claim](https://arbiscan.io/tx/0xafca4fff3179844ab6df73b63a3a8eb9ae2558b919a1435cd31d2d4db07ffb75)                                     |
| 15  | 11-20 | 11.00 PUSD → 10.95 USDC | Arc             | 80 s   | [lock](https://bchexplorer.info/tx/9501dc9feb1b15cbee48d0c0716b276bea475f5a819de4496d19b6c8a1e6ae84) · [counter-lock](https://explorer.arc.io/tx/0xab9076aafd2dc74d02fcf33d93c9ac98f94f9ef310502913735bfca098fb3d8b) · [your claim](https://explorer.arc.io/tx/0xebaef66a1722b807ba06a73059bbbec7462e8888fd3b529fb14eedaa5a50349b) · [solver claim](https://bchexplorer.info/tx/14583add46f1c021fa7340cf212e145357591b7b4c321dc8fedc4b05a34487be)                             |
| 16  | 11-20 | 10.95 USDC → 10.90 PUSD | Arc             | 45 s   | [lock](https://explorer.arc.io/tx/0x67166532f73c92dc0446197840ebd8022255f4fd56b098a6dcd6710ae9b5f14b) · [counter-lock](https://bchexplorer.info/tx/eeee45cf38b662faf92dc5d668375cc461de7ee3402e5b4b2f044d94be7ff5d5) · [your claim](https://bchexplorer.info/tx/441a282c735043c65a8ae6f5efed59885e68eb61dfb02993aaabe814950af140) · [solver claim](https://explorer.arc.io/tx/0xda24ca0062156a8f9028db6fdf06118afa27a3b59e8ee7fd5ee36cfaa12d9d08)                             |
| 17  | 11-20 | 5.00 PUSD → 4.99 USDT   | BNB Chain       | 63 s   | [lock](https://bchexplorer.info/tx/2417589b61ab89e65e71d5f83aac5cdde5446958633306ee795710de232843e9) · [counter-lock](https://bscscan.com/tx/0x824bc412b2fef60b476139284b63bf4179025ebe551e426e6de58474b4db784f) · [your claim](https://bscscan.com/tx/0x3ed3418327a7baa40e849b1e9fe717e271c49129f253408bab443e7c926bcdc9) · [solver claim](https://bchexplorer.info/tx/90a42bf040c50754c660fec59780510960b084dd56727be842da679e5893764f)                                     |
| 18  | 11-20 | 4.99 USDT → 4.98 PUSD   | BNB Chain       | 80 s   | [lock](https://bscscan.com/tx/0x9da32a23e849755b5a88baea88d303a5c1f348f4a5ef16306c1ddccc08b31ddb) · [counter-lock](https://bchexplorer.info/tx/a1c3d42604fdc1587b8fd53d5d787b7512069b327edc1d8ee7a943578f3e88a5) · [your claim](https://bchexplorer.info/tx/e073f178a83a85b937d621809d4ba90ef003824b9bff1b50a48f60891b017da5) · [solver claim](https://bscscan.com/tx/0x4d9a24785ee21b8dca28f53b3dea65488382b7d56e7ee8d128f3554eea39bedd)                                     |
| 19  | 11-20 | 11.00 PUSD → 10.98 USDG | Robinhood Chain | 46 s   | [lock](https://bchexplorer.info/tx/3892ac5a34c20c57a3481e303312ccf4fd122a32f3c1b84223c96acb0022a606) · [counter-lock](https://robinhoodchain.blockscout.com/tx/0xa1069e97fcf81b4608f2ef74174b44235751afa7045e27c5a1ed1d76db4f89e2) · [your claim](https://robinhoodchain.blockscout.com/tx/0xf107ce27be8095347a78bfb6ae1a856def24d0453bfa195b92ca14ffb1fdd41d) · [solver claim](https://bchexplorer.info/tx/59ec1cf4be7d9c2a3d00632495071ff3f107c596ab752c689cf65a927b29a49c) |
| 20  | 11-20 | 10.98 USDG → 10.96 PUSD | Robinhood Chain | 960 s  | [lock](https://robinhoodchain.blockscout.com/tx/0xc9c0893c8c885de784f61e5f4fed83c2830b46ec7b857fbe4b3c59dddc4c45c7) · [counter-lock](https://bchexplorer.info/tx/0dfc969bb176c46f04e90c080079d861612bafcfd3cdfc34b2f932f304ae49e8) · [your claim](https://bchexplorer.info/tx/18de164ac6997230596d68fb2a5319df86e821e643947020711a9dcfc964b261) · [solver claim](https://robinhoodchain.blockscout.com/tx/0x46599b623f16a632f21b5fe1d172b51865c7c38ede96666ca1c5de0ec2fbdcdd) |
| 21  | 11-20 | 7.50 PUSD → 7.49 USDC   | Ethereum        | 242 s  | [lock](https://bchexplorer.info/tx/2409065d510091bebcec7843e0ccf1f758e052e2806328ad1c446e7739087c8c) · [counter-lock](https://etherscan.io/tx/0xf0213098b48cdca8e51430f9393721a817a1f8c3e7366721d36b2e9e3224fca8) · [your claim](https://etherscan.io/tx/0x4b51520f1f3364ec4514f96761fb0ca2c42aed2dd04129ef88cbfd6fabb4b883) · [solver claim](https://bchexplorer.info/tx/958f9fbe8cfda021ac077be12996c29068074ea4a835fbb4f1b4833aed126704)                                   |
| 22  | 11-20 | 7.49 USDC → 7.48 PUSD   | Ethereum        | 412 s  | [lock](https://etherscan.io/tx/0xaf271a25ba1d37952c1b1f29e4094961c7b908cc943dde69c78b55e33d5ed8e5) · [counter-lock](https://bchexplorer.info/tx/04fbcb00368a6a898ee8aef41bcd0a9619e2e2e8285221342850ec16712f554d) · [your claim](https://bchexplorer.info/tx/fa8f1f78756747fcdab0f033a29537418a44ef0fb95c73a49a77e605f70eed8d) · [solver claim](https://etherscan.io/tx/0x83b7a779277f95638ff972c8ee489566ed39c2a12482904c6bf84c605fb577b6)                                   |
| 23  | 11-20 | 8.60 PUSD → 8.59 USDT   | Ethereum        | 114 s  | [lock](https://bchexplorer.info/tx/0d79fcba554e227889f31e114e5b6ae35c884e6a70ab20885c6e4ed9f581cf82) · [counter-lock](https://etherscan.io/tx/0x9c44f11f50abbd44cbb19d09ea1cc254418b3a3b8a593d68f95245e08005fac9) · [your claim](https://etherscan.io/tx/0x87b2a5107c7dbddf914190de3695a07cd2fb1ef1b8852dcd2326bb3cf4269a6b) · [solver claim](https://bchexplorer.info/tx/714bc440330f05e506dd26ecfeb10305b9ae9911fd8066e2941c820f4a7c5ed9)                                   |
| 24  | 11-20 | 8.59 USDT → 8.58 PUSD   | Ethereum        | 93 s   | [lock](https://etherscan.io/tx/0x964a9de4845e77781f0989c85d717984487bee17163dc5632409c6556cc9a07e) · [counter-lock](https://bchexplorer.info/tx/3e749b43e3f3d6697d2eda4e06ece8ee4c683b352e5d95e6dbff724fe8161e88) · [your claim](https://bchexplorer.info/tx/382ad0277448b11aac6a6848f6060600dcddc06375357091839dc7e7af0a99db) · [solver claim](https://etherscan.io/tx/0x3be601af9dd0a4f7a24c39a2eab1656be1a2450762093ce215fc0da64b1408a6)                                   |
| 25  | 11-20 | 12.00 PUSD → 11.99 USDT | Arbitrum One    | 28 s   | [lock](https://bchexplorer.info/tx/009732f81fef29a88312fcd5031123162372127df2b4eee80de8eaa202cce824) · [counter-lock](https://arbiscan.io/tx/0x7352edfcb801828ccac63f763ceaaac94a6d1a4a2434c817663d1cd57cb003fb) · [your claim](https://arbiscan.io/tx/0xdd603ff0c1eec17a834e1b5177d510232fe266f514bb7342a89852913dba78fb) · [solver claim](https://bchexplorer.info/tx/b1f8dd89a88df5ebe0f345bc53f10c9c21498647540e59c2daff6f5ae1a3ed02)                                     |
| 26  | 11-20 | 11.99 USDT → 11.98 PUSD | Arbitrum One    | 42 s   | [lock](https://arbiscan.io/tx/0xa6af44e8ff0c8d78a9183dc28c6c864b1b672b75077775779d5862436f9510ce) · [counter-lock](https://bchexplorer.info/tx/5118321efa44e923d6226042bc66d7521d7dcbef298926455f0acdd1b7e661ba) · [your claim](https://bchexplorer.info/tx/c318ba83119081a75352aec76bba2350ba16277191b846b07e4a3e5794c8f014) · [solver claim](https://arbiscan.io/tx/0x7e6d0450874fc55edf1765309b272deec4742b52c1f82a10d9a5730f32196b8c)                                     |
| 27  | 11-20 | 10.00 USDC → 9.99 PUSD  | Base            | 36 s   | [lock](https://basescan.org/tx/0x326817a424704883306dabeb9218f936581ba26b987d2f3eed065cca8d3c92d9) · [counter-lock](https://bchexplorer.info/tx/3b6fdcf5869a778f1d84f49e90dca6610103e0512cf590853bf869b097d7058d) · [your claim](https://bchexplorer.info/tx/31e99dd5fb65b8ac247a5a9ffe6c25abbd46f9b55e7e4f42a619b17bd0d00c2e) · [solver claim](https://basescan.org/tx/0x8c104e0e7e347391dd1e2f1b1dcf0766c9c1ff09b9b11e8c7183274b22054aca)                                   |

Full order ids: [`mainnet.md`](mainnet.md). The same record in the docs: [Mainnet record](https://ferry.incepture.dev/docs/mainnet-record).

## Testnet and mainnet

Ferry was first built on testnets before BCH BLAZE 2026, as [`ferry-testnet`](https://github.com/deyoungjohn/ferry-testnet). This repository was started fresh on 15 November 2026 and is not a fork of it.

|                      | Testnet build                                                                                                                          | Mainnet build (this one)                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Networks             | Bitcoin Cash chipnet; Base Sepolia, Ethereum Sepolia, Arbitrum Sepolia, BNB testnet, Arc testnet; Solana devnet and TRON Nile adapters | Bitcoin Cash mainnet; Base, Ethereum, Arbitrum One, BNB Chain, Arc, Robinhood Chain                                           |
| Bitcoin Cash tokens  | Self-minted test tokens (tPUSD, tMUSD)                                                                                                 | Real PUSD (ParyonUSD) and MUSD (Moria v1)                                                                                     |
| EVM stablecoins      | Test USDC                                                                                                                              | USDC, USDT and USDG                                                                                                           |
| EVM contract         | `FerryHTLC` on testnets                                                                                                                | `FerryHTLC` at `0xfC28…DAdF` on six mainnets, source verified                                                                 |
| Swaps                | Test swaps, many scripted                                                                                                              | 55 real swaps and $475 settled by 21 Nov, every route both ways ([record](/docs/mainnet-record))                              |
| Gas for the user     | User paid gas on most steps                                                                                                            | Gasless locks and claims relayed by the solver                                                                                |
| Recovery             | A recovery file per swap                                                                                                               | Wallet-derived recovery key: one signature finds every swap on any device; files and `recover.html` still work                |
| Pay links            | Fixed amount                                                                                                                           | Fixed or open amount, payer picks any chain and token, delete unpaid links                                                    |
| Send links           | Planned                                                                                                                                | Live: receiver chooses the route, signs one free message, unclaimed links refund                                              |
| Finishing a swap     | Keep the page open                                                                                                                     | Finish with your wallet from any device, or the optional handoff                                                              |
| Bitcoin Cash wallets | Manual signing in testing                                                                                                              | WizardConnect, with Ferry's own relay and fallback to public relays                                                           |
| Pricing              | Fixed test prices                                                                                                                      | Live Chainlink, Cauldron and Paryon prices with a peg guard                                                                   |
| Operations           | Local daemon                                                                                                                           | Hosted solver with write-ahead state, RPC fallbacks, health checks, backups                                                   |
| Testing              | Unit, e2e and chaos tests                                                                                                              | Plus fork rehearsals on every chain, 30,000 fuzz runs, 2,700 covenant attacks, a 200-swap load run ([details](/docs/testing)) |

## How it was tested

Re-run on 21 November 2026. How to run each yourself: [How Ferry was tested](https://ferry.incepture.dev/docs/testing).

| Claim on the site                    | Evidence                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20,000 Foundry fuzz runs             | 6 fuzz properties of `FerryHTLC.sol` at 5,000 runs each (30,000), plus an invariant suite of 5,000 runs and 320,000 calls with no violation; all 67 Foundry tests pass |
| 1,100+ BCH covenant attacks rejected | Every claim and refund path run against 1,382 mutated transactions per token in the libauth VM: 1,356 rejected, the rest documented harmless variants                  |
| 200 load-run swaps, 0 failures       | 200 concurrent swaps against the real solver engine and contract on a local Anvil chain: 200 completed, 0 nonce or database errors                                     |

Plus about 1,500 unit tests, 28 adversarial tests, 15 end-to-end tests, fork rehearsals on Base, Ethereum, Arbitrum and BNB Chain, and a fork matrix on every chain.

## Repository

| Package                                                                                                          | What it does                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)                                                                                 | Order terms and id, signing, timing invariants, pricing, recovery key, recovery file, links, API schemas |
| [`packages/htlc-evm`](packages/htlc-evm)                                                                         | `FerryHTLC.sol`, Foundry tests, deterministic deploy and verify                                          |
| [`packages/htlc-bch`](packages/htlc-bch)                                                                         | `FerryHTLC.cash`, keyless claim and refund builders checked in the libauth VM, WizardConnect requests    |
| [`packages/chain-config`](packages/chain-config)                                                                 | Verified chain and token facts, fail-closed routes, RPC fallbacks                                        |
| [`packages/chain-evm`](packages/chain-evm)                                                                       | EVM adapter: locks, claims, relays, log scanning                                                         |
| [`packages/solver`](packages/solver)                                                                             | The solver daemon and its `/v1` API                                                                      |
| [`packages/solver-client`](packages/solver-client)                                                               | Typed client with local quote verification                                                               |
| [`packages/user-flow`](packages/user-flow)                                                                       | The user's side of a swap as a browser library                                                           |
| [`packages/web`](packages/web)                                                                                   | The website and the docs                                                                                 |
| [`packages/recover-page`](packages/recover-page), [`packages/recover-cli`](packages/recover-cli)                 | Recovery without the website                                                                             |
| [`packages/bch-prices`](packages/bch-prices), [`packages/evm-prices`](packages/evm-prices)                       | Price sources and the peg guard                                                                          |
| [`packages/e2e`](packages/e2e), [`packages/fork-tests`](packages/fork-tests), [`packages/probe`](packages/probe) | End-to-end, fork and live probe tests                                                                    |

More: [Architecture](https://ferry.incepture.dev/docs/architecture), [Solver API](https://ferry.incepture.dev/docs/api), [Security model](https://ferry.incepture.dev/docs/security), and [`docs/`](docs).

## Run locally

Requires Node 22, pnpm 9 and Foundry.

```bash
pnpm install
pnpm format:check && pnpm typecheck && pnpm lint
pnpm test:unit
pnpm check:private
```

See the interface with mocks, no solver or wallet needed:

```bash
VITE_NETWORK=testnet VITE_MOCK=1 pnpm --filter @ferry/web dev
```

Deploying (Caddy, systemd, the WizardConnect relay): [`deploy/README.md`](deploy/README.md) and [Running Ferry](https://ferry.incepture.dev/docs/self-hosting).

## Recovery without the website

[`recover.html`](recover.html) is one self-contained page. Open it from your computer, load your recovery file, and it reads the chains directly and sends the claim or refund: an EVM transaction through your browser wallet, or a Bitcoin Cash transaction that needs no wallet. It needs no Ferry server and no solver.

## Build disclosure

- **Prior work:** [`ferry-testnet`](https://github.com/deyoungjohn/ferry-testnet) is the public testnet implementation built before BCH BLAZE 2026. Design notes and measured results from that work are in [`preparation/`](preparation/).
- **AI-assisted development:** this repository was written by a small team of AI coding agents (Claude) working in parallel under human direction, as recorded in the `Co-Authored-By` commit trailers.

## Credits

The swap card's layout and token picker are adapted from the Swap block at <https://beui.dev/components/blocks/swap>, and the pagination control and date range picker from beui.dev components, used with the maintainer's permission. Built with CashScript, libauth, Foundry, OpenZeppelin, viem, wagmi, Reown AppKit and WizardConnect. PUSD by Paryon, MUSD by Moria.

## License

[MIT](LICENSE)
