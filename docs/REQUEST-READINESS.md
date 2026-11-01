# Missing permission roles and new requests

Missing Discord permission roles are scoped to the request flow that actually uses them. A deleted restriction-command or partnership-management role does not block Minecraft verification, waitlist entry, queue joining, tester session starts, or normal testing tickets. LOA requests likewise ignore missing roles unrelated to LOA.

Testing still checks configured owner, staff/tester, rank, region/waitlist, restricted-player and high-test notification role references. Each support route checks its own access, closing and notification role groups. A partnership route with a deleted management role remains blocked until that mapping is corrected. Shared roles remain blocking for every flow that needs them.

This is a narrow fix for missing-role diagnostics. Other configuration errors, including missing channels, invalid categories, role hierarchy and essential bot permissions, remain blocking. Runtime authorization, member identity, maintenance, module flags, cooldowns, restrictions and ticket eligibility checks are unchanged.

/health and /config validate still report the complete validation findings so operators can repair obsolete mappings. No roles are created, assigned or granted extra permissions by this change.

Regression tests cover unrelated missing roles, relevant/shared role failures, essential permission failures, and verification/waitlist/join interactions. November 1: 183 tests passed on Windows and Linux.
