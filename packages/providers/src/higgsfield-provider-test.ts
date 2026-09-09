import test from "node:test";
import assert from "node:assert/strict";

import { createHiggsfieldClient } from "@Higgsfield/client/v2";
import type { HiggsfieldClient } from "@Higgsfield/client";

import {
  HiggsfieldProvider,
} from "./higgsfield.provider.js";

function createFakeClient(
  response: {
    request_id: string;
    status_url: string;
    cancel_url: string;
    status:
      | "queued"
      | "in_progress"
      | "completed"
      | "failed"
      | "nsfw";
  },
): ReturnType<typeof createHiggsfieldClient> {
  return {
    subscribe:
      async () => response,
    configure: () => {},
  };
}

function createJSONResponse(
  payload: unknown,
  status = 200,
): Response {
  return {
    ok:
      status >= 200 &&
      status < 300,
    status,
    json:
      async () => payload,
  } as Response;
}

function createRequest(
  input?: Record<string, unknown>,
) {
  return {
    request: {
      id: "request-provider-test",
      userId: "user-provider-test",
      taskType:
        "video-generation" as const,
      prompt:
        "Cinematic movement",
      mode: "quality" as const,
      createdAt:
        new Date().toISOString(),
      ...(input !== undefined
        ? {
            input,
          }
        : {}),
    },
    taskType:
      "video-generation" as const,
  };
}

