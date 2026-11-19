# Security

Please report vulnerabilities **privately**, through a GitHub security advisory on this repository (Security → Report a vulnerability), not in a public issue. We're particularly interested in:

- any way passport, date of birth, phone or email values can reach Muse, the pay server, the setup page or logs, rather than only the enclave and Duffel;
- ways for an agent key to read a traveller record, call a function it wasn't granted, or pay a hold (`pay-hold` is restricted to the operator's pay agent);
- ways to charge a card twice, or to mark an order paid without paying for it;
- ways for one traveller to reach another traveller's vault, record or orders;
- weaknesses in the setup page's content security policy or the `/t3` relay.

For issues in the components this builds on, report to their own projects too:

- [Terminal-3/z-tenant-flight](https://github.com/Terminal-3/z-tenant-flight) (the contract this one is forked from)
- [Terminal-3/private-doc-scanner](https://github.com/Terminal-3/private-doc-scanner) (the passport scanner)
- Terminal 3 network and SDK issues: through Terminal 3 ([terminal3.io](https://www.terminal3.io)). The [developer Telegram group](https://t.me/terminal3developer) is for general help, not vulnerability reports.

This is open-source reference software provided as is; see the [Disclaimer](README.md#disclaimer).
