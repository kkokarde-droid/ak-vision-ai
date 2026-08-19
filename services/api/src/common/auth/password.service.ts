import argon2 from "argon2";

export async function hashPassword(
  password: string,
): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error(
      "Password must be at least 8 characters long",
    );
  }

  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });

  return hash.toString();
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!password || !passwordHash) {
    return false;
  }

  try {
    return await argon2.verify(
      passwordHash,
      password,
    );
  } catch {
    return false;
  }
}