async function testSuccessfulGeneration(): Promise<void> {
  const submitted: string[] = [];

  let pollCount = 0;

  let submittedEndpoint = "";
  let submittedInit: RequestInit | undefined;

  const provider =
    new HiggsfieldProvider({
      credentials:
        "test-key:test-secret",
      client:
        createFakeClient({
          request_id:
            "hf-request-success",
          status_url:
            "https://hf.test/status/1",
          cancel_url:
            "https://hf.test/cancel/1",
          status: "queued",
        }),
      pollIntervalMs: 1,
      maxPollTimeMs: 1_000,
      fetchImpl:
        async (
          input,
          init,
        ) => {
          const endpoint =
            String(input);

          if (
            init?.method === "POST" &&
            endpoint.endsWith(
              "/v1/image2video/dop",
            )
          ) {
            submittedEndpoint =
              endpoint;
            submittedInit =
              init;

            return createJSONResponse({
              status:
                "queued",
              request_id:
                "hf-request-success",
              status_url:
                "https://hf.test/status/1",
              cancel_url:
                "https://hf.test/cancel/1",
            });
          }

          pollCount += 1;

          if (pollCount === 1) {
            return createJSONResponse({
              status:
                "in_progress",
              request_id:
                "hf-request-success",
              status_url:
                "https://hf.test/status/1",
              cancel_url:
                "https://hf.test/cancel/1",
            });
          }

          return createJSONResponse({
            status:
              "completed",
            request_id:
              "hf-request-success",
            status_url:
              "https://hf.test/status/1",
            cancel_url:
              "https://hf.test/cancel/1",
            video: {
              url:
                "https://hf.test/video.mp4",
            },
          });
        },
    });

  const result =
    await provider.generate(
      createRequest({
        imageUrl:
          "https://example.test/source.jpg",
      }),
      {
        requestId:
          "request-provider-test",
        userId:
          "user-provider-test",
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

  assert.equal(
    result.success,
    true,
  );

  assert.deepEqual(
    submitted,
    [
      "hf-request-success",
    ],
  );

  assert.equal(
    pollCount,
    2,
  );

  assert.equal(
    submittedEndpoint,
    "https://platform.higgsfield.ai/v1/image2video/dop",
  );

  assert.equal(
    submittedInit?.method,
    "POST",
  );

  assert.equal(
    submittedInit?.headers &&
      (submittedInit.headers as Record<string, string>)["Authorization"],
    "Key test-key:test-secret",
  );

  assert.equal(
    submittedInit?.headers &&
      (submittedInit.headers as Record<string, string>)["Content-Type"],
    "application/json",
  );

  assert.ok(
    submittedInit?.body,
  );

  const submittedBody =
    JSON.parse(
      String(submittedInit?.body),
    ) as Record<string, unknown>;

  assert.ok(
    "params" in submittedBody,
  );

  const submittedParams =
    submittedBody.params as Record<string, unknown>;

  assert.equal(
    submittedParams.model,
    "dop-turbo",
  );

  assert.equal(
    submittedParams.prompt,
    "Cinematic movement",
  );

  assert.deepEqual(
    submittedParams.input_images,
    [
      {
        type: "image_url",
        image_url:
          "https://example.test/source.jpg",
      },
    ],
  );

  const normalized =
    result.result as {
      providerRequestId: string;
      output: {
        type: string;
        url: string;
      };
    };

  assert.equal(
    normalized.providerRequestId,
    "hf-request-success",
  );

  assert.equal(
    normalized.output.type,
    "video",
  );

  assert.equal(
    normalized.output.url,
    "https://hf.test/video.mp4",
  );
}

async function testFailureNormalization(): Promise<void> {
  const provider =
    new HiggsfieldProvider({
      credentials:
        "test-key:test-secret",
      client:
        createFakeClient({
          request_id:
            "hf-request-failed",
          status_url:
            "https://hf.test/status/2",
          cancel_url:
            "https://hf.test/cancel/2",
          status: "queued",
        }),
      pollIntervalMs: 1,
      maxPollTimeMs: 1_000,
      fetchImpl:
        async () =>
          createJSONResponse({
            status:
              "failed",
            request_id:
              "hf-request-failed",
            status_url:
              "https://hf.test/status/2",
            cancel_url:
              "https://hf.test/cancel/2",
          }),
    });

  const result =
    await provider.generate(
      createRequest({
        imageUrl:
          "https://example.test/source.jpg",
      }),
      {
        requestId:
          "request-provider-test",
        userId:
          "user-provider-test",
      },
    );

  assert.equal(
    result.success,
    false,
  );

  assert.equal(
    result.errorCode,
    "PROVIDER_GENERATION_FAILED",
  );
}

async function testNSFWNormalization(): Promise<void> {
  const provider =
    new HiggsfieldProvider({
      credentials:
        "test-key:test-secret",
      client:
        createFakeClient({
          request_id:
            "hf-request-nsfw",
          status_url:
            "https://hf.test/status/3",
          cancel_url:
            "https://hf.test/cancel/3",
          status: "queued",
        }),
      pollIntervalMs: 1,
      maxPollTimeMs: 1_000,
      fetchImpl:
        async () =>
          createJSONResponse({
            status:
              "nsfw",
            request_id:
              "hf-request-nsfw",
            status_url:
              "https://hf.test/status/3",
            cancel_url:
              "https://hf.test/cancel/3",
          }),
    });

  const result =
    await provider.generate(
      createRequest({
        imageUrl:
          "https://example.test/source.jpg",
      }),
      {
        requestId:
          "request-provider-test",
        userId:
          "user-provider-test",
      },
    );

  assert.equal(
    result.success,
    false,
  );

  assert.equal(
    result.errorCode,
    "PROVIDER_CONTENT_POLICY",
  );
}

async function testInputValidation(): Promise<void> {
  const provider =
    new HiggsfieldProvider({
      credentials:
        "test-key:test-secret",
      client:
        createFakeClient({
          request_id:
            "unused",
          status_url:
            "https://hf.test/status/4",
          cancel_url:
            "https://hf.test/cancel/4",
          status: "queued",
        }),
    });

  await assert.rejects(
    provider.generate(
      createRequest(),
      {
        requestId:
          "request-provider-test",
        userId:
          "user-provider-test",
      },
    ),
    /at least one input image URL/,
  );
}

async function testAbort(): Promise<void> {
  const controller =
    new AbortController();

  let resolveFetch:
    | ((response: Response) => void)
    | undefined;

  const fetchPromise =
    new Promise<Response>(
      (resolve) => {
        resolveFetch = resolve;
      },
    );

  const provider =
    new HiggsfieldProvider({
      credentials:
        "test-key:test-secret",
      client:
        createFakeClient({
          request_id:
            "hf-request-abort",
          status_url:
            "https://hf.test/status/5",
          cancel_url:
            "https://hf.test/cancel/5",
          status:
            "in_progress",
        }),
      pollIntervalMs: 100,
      maxPollTimeMs: 5_000,
      fetchImpl:
        async (_url, init) =>
          new Promise<Response>((resolve, reject) => {
            const signal = init?.signal;

            const onAbort = () => {
              signal?.removeEventListener(
                "abort",
                onAbort,
              );
              reject(
                new Error(
                  "AI provider execution aborted.",
                ),
              );
            };

            if (signal?.aborted) {
              onAbort();
              return;
            }

            signal?.addEventListener(
              "abort",
              onAbort,
              { once: true },
            );

            resolveFetch = (response) => {
              signal?.removeEventListener(
                "abort",
                onAbort,
              );
              resolve(response);
            };
          }),
    });

  const execution =
    provider.generate(
      createRequest({
        imageUrl:
          "https://example.test/source.jpg",
      }),
      {
        requestId:
          "request-provider-test",
        userId:
          "user-provider-test",
        signal:
          controller.signal,
      },
    );

  setTimeout(
    () => controller.abort(),
    10,
  );

  await assert.rejects(
    execution,
    /AI provider execution aborted/,
  );

  resolveFetch?.(
    createJSONResponse({
      status:
        "in_progress",
      request_id:
        "hf-request-abort",
      status_url:
        "https://hf.test/status/5",
      cancel_url:
        "https://hf.test/cancel/5",
    }),
  );
}

async function testTimeout(): Promise<void> {
  const provider =
    new HiggsfieldProvider({
      credentials:
        "test-key:test-secret",
      client:
        createFakeClient({
          request_id:
            "hf-request-timeout",
          status_url:
            "https://hf.test/status/6",
          cancel_url:
            "https://hf.test/cancel/6",
          status: "in_progress",
        }),
      pollIntervalMs: 5,
      maxPollTimeMs: 20,
      fetchImpl:
        async () =>
          createJSONResponse({
            status:
              "in_progress",
            request_id:
              "hf-request-timeout",
            status_url:
              "https://hf.test/status/6",
            cancel_url:
              "https://hf.test/cancel/6",
          }),
    });

  await assert.rejects(
    provider.generate(
      createRequest({
        imageUrl:
          "https://example.test/source.jpg",
      }),
      {
        requestId:
          "request-provider-test",
        userId:
          "user-provider-test",
      },
    ),
    /AI provider execution timed out/,
  );
}

test(
  "Higgsfield successful generation normalization",
  async () => {
    await testSuccessfulGeneration();
  },
);

test(
  "Higgsfield failure normalization",
  async () => {
    await testFailureNormalization();
  },
);

test(
  "Higgsfield NSFW normalization",
  async () => {
    await testNSFWNormalization();
  },
);

test(
  "Higgsfield input validation",
  async () => {
    await testInputValidation();
  },
);

test(
  "Higgsfield abort handling",
  async () => {
    await testAbort();
  },
);

test(
  "Higgsfield timeout handling",
  async () => {
    await testTimeout();
  },
);

 
async function testTextToVideoGeneration(): Promise<void> {
  const previousEndpoint = process.env.HF_TEXT_TO_VIDEO_ENDPOINT;
  process.env.HF_TEXT_TO_VIDEO_ENDPOINT =
    "https://hf.test/v1/seedance/text-to-video";

  try {
    const submitted: string[] = [];
    let submittedEndpoint = "";
    let submittedInit: RequestInit | undefined;

    const provider = new HiggsfieldProvider({
      credentials: "test-key:test-secret",
      client: createFakeClient({
        request_id: "hf-t2v-success",
        status_url: "https://hf.test/status/t2v",
        cancel_url: "https://hf.test/cancel/t2v",
        status: "queued",
      }),
      pollIntervalMs: 1,
      maxPollTimeMs: 1_000,
      fetchImpl: async (input, init) => {
        const endpoint = String(input);

        if (
          init?.method === "POST" &&
          endpoint ===
            "https://hf.test/v1/seedance/text-to-video"
        ) {
          submittedEndpoint = endpoint;
          submittedInit = init;

          return createJSONResponse({
            status: "queued",
            request_id: "hf-t2v-success",
            status_url: "https://hf.test/status/t2v",
            cancel_url: "https://hf.test/cancel/t2v",
          });
        }

        return createJSONResponse({
          status: "completed",
          request_id: "hf-t2v-success",
          status_url: "https://hf.test/status/t2v",
          cancel_url: "https://hf.test/cancel/t2v",
          video: {
            url: "https://hf.test/t2v.mp4",
          },
        });
      },
    });

    const base = createRequest({
      mode: "text_to_video",
      duration: 5,
      aspectRatio: "9:16",
      resolution: "1080p",
      bitrate_mode: "high",
      genre: "drama",
      generate_audio: true,
    });

    const result = await provider.generate(
      {
        ...base,
        request: {
          ...base.request,
          prompt:
            "A cinematic product launch in Mumbai at sunset",
        },
      },
      {
        requestId: "request-provider-t2v",
        userId: "user-provider-test",
        onSubmitted: async (id) => {
          submitted.push(id);
        },
      },
    );

    assert.equal(result.success, true);
    assert.deepEqual(submitted, ["hf-t2v-success"]);

    assert.equal(
      submittedEndpoint,
      "https://hf.test/v1/seedance/text-to-video",
    );

    assert.equal(submittedInit?.method, "POST");
    assert.ok(submittedInit?.body);

    const body = JSON.parse(
      String(submittedInit.body),
    ) as {
      params: Record<string, unknown>;
    };

    assert.equal(
      body.params.prompt,
      "A cinematic product launch in Mumbai at sunset",
    );
    assert.equal(body.params.duration, 5);
    assert.equal(body.params.aspect_ratio, "9:16");
    assert.equal(body.params.resolution, "1080p");
    assert.equal(body.params.mode, "std");
    assert.equal(body.params.bitrate_mode, "high");
    assert.equal(body.params.genre, "drama");
    assert.equal(body.params.generate_audio, true);

    const normalized = result.result as {
      providerRequestId: string;
      output: {
        type: string;
        url: string;
      };
    };

    assert.equal(
      normalized.providerRequestId,
      "hf-t2v-success",
    );
    assert.equal(normalized.output.type, "video");
    assert.equal(
      normalized.output.url,
      "https://hf.test/t2v.mp4",
    );
  } finally {
    if (previousEndpoint === undefined) {
      delete process.env.HF_TEXT_TO_VIDEO_ENDPOINT;
    } else {
      process.env.HF_TEXT_TO_VIDEO_ENDPOINT =
        previousEndpoint;
    }
  }
}

async function testTextToVideoMissingEndpoint(): Promise<void> {
  const previousEndpoint = process.env.HF_TEXT_TO_VIDEO_ENDPOINT;
  delete process.env.HF_TEXT_TO_VIDEO_ENDPOINT;

  try {
    const provider = new HiggsfieldProvider({
      credentials: "test-key:test-secret",
      client: createFakeClient({
        request_id: "hf-t2v-missing-endpoint",
        status_url: "https://hf.test/status/t2v",
        cancel_url: "https://hf.test/cancel/t2v",
        status: "queued",
      }),
      fetchImpl: async () => {
        throw new Error("fetch must not be called");
      },
    });

    const base = createRequest({
      mode: "text_to_video",
    });

    await assert.rejects(
      provider.generate(
        {
          ...base,
          request: {
            ...base.request,
            prompt: "Test text to video",
          },
        },
        {
          requestId:
            "request-provider-t2v-missing-endpoint",
          userId: "user-provider-test",
        },
      ),
      /Higgsfield text-to-video endpoint is not configured/,
    );
  } finally {
    if (previousEndpoint === undefined) {
      delete process.env.HF_TEXT_TO_VIDEO_ENDPOINT;
    } else {
      process.env.HF_TEXT_TO_VIDEO_ENDPOINT =
        previousEndpoint;
    }
  }
}

test(
  "Higgsfield text-to-video generation",
  async () => {
    await testTextToVideoGeneration();
  },
);

test(
  "Higgsfield text-to-video missing endpoint",
  async () => {
    await testTextToVideoMissingEndpoint();
  },
);

