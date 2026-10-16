# Proof

Everything below happened on **Tiramisu** (chain 7738577) between 2026-10-16T07:00:37.642Z and 2026-10-16T07:03:57.320Z, produced by `scripts/e2e.ts`.
Every row links to the explorer. The raw record is [`proof/e2e-1792134237320.json`](proof/e2e-1792134237320.json).

Configuration: embargo 120s, extension 60s, 2-of-3 watchers (the deployed watchers).

## The case, from filing to self-publication

| Step | Who | Transaction | Entity |
|---|---|---|---|
| Vendor opens an inbox | vendor wallet | — | [0x8fd93c0a…](https://tiramisu.explorer.arkiv.network/entity/0x8fd93c0a8d73887c6dfe3c1d8cf3c6d276f8d86218db5a7f99e963d3cd2f8876) |
| Researcher files: case + clock + 3 triggers, sealed, one batch | researcher | [0xb318e4cc…](https://tiramisu.explorer.arkiv.network/tx/0xb318e4cc851dc0f3e105783f3316d6ca716fc04ac72dfb777690e5b59fc0ca82) | [0xb28d400c…](https://tiramisu.explorer.arkiv.network/entity/0xb28d400c4e117c31f1278ef22c2dd6610bba6ea88821b87318c2155ed6ec3220) |
| Researcher pays the vendor's responder its gas | researcher | [0x43146ed5…](https://tiramisu.explorer.arkiv.network/tx/0x43146ed55e3895b89c7686e4430bf11a065eb3a27a88193fd02de1697144180d) | — |
| Vendor acknowledges from its one-time responder | responder | [0xcab84bf9…](https://tiramisu.explorer.arkiv.network/tx/0xcab84bf9f8e0640b42cea42e4a454589220870672e8e0ba8b1eecac89767b4f8) | [0x641aa262…](https://tiramisu.explorer.arkiv.network/entity/0x641aa2623e848a4db4b9276a71d2528491c712905884af10509480f68d0ed3a1) |
| Vendor asks for more time | responder | [0xe76ce77c…](https://tiramisu.explorer.arkiv.network/tx/0xe76ce77c359f81e428d1142a96392f157ec7dfb0959d78f0b648d5528386f6e3) | [0x8afba4e8…](https://tiramisu.explorer.arkiv.network/entity/0x8afba4e832ce6d57f637fed29c13d904241c2b49f2c8399692e89bfa6515d994) |
| Researcher grants it: clock + triggers + record, one batch | researcher | [0xfaa09bc7…](https://tiramisu.explorer.arkiv.network/tx/0xfaa09bc759b2c7d9970407d02ac642c9591308bd6c8276f063eb0390aca47c91) | — |
| Vendor marks it fixed | responder | [0xc33cf1b9…](https://tiramisu.explorer.arkiv.network/tx/0xc33cf1b9a88f648c8991b34919db21b4c6004a5ecb9ca0ed2fcf40fd8e32317f) | [0x738f4a35…](https://tiramisu.explorer.arkiv.network/entity/0x738f4a3541f1bff8559eaea7675509dbef9c2d58b012c54a3b7956ee8646dbca) |
| Watcher publishes a `lapsed` receipt at block 642229 | 0xBDEd5092… | — | [0xde6273d4…](https://tiramisu.explorer.arkiv.network/entity/0xde6273d494bd7f44b1a2910ac8ab868d681edace66173049bef41887ceca626a) |
| Watcher publishes a `lapsed` receipt at block 642229 | 0x5839F13C… | — | [0x257d3b15…](https://tiramisu.explorer.arkiv.network/entity/0x257d3b152ce1d82ebd3e7b6d1511a0f56bd462cac71794e63f046d66d1bcb969) |
| Watcher publishes a `lapsed` receipt at block 642230 | 0xb0Bae504… | — | [0xa4aa27ad…](https://tiramisu.explorer.arkiv.network/entity/0xa4aa27ad2a7cc97145a963652a2df51c3087953504b3e727159325911040c1b6) |
| Reveal: advisory key published and verified | watcher | — | [0x3599fa8c…](https://tiramisu.explorer.arkiv.network/entity/0x3599fa8c9248c24f86b1ca6aa156aab374c1bf5b3f03ca561a3e2408360fab7e) |

The clock was filed to expire at block 642196; the grant moved its Entity Expiration to block 642226. The watchers' receipts landed in blocks 642229, 642229, 642230.

Final status: **revealed**, reveal verified: **true**, vendor attribution: **verified** (Halcyon Bridge (test vendor)).

Checks: `{"decrypts":true,"commitment":true,"delivery":true,"responderBinding":true,"inbox":true}`

## Refusals

What the protocol refuses, and how. A reverted transaction is linked when the attempt was mined.

| Attempt | Expected | Observed | Transaction |
|---|---|---|---|
| vendor tries to extend the clock itself | revert | reverted: entity 0x00a3f874…b90acb is owned by 0xFD35C169EB401be44C344d48674cFB05fCC1647b, not 0xEA8FDbFFc53526ED4781BB2570671477f | [0xe57f4e12…](https://tiramisu.explorer.arkiv.network/tx/0xe57f4e1293a609e0cfb6b7865615bcef1afc031d8c82b3242b75529afca67fec) |
| vendor tries to delete the clock | revert | reverted: entity 0x00a3f874…b90acb is owned by 0xFD35C169EB401be44C344d48674cFB05fCC1647b, not 0xEA8FDbFFc53526ED4781BB2570671477f | [0xa3975070…](https://tiramisu.explorer.arkiv.network/tx/0xa39750702cf94e691466ee30050f8f234fd6d561419cf17f999d2422d193729a) |
| researcher tries to edit the sealed case file | revert | reverted: entity 0xb28d400c…ec3220 is owned by 0x000000000000000000000000000000000000dEaD, not 0xFD35C169EB401be44C344d48674cFB05f | [0x302acedd…](https://tiramisu.explorer.arkiv.network/tx/0x302aceddb545683e3d5f865bc08d87890ede864731380447d5e32f1fe44f015b) |
| researcher tries to delete the sealed case file | revert | reverted: entity 0xb28d400c…ec3220 is owned by 0x000000000000000000000000000000000000dEaD, not 0xFD35C169EB401be44C344d48674cFB05f | [0x9a2ad09c…](https://tiramisu.explorer.arkiv.network/tx/0x9a2ad09cb77f1632c4cbbc449da7c3d966f1e0073e5e96ca1d5c56bcd44142c7) |

## Forgeries anyone can write, none of which count

The impostor wallet wrote a fake acknowledgement, a fake fix, a fake lapse receipt, a fake reveal, a decoy clock and a copy of a real escrowed share aimed at the decoy clock ([0xc5b68c36…](https://tiramisu.explorer.arkiv.network/tx/0xc5b68c367565d2531a1f3609ee7e41e6f98423f53cd61716a74baaba0a7fbe24)). Arkiv accepts all of them: anyone can write anything. The state derived from Arkiv ignores every one, by `$creator` or by recomputation:

- ack: not written by this case's responder
- reveal: its key does not open this case
- receipt: not one of this case's watchers
- fixed: not written by this case's responder

Watchers refusing copied escrows, as recorded by the in-process run [`e2e-1792081958141.json`](proof/e2e-1792081958141.json) (the deployed watchers log theirs on their own machines):
- WATCHER_1: not written by the case's researcher ([0xf07bb03c…](https://tiramisu.explorer.arkiv.network/entity/0xf07bb03c8da5e083efd2e2144054d84b8fb90ba22691e2dd3071f1ce4d4900b1))
- WATCHER_1: not written by the case's researcher ([0x61d1050a…](https://tiramisu.explorer.arkiv.network/entity/0x61d1050aa2c9a5fccc2f3a0c62a4f2ce3ed75561df2eabde0c8fae945e9b2507))
- WATCHER_1: not written by the case's researcher ([0x64f67a16…](https://tiramisu.explorer.arkiv.network/entity/0x64f67a16443ae5f361b398368973b6477d971b553eb11dd3e875a74b20b1cb63))

## Every run

| Record | Started | Watchers | Final status | Reveal verified |
|---|---|---|---|---|
| [`e2e-1792081108131.json`](proof/e2e-1792081108131.json) | 2026-10-15T16:14:45.032Z | in-process | revealed | true |
| [`e2e-1792081958141.json`](proof/e2e-1792081958141.json) | 2026-10-15T16:28:36.650Z | in-process | revealed | true |
| [`e2e-1792082747127.json`](proof/e2e-1792082747127.json) | 2026-10-15T16:42:26.856Z | deployed | revealed | true |
| [`e2e-1792134237320.json`](proof/e2e-1792134237320.json) | 2026-10-16T07:00:37.642Z | deployed | revealed | true |

