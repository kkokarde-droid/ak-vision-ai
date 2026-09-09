import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  eq,
} from "drizzle-orm";

import {
  artifacts,
  artifactVersions,
  creditBalances,
  creditReservations,
  db,
  generationJobs,
  generationOutputs,
  users,
} from "@ak-vision-ai/database";

import {
  ArtifactRepositoryError,
  createGenerationJob,
  persistGenerationArtifact,
} from "@ak-vision-ai/generation";

type Fixture = {
  userId: string;
  reservationId: string;
  jobId?: string;
};

async function createFixture(): Promise<Fixture> {
  const userRows =
    await db
      .insert(users)
      .values({
        email:
          `artifact-${randomUUID()}@example.test`,
        displayName:
          "Artifact Integration User",
        role:
          "customer",
        status:
          "active",
        accountType:
          "individual",
      })
      .returning({
        id:
          users.id,
      });

  const user =
    userRows[0];

  assert.ok(user);

  const balanceRows =
    await db
      .insert(creditBalances)
      .values({
        userId:
          user.id,
        organizationId:
          null,
        availableCredits:
          100,
        reservedCredits:
          0,
        currency:
          "INR",
      })
      .returning({
        id:
          creditBalances.id,
      });

  const balance =
    balanceRows[0];

  assert.ok(balance);

  const reservationRows =
    await db
      .insert(creditReservations)
      .values({
        creditBalanceId:
          balance.id,
        userId:
          user.id,
        organizationId:
          null,
        amount:
          10,
        status:
          "reserved",
        idempotencyKey:
          `artifact-reservation-${randomUUID()}`,
      })
      .returning({
        id:
          creditReservations.id,
      });

  const reservation =
    reservationRows[0];

  assert.ok(reservation);

  return {
    userId:
      user.id,
    reservationId:
      reservation.id,
  };
}

async function createJob(
  fixture: Fixture,
): Promise<string> {
  const job =
    await createGenerationJob({
      requestId:
        randomUUID(),
      userId:
        fixture.userId,
      creditReservationId:
        fixture.reservationId,
      type:
        "video",
      priority:
        "normal",
      prompt:
        "Artifact repository integration test",
    });

  fixture.jobId =
    job.id;

  return job.id;
}

async function cleanupFixture(
  fixture: Fixture,
): Promise<void> {
  await db.transaction(
    async (tx) => {
      const jobs =
        await tx
          .select({
            id:
              generationJobs.id,
          })
          .from(generationJobs)
          .where(
            eq(
              generationJobs.userId,
              fixture.userId,
            ),
          );

      const jobIds =
        jobs.map(
          (job) =>
            job.id,
        );

      const artifactIds =
        new Set<string>();

      for (const jobId of jobIds) {
        const outputs =
          await tx
            .select({
              artifactId:
                generationOutputs.artifactId,
            })
            .from(generationOutputs)
            .where(
              eq(
                generationOutputs.jobId,
                jobId,
              ),
            );

        for (const output of outputs) {
          if (
            output.artifactId
          ) {
            artifactIds.add(
              output.artifactId,
            );
          }
        }

        await tx
          .delete(generationOutputs)
          .where(
            eq(
              generationOutputs.jobId,
              jobId,
            ),
          );
      }

      for (const artifactId of artifactIds) {
        await tx
          .delete(artifactVersions)
          .where(
            eq(
              artifactVersions.artifactId,
              artifactId,
            ),
          );

        await tx
          .delete(artifacts)
          .where(
            eq(
              artifacts.id,
              artifactId,
            ),
          );
      }

      await tx
        .delete(generationJobs)
        .where(
          eq(
            generationJobs.userId,
            fixture.userId,
          ),
        );

      await tx
        .delete(creditReservations)
        .where(
          eq(
            creditReservations.id,
            fixture.reservationId,
          ),
        );

      await tx
        .delete(creditBalances)
        .where(
          eq(
            creditBalances.userId,
            fixture.userId,
          ),
        );

      await tx
        .delete(users)
        .where(
          eq(
            users.id,
            fixture.userId,
          ),
        );
    },
  );
}

function input(
  jobId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    jobId,
    storageKey:
      `generations/${jobId}/final.mp4`,
    storageUrl:
      `storage://local/generations/${jobId}/final.mp4`,
    name:
      "Generated Reel.mp4",
    mimeType:
      "video/mp4",
    sizeBytes:
      1024,
    metadata: {
      source:
        "artifact-repository-test",
    },
    ...overrides,
  };
}

test(
  "persists artifact, version, and output with durable storage identity",
  async () => {
    const fixture =
      await createFixture();

    try {
      const jobId =
        await createJob(fixture);

      const result =
        await persistGenerationArtifact(
          input(jobId),
        );

      assert.equal(
        result.artifact.ownerUserId,
        fixture.userId,
      );

      assert.equal(
        result.artifact.storageKey,
        `generations/${jobId}/final.mp4`,
      );

      assert.equal(
        result.artifact.status,
        "ready",
      );

      assert.equal(
        result.artifact.version,
        1,
      );

      assert.equal(
        result.artifactVersion.artifactId,
        result.artifact.id,
      );

      assert.equal(
        result.artifactVersion.version,
        1,
      );

      assert.equal(
        result.generationOutput.artifactId,
        result.artifact.id,
      );

      assert.equal(
        result.generationOutput.url,
        result.artifact.storageUrl,
      );
    } finally {
      await cleanupFixture(fixture);
    }
  },
);

