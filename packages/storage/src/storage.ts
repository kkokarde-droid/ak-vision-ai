export interface PutMediaFileOptions {
  sourcePath: string;
  key: string;
  contentType: string;
  signal?: AbortSignal;
}

export interface StoredMediaObject {
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

export interface MediaStorage {
  putFile(
    options: PutMediaFileOptions,
  ): Promise<StoredMediaObject>;

  getUrl(
    key: string,
  ): string;

  openFile(
    key: string,
  ): Promise<{
    stream: import("node:stream").Readable;
    sizeBytes: number;
  }>;

  delete(
    key: string,
  ): Promise<void>;
}
