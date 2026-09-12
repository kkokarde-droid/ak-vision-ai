import test from "node:test";
import assert from "node:assert/strict";

import { fal } from "@fal-ai/client";

import {
  FalProvider,
  FalProviderError,
} from "./fal.provider.js";

type FakeFalClient = {
  configCalls: Array<{
    credentials: string;
  }>;

  config: (
    options: {
      credentials: string;
    },
  ) => void;

  queue: {
    submit: (
      endpoint: string,
      options: {
        input: Record<string, unknown>;
      },
    ) => Promise<{
      request_id: string;
    }>;

    status: (
      endpoint: string,
      options: {
        requestId: string;
      },
    ) => Promise<Record<string, unknown>>;

    result: (
      endpoint: string,
      options: {
        requestId: string;
      },
    ) => Promise<Record<string, unknown>>;
  };
};

function createFakeClient(
  overrides: Partial<FakeFalClient["queue"]> = {},
): FakeFalClient {
  const client: FakeFalClient = {
    configCalls: [],
    config(options) {
      client.configCalls.push({
        credentials:
          options.credentials,
      });
    },
    queue: {
      submit:
        async () => ({
          request_id:
            "fal-test-request",
        }),

      status:
        async () => ({
          status:
            "COMPLETED",
        }),

      result:
        async () => ({
          data: {
            video: {
              url:
                "https://fal.test/output.mp4",
              content_type:
                "video/mp4",
            },
            seed:
              42,
          },
        }),

      ...overrides,
    },
  };

  return client;
}
function createRequest(
  input: Record<string, unknown> = {},
) {
  return {
    request: {
      id: "request-fal-test",
      userId: "user-fal-test",
      taskType:
        "video-generation" as const,
      prompt:
        "Cinematic product reveal",
      mode:
        "quality" as const,
      createdAt:
        new Date().toISOString(),
      input,
    },
    taskType:
      "video-generation" as const,
  };
}

test(
  "Fal successful generation builds the Seedance request and normalizes output",
  async () => {
    const fake = createFakeClient();

    let submittedEndpoint = "";
    let submittedInput:
      Record<string, unknown> | undefined;

    let statusCalls = 0;
    let resultCalls = 0;

    fake.queue.submit =
      async (
        endpoint,
        options,
      ) => {
        submittedEndpoint =
          endpoint;
        submittedInput =
          options.input;

        return {
          request_id:
            "fal-success-request",
        };
      };

    fake.queue.status =
      async () => {
        statusCalls += 1;

        return {
          status:
            "COMPLETED",
        };
      };

    fake.queue.result =
      async () => {
        resultCalls += 1;

        return {
          data: {
            video: {
              url:
                "https://fal.test/video.mp4",
              content_type:
                "video/mp4",
            },
            seed: 123,
          },
        };
      };

    const provider =
      new FalProvider({
        credentials:
          "test-fal-key",
        client:
          fake as unknown as typeof fal,
        pollIntervalMs: 1,
        maxPollTimeMs: 1_000,
      });

    const submitted: string[] = [];

    const response =
      await provider.generate(
        createRequest({
          duration: 5,
          aspectRatio: "16:9",
          generate_audio: true,
          bitrate_mode: "high",
        }),
        {
          requestId:
            "request-fal-test",
          userId:
            "user-fal-test",
          onSubmitted:
            async (
              providerRequestId,
            ) => {
              submitted.push(
                providerRequestId,
              );
            },
        },
      );

    assert.deepEqual(
      fake.configCalls,
      [
        {
          credentials:
            "test-fal-key",
        },
      ],
    );

    assert.equal(
      submittedEndpoint,
      "bytedance/seedance-2.0/text-to-video",
    );

    assert.deepEqual(
      submittedInput,
      {
        prompt:
          "Cinematic product reveal",
        resolution:
          "720p",
        duration:
          "5",
        aspect_ratio:
          "16:9",
        generate_audio:
          true,
        bitrate_mode:
          "high",
        end_user_id:
          "user-fal-test",
      },
    );

    assert.deepEqual(
      submitted,
      [
        "fal-success-request",
      ],
    );

    assert.equal(
      statusCalls,
      1,
    );

    assert.equal(
      resultCalls,
      1,
    );

    assert.equal(
      response.success,
      true,
    );

    const normalized =
      response.result as {
        providerRequestId: string;
        output: {
          type: string;
          url: string;
          mimeType: string;
        };
      };

    assert.equal(
      normalized.providerRequestId,
      "fal-success-request",
    );

    assert.equal(
      normalized.output.type,
      "video",
    );

    assert.equal(
      normalized.output.url,
      "https://fal.test/video.mp4",
    );

    assert.equal(
      normalized.output.mimeType,
      "video/mp4",
    );
  },
);

test(
  "Fal 403 becomes non-retryable provider authorization failure",
  async () => {
    const fake =
      createFakeClient();

    fake.queue.submit =
      async () => {
        const error =
          new Error(
            "Forbidden",
          ) as Error & {
            status?: number;
            response?: {
              status?: number;
              data?: {
                message?: string;
              };
            };
          };

        error.status = 403;
        error.response = {
          status: 403,
          data: {
            message:
              "Access denied for this model",
          },
        };

        throw error;
      };

    const provider =
      new FalProvider({
        credentials:
          "test-fal-key",
        client:
          fake as unknown as typeof fal,
      });

    await assert.rejects(
      provider.generate(
        createRequest({
          duration: 5,
        }),
        {
          requestId:
            "request-fal-test",
          userId:
            "user-fal-test",
        },
      ),
      (
        error: unknown,
      ) => {
        assert.ok(
          error instanceof
            FalProviderError,
        );

        assert.equal(
          error.code,
          "PROVIDER_AUTHORIZATION_FAILED",
        );

        assert.equal(
          error.retryable,
          false,
        );

        assert.equal(
          error.statusCode,
          403,
        );

        assert.match(
          error.message,
          /Access denied for this model/,
        );

        return true;
      },
    );
  },
);

test(
  "Fal 429 remains retryable",
  async () => {
    const fake =
      createFakeClient();

    fake.queue.submit =
      async () => {
        const error =
          new Error(
            "Too Many Requests",
          ) as Error & {
            status?: number;
          };

        error.status = 429;

        throw error;
      };

    const provider =
      new FalProvider({
        credentials:
          "test-fal-key",
        client:
          fake as unknown as typeof fal,
      });

    await assert.rejects(
      provider.generate(
        createRequest({
          duration: 5,
        }),
        {
          requestId:
            "request-fal-test",
          userId:
            "user-fal-test",
        },
      ),
      (
        error: unknown,
      ) => {
        assert.ok(
          error instanceof
            FalProviderError,
        );

        assert.equal(
          error.code,
          "PROVIDER_RATE_LIMITED",
        );

        assert.equal(
          error.retryable,
          true,
        );

        assert.equal(
          error.statusCode,
          429,
        );

        return true;
      },
    );
  },
);

test(
  "Fal rejects unsupported 3-second Seedance generation",
  async () => {
    const fake =
      createFakeClient();

    const provider =
      new FalProvider({
        credentials:
          "test-fal-key",
        client:
          fake as unknown as typeof fal,
      });

    await assert.rejects(
      provider.generate(
        createRequest({
          duration: 3,
        }),
        {
          requestId:
            "request-fal-test",
          userId:
            "user-fal-test",
        },
      ),
      /duration must be an integer between 4 and 15 seconds/,
    );
  },
);