test(
  "same payload is fully idempotent",
  async () => {
    const fixture =
      await createFixture();

    try {
      const jobId =
        await createJob(fixture);

      const request =
        input(jobId);

      const first =
        await persistGenerationArtifact(
          request,
        );

      const second =
        await persistGenerationArtifact(
          request,
        );

      assert.equal(
        second.artifact.id,
        first.artifact.id,
      );

      assert.equal(
        second.artifactVersion.id,
        first.artifactVersion.id,
      );

      assert.equal(
        second.generationOutput.id,
        first.generationOutput.id,
      );

      const artifactRows =
        await db
          .select({
            id:
              artifacts.id,
          })
          .from(artifacts)
          .where(
            eq(
              artifacts.storageKey,
              request.storageKey,
            ),
          );

      assert.equal(
        artifactRows.length,
        1,
      );
    } finally {
      await cleanupFixture(fixture);
    }
  },
);

test(
  "different payload for the same generation is rejected",
  async () => {
    const fixture =
      await createFixture();

    try {
      const jobId =
        await createJob(fixture);

      const request =
        input(jobId);

      await persistGenerationArtifact(
        request,
      );

      await assert.rejects(
        persistGenerationArtifact({
          ...request,
          storageUrl:
            `${request.storageUrl}-different`,
        }),
        (error) =>
          error instanceof
            ArtifactRepositoryError &&
          error.code ===
            "IDEMPOTENCY_CONFLICT",
      );
    } finally {
      await cleanupFixture(fixture);
    }
  },
);

test(
  "legacy generation output without artifactId is safely linked",
  async () => {
    const fixture =
      await createFixture();

    try {
      const jobId =
        await createJob(fixture);

      const request =
        input(jobId);

      const legacyRows =
        await db
          .insert(generationOutputs)
          .values({
            jobId,
            type:
              "video",
            url:
              request.storageUrl,
            mimeType:
              request.mimeType,
            sizeBytes:
              request.sizeBytes,
            metadata:
              request.metadata,
            idempotencyKey:
              `generation-output:${jobId}`,
          })
          .returning();

      const legacy =
        legacyRows[0];

      assert.ok(legacy);
      assert.equal(
        legacy.artifactId,
        null,
      );

      const result =
        await persistGenerationArtifact(
          request,
        );

      assert.equal(
        result.generationOutput.id,
        legacy.id,
      );

      assert.equal(
        result.generationOutput.artifactId,
        result.artifact.id,
      );
    } finally {
      await cleanupFixture(fixture);
    }
  },
);

test(
  "wrong owner cannot claim another owner's storage key",
  async () => {
    const firstFixture =
      await createFixture();

    const secondFixture =
      await createFixture();

    try {
      const firstJob =
        await createJob(
          firstFixture,
        );

      const secondJob =
        await createJob(
          secondFixture,
        );

      const firstInput =
        input(firstJob);

      await persistGenerationArtifact(
        firstInput,
      );

      await assert.rejects(
        persistGenerationArtifact({
          ...input(secondJob),
          storageKey:
            firstInput.storageKey,
          storageUrl:
            firstInput.storageUrl,
        }),
        (error) =>
          error instanceof
            ArtifactRepositoryError &&
          error.code ===
            "OWNERSHIP_CONFLICT",
      );
    } finally {
      await cleanupFixture(
        firstFixture,
      );

      await cleanupFixture(
        secondFixture,
      );
    }
  },
);

test(
  "concurrent same-key persistence creates one artifact, one version, and one output",
  async () => {
    const fixture =
      await createFixture();

    try {
      const jobId =
        await createJob(fixture);

      const request =
        input(jobId);

      const results =
        await Promise.all([
          persistGenerationArtifact(
            request,
          ),
          persistGenerationArtifact(
            request,
          ),
        ]);

      assert.equal(
        results[0]?.artifact.id,
        results[1]?.artifact.id,
      );

      assert.equal(
        results[0]?.artifactVersion.id,
        results[1]?.artifactVersion.id,
      );

      assert.equal(
        results[0]?.generationOutput.id,
        results[1]?.generationOutput.id,
      );

      const artifactsRows =
        await db
          .select({
            id:
              artifacts.id,
          })
          .from(artifacts)
          .where(
            eq(
              artifacts.storageKey,
              request.storageKey,
            ),
          );

      assert.equal(
        artifactsRows.length,
        1,
      );

      const versionsRows =
        await db
          .select({
            id:
              artifactVersions.id,
          })
          .from(artifactVersions)
          .where(
            eq(
              artifactVersions.artifactId,
              results[0]!.artifact.id,
            ),
          );

      assert.equal(
        versionsRows.length,
        1,
      );

      const outputsRows =
        await db
          .select({
            id:
              generationOutputs.id,
            artifactId:
              generationOutputs.artifactId,
          })
          .from(generationOutputs)
          .where(
            eq(
              generationOutputs.jobId,
              jobId,
            ),
          );

      assert.equal(
        outputsRows.length,
        1,
      );

      assert.equal(
        outputsRows[0]?.artifactId,
        results[0]!.artifact.id,
      );
    } finally {
      await cleanupFixture(fixture);
    }
  },
);
