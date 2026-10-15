# Proof

Everything below happened on **Tiramisu** (chain 7738577) between 2026-10-15T16:42:26.856Z and 2026-10-15T16:45:47.127Z, produced by `scripts/e2e.ts`.
Every row links to the explorer. The raw record is [`proof/e2e-1792082747127.json`](proof/e2e-1792082747127.json).

Configuration: embargo 120s, extension 60s, 2-of-3 watchers (the deployed watchers).

## The case, from filing to self-publication

| Step | Who | Transaction | Entity |
|---|---|---|---|
| Vendor opens an inbox | vendor wallet | [0xc149ed4c…](https://tiramisu.explorer.arkiv.network/tx/0xc149ed4ce093995f9e89a1d45a534ff10264e8c39b28325b8ee4a36e59e078bd) | [0x8fd93c0a…](https://tiramisu.explorer.arkiv.network/entity/0x8fd93c0a8d73887c6dfe3c1d8cf3c6d276f8d86218db5a7f99e963d3cd2f8876) |
| Researcher files: case + clock + 3 triggers, sealed, one batch | researcher | [0x9ac5fa9f…](https://tiramisu.explorer.arkiv.network/tx/0x9ac5fa9f230989ddeae40998b62c8657a14919bbdf91f353e3b30234239477d0) | [0x4d2e4f93…](https://tiramisu.explorer.arkiv.network/entity/0x4d2e4f930bde2c3249f185a3d65996939d5745569844ed69726281498763a36b) |
| Researcher pays the vendor's responder its gas | researcher | [0xc89e5c87…](https://tiramisu.explorer.arkiv.network/tx/0xc89e5c87f609f024f3e89ec1987f532e3887e2eaed372025e20b10faf42b304d) | — |
| Vendor acknowledges from its one-time responder | responder | [0xe6137f1b…](https://tiramisu.explorer.arkiv.network/tx/0xe6137f1b49b71f8256b476a299f1f0717cc47327098740c4b038136a7e41f554) | [0x5c387c51…](https://tiramisu.explorer.arkiv.network/entity/0x5c387c51925a04ee569b23583fb6f675a878d741d5b80d72446e3b45af1dd557) |
| Vendor asks for more time | responder | [0x3cd64d20…](https://tiramisu.explorer.arkiv.network/tx/0x3cd64d203966723d8e14596d1c8bda5d512860e4d5a0c43287bf28cfbdd2792c) | [0x0d5babbe…](https://tiramisu.explorer.arkiv.network/entity/0x0d5babbe41b2bbc7df6862006ed48e29113b64d72638c9c6dfc3acfd38a63c2e) |
| Researcher grants it: clock + triggers + record, one batch | researcher | [0xa2e9c9ca…](https://tiramisu.explorer.arkiv.network/tx/0xa2e9c9ca8ea06575be3ef36a9e5425808e1dbb1a3ca668209eff05181ef2f96b) | — |
| Vendor marks it fixed | responder | [0xf2e98e2a…](https://tiramisu.explorer.arkiv.network/tx/0xf2e98e2ad15da5adbe7334af0ac35ef678b71e887316f1f34d38ecc3fbd74f7f) | [0x72aa8400…](https://tiramisu.explorer.arkiv.network/entity/0x72aa840063f459a5c529c469c5951e46e22f7e6842b1919951c88aafc3502ef6) |
| Watcher publishes a `lapsed` receipt at block 616486 | 0xBDEd5092… | — | [0xfed63e0d…](https://tiramisu.explorer.arkiv.network/entity/0xfed63e0de15c82da314fff03db9f0621eba01f45ab104ceb6d143648686d09e9) |
| Watcher publishes a `lapsed` receipt at block 616486 | 0x5839F13C… | — | [0xf105b7e9…](https://tiramisu.explorer.arkiv.network/entity/0xf105b7e9a4973e87b654817e628d75c77404e014d374c1c1642ae6d9ae749e9e) |
| Watcher publishes a `lapsed` receipt at block 616487 | 0xb0Bae504… | — | [0x814db74c…](https://tiramisu.explorer.arkiv.network/entity/0x814db74c7d10af12e46539b5bed3271dd158ec7fa107a4f160df2b6907cd4861) |
| Reveal: advisory key published and verified | watcher | — | [0x3be52a3a…](https://tiramisu.explorer.arkiv.network/entity/0x3be52a3affbfc2f37018661f2ce18e88c5f1cb5c99c7be9c9d191523728d0a3d) |

The clock was filed to expire at block 616453; the grant moved its Entity Expiration to block 616483. The watchers' receipts landed in blocks 616486, 616486, 616487.

Final status: **revealed**, reveal verified: **true**, vendor attribution: **verified** (Halcyon Bridge (test vendor)).

Checks: `{"decrypts":true,"commitment":true,"delivery":true,"responderBinding":true,"inbox":true}`

## Refusals

What the protocol refuses, and how. A reverted transaction is linked when the attempt was mined.

| Attempt | Expected | Observed | Transaction |
|---|---|---|---|
| vendor tries to extend the clock itself | revert | reverted: entity 0x4eb41a41…a59fc8 is owned by 0xFD35C169EB401be44C344d48674cFB05fCC1647b, not 0x0ded7e05292a3135a6A16a39E3d00Be89 | [0x27feac0c…](https://tiramisu.explorer.arkiv.network/tx/0x27feac0cb9263ee913f2df77117e4fc80851b42f4a1a79376781e29825fb3b12) |
| vendor tries to delete the clock | revert | reverted: entity 0x4eb41a41…a59fc8 is owned by 0xFD35C169EB401be44C344d48674cFB05fCC1647b, not 0x0ded7e05292a3135a6A16a39E3d00Be89 | [0x75e982ef…](https://tiramisu.explorer.arkiv.network/tx/0x75e982efc0eb35f54aa25a278fd16013b43f8f564e3cf41bc0c94e68190cee06) |
| researcher tries to edit the sealed case file | revert | reverted: entity 0x4d2e4f93…63a36b is owned by 0x000000000000000000000000000000000000dEaD, not 0xFD35C169EB401be44C344d48674cFB05f | [0x7d0fafab…](https://tiramisu.explorer.arkiv.network/tx/0x7d0fafabcfc199c4ca1543037f7fa11ede5300958404c955ca30920dc01113f2) |
| researcher tries to delete the sealed case file | revert | reverted: entity 0x4d2e4f93…63a36b is owned by 0x000000000000000000000000000000000000dEaD, not 0xFD35C169EB401be44C344d48674cFB05f | [0x0cec8bd0…](https://tiramisu.explorer.arkiv.network/tx/0x0cec8bd0379480396cd23d2c61aebb4a975c8c9c142a2b89fdd3d4bc25f2b049) |

## Forgeries anyone can write, none of which count

The impostor wallet wrote a fake acknowledgement, a fake fix, a fake lapse receipt, a fake reveal, a decoy clock and a copy of a real escrowed share aimed at the decoy clock ([0x6cf5391a…](https://tiramisu.explorer.arkiv.network/tx/0x6cf5391a99942146f95cea2d6f6e72d625179bf9aa09c7f64c7fe12563012551)). Arkiv accepts all of them: anyone can write anything. The state derived from Arkiv ignores every one, by `$creator` or by recomputation:

- receipt: not one of this case's watchers
- reveal: its key does not open this case
- fixed: not written by this case's responder
- ack: not written by this case's responder

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

