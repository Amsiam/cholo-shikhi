// `pnpm identity:bootstrap-admin <email>`: makes an existing, verified account the FIRST Admin.
// Refused once any Admin exists; later Admins are assigned by an Admin (BR4.2). Audit-logged.
import { getIdentity } from '../src/features/identity-access/server/identity-instance.server.ts';
import { closeDb } from '../src/server/db.ts';

const email = process.argv[2];
if (!email) {
  console.error('Usage: pnpm identity:bootstrap-admin <email of a verified account>');
  process.exit(1);
}
try {
  const identity = getIdentity();
  const userId = await identity.userIdByEmail(email);
  if (!userId) throw new Error('no account with that email');
  const result = await identity.bootstrapAdmin(userId);
  if (!result.ok) throw new Error(`refused: ${result.error.code}`);
  console.log('Admin role assigned. Sign in again to enrol the two-step authenticator.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeDb();
}
