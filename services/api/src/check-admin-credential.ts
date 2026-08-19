import { eq } from "drizzle-orm";

import {
  db,
  userCredentials,
  users,
} from "@ak-vision-ai/database";

const email = "admin-test@akvision.local";

const result = await db
  .select({
    userId: users.id,
    email: users.email,
    role: users.role,
    status: users.status,
    credentialUserId: userCredentials.userId,
  })
  .from(users)
  .leftJoin(
    userCredentials,
    eq(userCredentials.userId, users.id),
  )
  .where(eq(users.email, email))
  .limit(1);

console.log(result);

process.exit(0);