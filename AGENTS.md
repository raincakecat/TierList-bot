# Discord role customization

Role colors and permission bits in the main and support Discord servers are user-managed. Preserve changes made directly in Discord during bot startup, setup, synchronization, deployments, and unrelated role work. Do not reset or replace an existing role's color or permissions unless the user explicitly asks for that change. Creating a missing role may use initial defaults.

When changing role automation, patch only the fields required for the requested behavior. Keep one-off role organization and icon scripts out of startup. For deployments that touch roles, compare live role colors and permission bits before and after the change.
